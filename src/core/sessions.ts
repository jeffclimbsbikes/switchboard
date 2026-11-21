import {
  agentDefaultModel,
  agentModels,
  archiveDir,
  type Config,
  workspaces as configWorkspaces,
} from "../config.js";
import type { Db } from "../db.js";
import type { AgentSession, Driver, DriverEvent } from "../drivers/driver.js";
import type {
  AgentInfo,
  DashboardAgent,
  DashboardSession,
  DashboardSessionDetail,
  DashboardSnapshot,
  HistoryQuery,
  HistoryResult,
  ModelInfo,
  SessionState,
  SessionSummary,
  SessionView,
  WaitResult,
  WorkspaceInfo,
} from "../types.js";
import { condenseActivity, describeRequest } from "./activity.js";
import { resolveAnswer } from "./answers.js";
import {
  type Caller,
  type DashboardApi,
  type SessionManagerApi,
  type StartInput,
  SwitchboardError,
} from "./api.js";
import { ArchiveService } from "./archive.js";
import { HistoryService } from "./history.js";
import { pickName } from "./names.js";
import { type Notifier, nullNotifier } from "./notifier.js";
import { type Access, canSee, resolveAccess } from "./policy.js";
import { type SessionRow, SessionStore, type StoredEvent } from "./store.js";
import { UsageService } from "./usage.js";

export interface SessionManagerOptions {
  config: Config;
  db: Db;
  drivers: Record<string, Driver>;
  notifier?: Notifier;
  now?: () => Date;
  usage?: UsageService;
}

interface Proc {
  session?: AgentSession;
  dead: boolean;
  lastText?: string;
  parkTimer?: NodeJS.Timeout;
  nagTimer?: NodeJS.Timeout;
  launch?: LaunchInfo;
  /** What the agent was last asked, kept while the process has shown no sign of life. */
  turnText?: string;
}

interface LaunchOptions {
  cwd: string;
  model?: string | undefined;
  resume?: string;
  priorCostUsd?: number;
  appendSystemPrompt?: string | undefined;
}

interface LaunchInfo {
  driver: Driver;
  opts: LaunchOptions;
  startedAt: number;
  started: boolean;
  retried: boolean;
}

type Waiter = () => void;

const NOTE_CHARS = 300;
const LAUNCH_RETRY_WINDOW_MS = 10_000;
const DASHBOARD_CLOSED_SHOWN = 100;
const DASHBOARD_ACTIVITY_EVENTS = 60;
const DASHBOARD_EVENT_CAP = 500;
const STATES: SessionState[] = ["starting", "working", "waiting", "idle", "parked", "failed", "closed"];

function unref(t: NodeJS.Timeout): NodeJS.Timeout {
  t.unref?.();
  return t;
}

export class SessionManager implements SessionManagerApi, DashboardApi {
  private readonly config: Config;
  private readonly drivers: Record<string, Driver>;
  private readonly notifier: Notifier;
  private readonly now: () => Date;
  private readonly store: SessionStore;
  readonly usage: UsageService;
  readonly archive?: ArchiveService;
  /** Present only when `[archive]` is configured, so the `history` tool stays opt-in. */
  readonly history?: (input: HistoryQuery, caller?: Caller) => Promise<HistoryResult>;
  private readonly historyService: HistoryService;
  private readonly live = new Map<string, Proc>();
  private readonly waiters = new Map<string, Set<Waiter>>();

  constructor(options: SessionManagerOptions) {
    this.config = options.config;
    this.drivers = options.drivers;
    this.notifier = options.notifier ?? nullNotifier;
    this.now = options.now ?? (() => new Date());
    this.store = new SessionStore(options.db);
    this.usage = options.usage ?? new UsageService({ config: options.config, db: options.db, now: this.now });
    this.historyService = new HistoryService(options.config, options.db);
    if (options.config.archive) {
      this.archive = new ArchiveService({
        config: options.config,
        db: options.db,
        drivers: options.drivers,
        notifier: this.notifier,
        now: this.now,
        isLive: (name) => !!this.live.get(name)?.session,
      });
      this.history = (input, caller) => this.historyService.find(input, resolveAccess(this.config, caller));
    }
    this.recover();
  }

  agents(caller?: Caller): AgentInfo[] {
    const access = resolveAccess(this.config, caller);
    return Object.entries(this.config.agents)
      .filter(([id]) => access.agents.includes(id))
      .map(([id, a]) => {
        const model = agentDefaultModel(a);
        const models = agentModels(a);
        return {
          id,
          driver: a.driver,
          ...(model ? { model } : {}),
          ...(a.description ? { description: a.description } : {}),
          ...(models.length ? { models } : {}),
          default: id === access.defaultAgent,
        };
      });
  }

  usageHint(caller?: Caller): string | undefined {
    const drivers = this.agents(caller).map((a) => a.driver);
    return this.usage.hint({
      claude: drivers.includes("claude"),
      ollama: drivers.includes("acp"),
    });
  }

  touchUsage(): void {
    this.usage.tick();
  }

  workspaces(caller?: Caller): WorkspaceInfo[] {
    const access = resolveAccess(this.config, caller);
    if (!access.restricted) return configWorkspaces(this.config);
    return configWorkspaces(this.config)
      .filter((w) => access.workspaces.includes(w.id))
      .map((w) => ({ ...w, default: w.id === access.defaultWorkspace }));
  }

  snapshot(caller?: Caller): DashboardSnapshot {
    const access = resolveAccess(this.config, caller);
    const rows = this.store.list().filter((row) => canSee(access, row.owner));
    const byState = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<SessionState, number>;
    for (const row of rows) byState[row.state]++;
    const shown = rows.filter((r) => r.state !== "closed");
    const closed = rows.filter((r) => r.state === "closed").slice(-DASHBOARD_CLOSED_SHOWN);
    const sessions = [...shown, ...closed].map((row) =>
      this.dashboardSession(row, access, row.state !== "closed"),
    );
    const visibleAgents = this.agents(caller);
    const catalog: Record<string, ModelInfo[]> = {};
    const agents: DashboardAgent[] = visibleAgents.map((a) => {
      const configured = this.config.agents[a.id];
      const liveSessions = sessions.filter((s) => s.live && s.agent === a.id).map((s) => s.name);
      const runAs =
        !access.restricted && configured && "run_as" in configured ? configured.run_as : undefined;
      const { models, ...info } = a;
      if (models) catalog[a.id] = models;
      return { ...info, ...(runAs && { runAs }), live: liveSessions.length, liveSessions };
    });
    const drivers = visibleAgents.map((a) => a.driver);
    const archive = this.historyService.archiveSummary(access);
    return {
      viewer: { ...(access.email && { email: access.email }), restricted: access.restricted },
      agents,
      catalog,
      usage: this.usage.snapshot({
        agents: visibleAgents,
        rows,
        includeClaude: drivers.includes("claude"),
        includeOllama: drivers.includes("acp"),
      }),
      workspaces: this.workspaces(caller),
      sessions,
      counts: {
        total: rows.length,
        live: sessions.filter((s) => s.live).length,
        maxLive: this.config.max_live_sessions,
        byState,
      },
      ...(archive && { archive }),
    };
  }

  detail(
    session: string,
    opts: { since?: number; limit?: number } = {},
    caller?: Caller,
  ): DashboardSessionDetail {
    const access = resolveAccess(this.config, caller);
    const row = this.require(session, access);
    const limit = Math.min(Math.max(1, opts.limit ?? DASHBOARD_EVENT_CAP), DASHBOARD_EVENT_CAP);
    const lastSeq = this.store.lastSeq(session);
    const page =
      opts.since === undefined
        ? this.store.lastEvents(session, limit)
        : this.store.eventsPage(session, Math.max(0, opts.since), limit);
    const first = page[0]?.seq;
    const last = page.at(-1)?.seq;
    return {
      session: this.dashboardSession(row, access, true),
      events: page.map((e) => ({ seq: e.seq, at: e.at, event: e.data })),
      lastSeq,
      hasMore: last !== undefined && last < lastSeq,
      truncated: opts.since === undefined && first !== undefined && first > 1,
    };
  }

  private dashboardSession(row: SessionRow, access: Access, withActivity: boolean): DashboardSession {
    const activity = withActivity
      ? condenseActivity(this.store.lastEvents(row.name, DASHBOARD_ACTIVITY_EVENTS).map((e) => e.data))
      : [];
    const { session: name, ...view } = this.viewOf(row);
    return {
      ...view,
      name,
      cwd: row.cwd,
      ...(row.model && { model: row.model }),
      ...(!access.restricted && row.owner && { owner: row.owner }),
      live: !!this.live.get(row.name)?.session,
      ...(row.lastActivity && { lastActivity: row.lastActivity }),
      activity,
      ...(row.pending && { pending: row.pending }),
    };
  }

  async start(input: StartInput, caller?: Caller): Promise<SessionView> {
    const access = resolveAccess(this.config, caller);
    const prompt = input.prompt?.trim();
    if (!prompt) throw new SwitchboardError("What should the agent do? The prompt is empty.", "bad_input");
    const agentId = input.agent ?? access.defaultAgent;
    const agent = access.agents.includes(agentId) ? this.config.agents[agentId] : undefined;
    if (!agent) {
      throw new SwitchboardError(
        `There is no agent called ${agentId}. Available: ${access.agents.join(", ")}.`,
        "not_found",
      );
    }
    const workspaces = this.workspaces(caller);
    const workspace = input.workspace
      ? workspaces.find((w) => w.id === input.workspace)
      : (workspaces.find((w) => w.default) ?? workspaces[0]);
    if (!workspace) {
      throw new SwitchboardError(
        `There is no workspace called ${input.workspace}. Available: ${workspaces.map((w) => w.id).join(", ")}.`,
        "not_found",
      );
    }
    const driver = this.drivers[agentId];
    if (!driver) throw new SwitchboardError(`The ${agentId} agent is not available.`, "bad_input");
    const catalog = agentModels(agent);
    if (input.model && catalog.length > 0 && !catalog.some((m) => m.id === input.model)) {
      throw new SwitchboardError(
        `The ${agentId} agent has no model called ${input.model}. Choose one of: ${catalog.map((m) => m.id).join(", ")}.`,
        "bad_input",
      );
    }

    await this.ensureCapacity();

    const name = pickName(this.store.names());
    const model = input.model ?? agentDefaultModel(agent);
    const at = this.stamp();
    this.store.create({
      name,
      agent: agentId,
      workspace: workspace.id,
      cwd: workspace.path,
      ...(model && { model }),
      title: input.title?.trim() || prompt.split(/\s+/).slice(0, 6).join(" "),
      ...(access.email && { owner: access.email }),
      state: "starting",
      createdAt: at,
      updatedAt: at,
    });
    const hint = this.agentHint();
    await this.launch(name, driver, {
      cwd: workspace.path,
      model,
      appendSystemPrompt: this.systemPrompt(agent),
    });
    await this.beginTurn(name, prompt, agent.driver !== "claude" && hint ? `${hint}\n\n${prompt}` : prompt);
    return this.view(name);
  }

  async send(session: string, message: string, caller?: Caller): Promise<SessionView> {
    const row = this.require(session, resolveAccess(this.config, caller));
    const text = message?.trim();
    if (!text) throw new SwitchboardError("There is no message to send.", "bad_input");
    switch (row.state) {
      case "closed":
        throw new SwitchboardError(`${session} is closed. Start a new session instead.`, "closed");
      case "working":
      case "starting":
        throw new SwitchboardError(
          `${session} is still working. Wait for it to finish, or interrupt it.`,
          "busy",
        );
      case "waiting":
        throw new SwitchboardError(
          `${session} is waiting for an answer. Respond to its request first.`,
          "busy",
        );
      case "parked":
      case "failed":
        await this.resume(row);
        break;
      case "idle":
        if (!this.live.get(session)?.session) await this.resume(row);
        break;
    }
    await this.beginTurn(session, text);
    return this.view(session);
  }

  async respond(session: string, requestId: string, answer: string, caller?: Caller): Promise<SessionView> {
    const row = this.require(session, resolveAccess(this.config, caller));
    const pending = row.pending;
    if (row.state !== "waiting" || !pending || pending.id !== requestId) {
      throw new SwitchboardError(
        `${session} has no pending request with that id${pending ? `; the current one is ${pending.id}` : ""}.`,
        "no_pending_request",
      );
    }
    const resolved = resolveAnswer(pending, answer);
    const proc = this.live.get(session);
    if (!proc?.session) throw new SwitchboardError(`${session} is not running; the request is gone.`, "busy");
    this.clearNag(proc);
    this.store.update(session, { state: "working", pending: null, updatedAt: this.stamp() });
    this.append(session, { type: "answer", requestId, text: answer });
    try {
      await proc.session.respond(requestId, resolved);
    } catch (err) {
      this.append(session, { type: "note", text: "the answer could not be delivered" });
      this.store.update(session, { state: "waiting", pending });
      throw new SwitchboardError(`Could not deliver the answer: ${messageOf(err)}`, "busy");
    }
    return this.view(session);
  }

  async wait(
    session: string,
    opts: { cursor?: number; maxWaitMs?: number } = {},
    caller?: Caller,
  ): Promise<WaitResult> {
    this.require(session, resolveAccess(this.config, caller));
    const cursor = opts.cursor ?? Math.max(0, (this.store.lastSeqOfKind(session, "prompt") ?? 1) - 1);
    const maxWait = opts.maxWaitMs ?? this.config.max_wait;

    if (!this.ready(session, cursor) && maxWait > 0) {
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(session) ?? new Set<Waiter>();
        this.waiters.set(session, set);
        const timer = unref(setTimeout(finish, maxWait));
        function finish() {
          clearTimeout(timer);
          set.delete(check);
          resolve();
        }
        const check = () => {
          if (this.ready(session, cursor)) finish();
        };
        set.add(check);
      });
    }
    return this.waitResult(session, cursor);
  }

  list(filter: { state?: SessionState } = {}, caller?: Caller): SessionSummary[] {
    const access = resolveAccess(this.config, caller);
    return this.store
      .list(filter.state)
      .filter((row) => canSee(access, row.owner))
      .map((row) => ({
        ...this.viewOf(row),
        ...(row.lastActivity && { lastActivity: row.lastActivity }),
        ...(row.pending && { pending: row.pending }),
      }));
  }

  async stop(session: string, mode: "interrupt" | "close", caller?: Caller): Promise<SessionView> {
    const row = this.require(session, resolveAccess(this.config, caller));
    const proc = this.live.get(session);
    if (mode === "interrupt") {
      if ((row.state === "working" || row.state === "waiting") && proc?.session)
        await proc.session.interrupt();
      return this.view(session);
    }
    if (row.state === "closed") return this.view(session);
    this.live.delete(session);
    if (proc) await this.retire(proc);
    this.store.update(session, { state: "closed", pending: null, updatedAt: this.stamp() });
    this.append(session, { type: "note", text: "session closed" });
    return this.view(session);
  }

  async shutdown(): Promise<void> {
    this.usage.stop();
    this.archive?.stop();
    const procs = [...this.live.values()];
    this.live.clear();
    await Promise.all(procs.map((p) => this.retire(p)));
    for (const set of this.waiters.values()) for (const w of [...set]) w();
  }

  private recover(): void {
    for (const row of this.store.list()) {
      if (!["starting", "working", "waiting", "idle"].includes(row.state)) continue;
      this.store.update(row.name, { state: "parked", pending: null, updatedAt: this.stamp() });
      if (row.state !== "idle") {
        this.append(row.name, {
          type: "note",
          text: "switchboard restarted; the last turn was interrupted",
        });
      }
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private require(session: string, access?: Access): SessionRow {
    const found = this.store.get(session);
    const row = found && (!access || canSee(access, found.owner)) ? found : undefined;
    if (!row) {
      const names = access
        ? this.store
            .list()
            .filter((r) => canSee(access, r.owner))
            .map((r) => r.name)
        : this.store.names();
      throw new SwitchboardError(
        `There is no session called ${session}.${names.length ? ` Sessions: ${names.join(", ")}.` : ""}`,
        "not_found",
      );
    }
    return row;
  }

  private viewOf(row: SessionRow): SessionView {
    return {
      session: row.name,
      agent: row.agent,
      workspace: row.workspace,
      title: row.title,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private view(session: string): SessionView {
    return this.viewOf(this.require(session));
  }

  private async ensureCapacity(): Promise<void> {
    if (this.live.size < this.config.max_live_sessions) return;
    let oldest: { name: string; updatedAt: string } | undefined;
    for (const name of this.live.keys()) {
      const row = this.store.get(name);
      if (row?.state !== "idle" || !this.live.get(name)?.session) continue;
      if (!oldest || row.updatedAt < oldest.updatedAt) oldest = { name, updatedAt: row.updatedAt };
    }
    if (!oldest) {
      throw new SwitchboardError(
        `All ${this.config.max_live_sessions} live session slots are busy. Wait for one to finish or close one first.`,
        "capacity",
      );
    }
    await this.park(oldest.name);
  }

  private async park(name: string): Promise<void> {
    const proc = this.live.get(name);
    this.live.delete(name);
    if (proc) await this.retire(proc);
    this.store.update(name, { state: "parked", pending: null, updatedAt: this.stamp() });
  }

  private async retire(proc: Proc): Promise<void> {
    proc.dead = true;
    clearTimeout(proc.parkTimer);
    this.clearNag(proc);
    await proc.session?.close().catch(() => {});
  }

  private clearNag(proc: Proc): void {
    clearTimeout(proc.nagTimer);
    proc.nagTimer = undefined;
  }

  private async resume(row: SessionRow): Promise<void> {
    if (!row.agentSessionId) {
      throw new SwitchboardError(
        `${row.name} cannot be resumed: the agent never reported a conversation id. Start a new session instead.`,
        "bad_input",
      );
    }
    const agent = this.config.agents[row.agent];
    const driver = agent && this.drivers[row.agent];
    if (!agent || !driver) {
      throw new SwitchboardError(
        `The agent ${row.agent} for ${row.name} is no longer configured.`,
        "not_found",
      );
    }
    await this.ensureCapacity();
    this.store.update(row.name, { state: "starting", updatedAt: this.stamp() });
    await this.launch(row.name, driver, {
      cwd: row.cwd,
      model: row.model,
      resume: row.agentSessionId,
      priorCostUsd: row.usage?.costUsd ?? 0,
      appendSystemPrompt: this.systemPrompt(agent),
    });
  }

  private agentHint(): string | undefined {
    if (!this.config.archive?.agent_hint) return undefined;
    return `Past sessions are summarized in ${archiveDir(this.config)} (markdown files plus index.jsonl, newest last). Grep them when earlier work matters.`;
  }

  private systemPrompt(agent: Config["agents"][string]): string | undefined {
    if (agent.driver !== "claude") return undefined;
    return [agent.append_system_prompt, this.agentHint()].filter(Boolean).join("\n\n") || undefined;
  }

  private async launch(name: string, driver: Driver, opts: LaunchOptions, retried = false): Promise<Proc> {
    const proc: Proc = {
      dead: false,
      launch: { driver, opts, startedAt: this.now().getTime(), started: false, retried },
    };
    this.live.set(name, proc);
    try {
      proc.session = await driver.start({
        cwd: opts.cwd,
        ...(opts.model && { model: opts.model }),
        ...(opts.resume && { resume: opts.resume, priorCostUsd: opts.priorCostUsd ?? 0 }),
        ...(opts.appendSystemPrompt && { appendSystemPrompt: opts.appendSystemPrompt }),
        onEvent: (event) => this.onEvent(name, proc, event),
      });
    } catch (err) {
      proc.dead = true;
      this.live.delete(name);
      const row = this.store.get(name);
      this.store.update(name, { state: row?.agentSessionId ? "parked" : "failed", updatedAt: this.stamp() });
      throw new SwitchboardError(`Could not start the agent: ${messageOf(err)}`, "bad_input");
    }
    return proc;
  }

  private shouldRetryLaunch(proc: Proc): boolean {
    const info = proc.launch;
    return (
      !!info &&
      !info.started &&
      !info.retried &&
      proc.turnText !== undefined &&
      this.now().getTime() - info.startedAt <= LAUNCH_RETRY_WINDOW_MS
    );
  }

  private retryLaunch(name: string, old: Proc): void {
    const { driver, opts } = old.launch as LaunchInfo;
    const text = old.turnText as string;
    old.dead = true;
    this.live.delete(name);
    void this.retire(old);
    this.append(name, { type: "note", text: "agent exited at launch; retried" });
    this.launch(name, driver, opts, true)
      .then((proc) => {
        proc.turnText = text;
        return proc.session?.prompt(text);
      })
      .catch((err) => {
        const message = messageOf(err);
        const state = this.store.get(name)?.state;
        if (state === "working" || state === "starting") {
          this.store.update(name, { state: "failed", pending: null, updatedAt: this.stamp() });
        }
        this.append(name, { type: "error", message, fatal: true });
        this.notify(name, "failed", message);
      });
  }

  private async beginTurn(name: string, text: string, agentText = text): Promise<void> {
    const proc = this.live.get(name);
    if (!proc?.session) throw new SwitchboardError(`${name} is not running.`, "busy");
    clearTimeout(proc.parkTimer);
    proc.lastText = undefined;
    proc.turnText = agentText;
    this.append(name, { type: "prompt", text });
    this.store.update(name, { state: "working", pending: null, updatedAt: this.stamp() });
    try {
      await proc.session.prompt(agentText);
    } catch (err) {
      if (proc.launch) proc.launch.started = true;
      this.onEvent(name, proc, { type: "error", message: messageOf(err), fatal: true });
      throw new SwitchboardError(`The agent did not accept the prompt: ${messageOf(err)}`, "busy");
    }
  }

  private append(name: string, data: Parameters<SessionStore["appendEvent"]>[2]): number {
    const seq = this.store.appendEvent(name, this.stamp(), data);
    this.wake(name);
    return seq;
  }

  private wake(name: string): void {
    for (const check of [...(this.waiters.get(name) ?? [])]) check();
  }

  private onEvent(name: string, proc: Proc, event: DriverEvent): void {
    if (proc.dead) return;
    const at = this.stamp();
    if (event.type === "rate_limit") {
      this.usage.noteRateLimit(event, at);
      return;
    }
    if (event.type === "error" && event.fatal && this.shouldRetryLaunch(proc)) {
      this.retryLaunch(name, proc);
      return;
    }
    if (proc.launch && event.type !== "error") proc.launch.started = true;
    const waiting = (this.waiters.get(name)?.size ?? 0) > 0;
    const line = condenseActivity([event])[0];
    const patch = { updatedAt: at, ...(line && { lastActivity: line }) };
    switch (event.type) {
      case "session":
        this.store.update(name, { ...patch, agentSessionId: event.agentSessionId });
        break;
      case "text":
        proc.lastText = event.text;
        this.store.update(name, patch);
        break;
      case "request": {
        this.store.update(name, { ...patch, state: "waiting", pending: event.request });
        if (!waiting) this.notify(name, "waiting", describeRequest(event.request));
        this.armNag(name, proc, event.request.id);
        break;
      }
      case "turn_end": {
        this.clearNag(proc);
        this.store.update(name, { ...patch, state: "idle", pending: null });
        this.store.addTurn(name, event);
        const agent = this.store.get(name)?.agent;
        if (agent) this.usage.recordTurn({ name, agent }, at, event);
        this.armPark(name, proc);
        const reply = event.result ?? proc.lastText ?? "";
        if (!waiting && event.stopReason !== "cancelled") {
          this.notify(name, "done", reply.slice(0, NOTE_CHARS) || "finished");
        }
        break;
      }
      case "error":
        if (event.fatal) {
          this.live.delete(name);
          void this.retire(proc);
          this.store.update(name, { ...patch, state: "failed", pending: null });
          if (!waiting) this.notify(name, "failed", event.message);
        } else {
          this.store.update(name, patch);
        }
        break;
      default:
        this.store.update(name, patch);
    }
    this.append(name, event);
  }

  private armPark(name: string, proc: Proc): void {
    clearTimeout(proc.parkTimer);
    proc.parkTimer = unref(
      setTimeout(() => {
        if (proc.dead || this.store.get(name)?.state !== "idle") return;
        void this.park(name).then(() => this.wake(name));
      }, this.config.idle_park_after),
    );
  }

  private armNag(name: string, proc: Proc, requestId: string): void {
    this.clearNag(proc);
    proc.nagTimer = unref(
      setTimeout(() => {
        const row = this.store.get(name);
        if (proc.dead || row?.state !== "waiting" || row.pending?.id !== requestId) return;
        if ((this.waiters.get(name)?.size ?? 0) > 0) return;
        this.notify(name, "waiting", `still waiting: ${describeRequest(row.pending)}`);
      }, this.config.notify.nag_after),
    );
  }

  private notify(session: string, kind: "done" | "waiting" | "failed", text: string): void {
    const owner = this.store.get(session)?.owner;
    const chat =
      owner && Object.hasOwn(this.config.users, owner) ? this.config.users[owner]?.notify_chat : undefined;
    this.notifier.notify({ session, kind, text, ...(chat && { chat }) }).catch((err) => {
      console.error(`switchboard: notifier failed: ${messageOf(err)}`);
    });
  }

  private attention(row: SessionRow, events: StoredEvent[]): boolean {
    if (row.state === "waiting") return true;
    return events.some((e) => e.data.type === "turn_end" || (e.data.type === "error" && e.data.fatal));
  }

  private ready(session: string, cursor: number): boolean {
    const row = this.store.get(session);
    if (!row) return true;
    const events = this.store.eventsAfter(session, cursor);
    if (this.attention(row, events)) return true;
    return events.length > 0 && row.state !== "working" && row.state !== "starting";
  }

  private waitResult(session: string, cursor: number): WaitResult {
    const row = this.require(session);
    const events = this.store.eventsAfter(session, cursor);
    const turnEnd = [...events].reverse().find((e) => e.data.type === "turn_end");
    let reply: string | undefined;
    if (turnEnd?.data.type === "turn_end") {
      const before = events.filter((e) => e.seq < turnEnd.seq).map((e) => e.data);
      const lastText = [...before].reverse().find((d) => d.type === "text");
      reply = turnEnd.data.result ?? (lastText?.type === "text" ? lastText.text : undefined);
    }
    const fatal = [...events].reverse().find((e) => e.data.type === "error" && e.data.fatal);
    const error = row.state === "failed" && fatal?.data.type === "error" ? fatal.data.message : undefined;
    return {
      session,
      state: row.state,
      cursor: this.store.lastSeq(session),
      activity: condenseActivity(events.map((e) => e.data)),
      ...(row.state === "waiting" && row.pending && { pending: row.pending }),
      ...(reply && { reply }),
      ...(error && { error }),
    };
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
