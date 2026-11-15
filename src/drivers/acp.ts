import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Answer, ApprovalOption, PendingRequest, Question, StopReason } from "../types.js";
import type { AgentSession, Driver, DriverEvent, DriverStartOptions } from "./driver.js";

export interface AcpDriverOptions {
  command: string[];
  env?: Record<string, string>;
  model?: string;
}

const STOP_REASONS: Record<acp.StopReason, StopReason> = {
  end_turn: "end_turn",
  cancelled: "cancelled",
  max_tokens: "max_tokens",
  max_turn_requests: "max_tokens",
  refusal: "refusal",
};

const TOOL_STATUS = {
  pending: "pending",
  in_progress: "running",
  completed: "done",
  failed: "failed",
} as const;

type ToolStatus = (typeof TOOL_STATUS)[acp.ToolCallStatus];

interface FormField {
  key: string;
  question: string;
  multiSelect: boolean;
  type: "string" | "number" | "integer" | "boolean" | "array";
  options: { label: string; value: string | boolean }[];
}

type Pending =
  | { kind: "approval"; options: ApprovalOption[]; settle: (r: acp.RequestPermissionResponse) => void }
  | { kind: "question"; fields: FormField[]; settle: (r: acp.CreateElicitationResponse) => void };

const CANCEL_APPROVAL: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
const CANCEL_ELICITATION: acp.CreateElicitationResponse = { action: "cancel" };

export class AcpDriver implements Driver {
  readonly kind = "acp" as const;

  constructor(private readonly opts: AcpDriverOptions) {}

  async start(options: DriverStartOptions): Promise<AgentSession> {
    const session = new AcpSession(this.opts, options);
    try {
      await session.open();
    } catch (err) {
      await session.close();
      throw err;
    }
    return session;
  }
}

class AcpSession implements AgentSession {
  private child: ChildProcess;
  private conn!: acp.ClientConnection;
  private sessionId: string | null = null;
  private replaying = false;
  private closing = false;
  private dead = false;
  private turnActive = false;
  private nextId = 0;
  private chunks = "";
  private turnText: string[] = [];
  private tools = new Map<string, { title: string; status: ToolStatus }>();
  private pending = new Map<string, Pending>();
  private exited: Promise<void>;
  private spawnFailure: Promise<never>;

  constructor(
    private readonly opts: AcpDriverOptions,
    private readonly start: DriverStartOptions,
  ) {
    const [cmd, ...args] = opts.command as [string, ...string[]];
    this.child = spawn(cmd, args, {
      cwd: start.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.child.stdin?.on("error", () => {});
    this.spawnFailure = new Promise<never>((_, reject) => {
      this.child.once("error", (err) => reject(new Error(`cannot start ${cmd}: ${err.message}`)));
    });
    this.spawnFailure.catch(() => {});
    this.exited = new Promise<void>((resolve) => {
      this.child.once("exit", (code, signal) => {
        resolve();
        if (this.closing || this.dead) return;
        this.dead = true;
        this.pending.clear();
        this.emit({
          type: "error",
          message: `agent process exited (${signal ?? `code ${code}`})`,
          fatal: true,
        });
      });
      this.child.once("error", () => resolve());
    });
  }

  async open(): Promise<void> {
    const { child } = this;
    if (!child.stdin || !child.stdout) throw new Error("agent process has no stdio");
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    this.conn = acp
      .client({ name: "switchboard" })
      .onNotification(acp.methods.client.session.update, ({ params }) => this.onUpdate(params))
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => this.onPermission(params))
      .onRequest(acp.methods.client.elicitation.create, ({ params }) => this.onElicitation(params))
      .connect(stream);
    this.conn.closed.catch(() => {});

    await Promise.race([this.spawnFailure, this.handshake()]);
  }

  private async handshake(): Promise<void> {
    const agent = this.conn.agent;
    const init = await agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: "switchboard", version: "0.1.0" },
    });
    const caps = init.agentCapabilities;
    const cwd = this.start.cwd;

    let configOptions: acp.SessionConfigOption[] | null | undefined;
    const resume = this.start.resume;
    if (!resume) {
      const res = await agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      this.sessionId = res.sessionId;
      configOptions = res.configOptions;
    } else if (caps?.sessionCapabilities?.resume) {
      this.sessionId = resume;
      configOptions = (
        await agent.request(acp.methods.agent.session.resume, { sessionId: resume, cwd, mcpServers: [] })
      ).configOptions;
    } else if (caps?.loadSession) {
      this.sessionId = resume;
      this.replaying = true;
      try {
        const res = await agent.request(acp.methods.agent.session.load, {
          sessionId: resume,
          cwd,
          mcpServers: [],
        });
        configOptions = res?.configOptions;
      } finally {
        this.replaying = false;
      }
    } else {
      throw new Error("agent supports neither session/resume nor session/load; cannot resume a conversation");
    }
    this.emit({ type: "session", agentSessionId: this.sessionId as string });
    await this.applyModel(configOptions);
  }

  private async applyModel(configOptions: acp.SessionConfigOption[] | null | undefined): Promise<void> {
    const wanted = this.start.model ?? this.opts.model;
    if (!wanted || !this.sessionId) return;
    const option = configOptions?.find(
      (o) => o.type === "select" && (o.category === "model" || o.id === "model"),
    );
    if (option?.type !== "select") return;
    const choices = option.options.flatMap((o) => ("options" in o ? o.options : [o]));
    const match = choices.find((c) => c.value === wanted) ?? choices.find((c) => c.name === wanted);
    if (!match || match.value === option.currentValue) return;
    try {
      await this.conn.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: this.sessionId,
        configId: option.id,
        value: match.value,
      });
    } catch {}
  }

  private emit(event: DriverEvent): void {
    this.start.onEvent(event);
  }

  private flushText(): void {
    const text = this.chunks.trim();
    this.chunks = "";
    if (!text) return;
    this.turnText.push(text);
    this.emit({ type: "text", text });
  }

  private onUpdate(n: acp.SessionNotification): void {
    if (this.replaying || n.sessionId !== this.sessionId) return;
    const u = n.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content.type === "text") this.chunks += u.content.text;
        break;
      case "tool_call":
        this.flushText();
        this.tool(u.toolCallId, u.title, u.status ?? "pending");
        break;
      case "tool_call_update": {
        const known = this.tools.get(u.toolCallId);
        if (!known && !u.title) break;
        this.tool(u.toolCallId, u.title ?? known?.title ?? u.toolCallId, u.status ?? null);
        break;
      }
      case "plan":
        this.emit({
          type: "plan",
          entries: u.entries.map((e) => ({ content: e.content, status: e.status })),
        });
        break;
    }
  }

  private tool(id: string, title: string, status: acp.ToolCallStatus | null): void {
    const known = this.tools.get(id);
    const next: ToolStatus = status ? TOOL_STATUS[status] : (known?.status ?? "pending");
    if (known && known.title === title && known.status === next) return;
    this.tools.set(id, { title, status: next });
    this.emit({ type: "tool", id, title, status: next });
  }

  private park<R>(
    make: (id: string, settle: (r: R) => void) => { request: PendingRequest; entry: Pending },
  ): Promise<R> {
    return new Promise<R>((resolve) => {
      const id = `req-${++this.nextId}`;
      const { request, entry } = make(id, (r) => {
        this.pending.delete(id);
        resolve(r);
      });
      this.pending.set(id, entry);
      this.flushText();
      this.emit({ type: "request", request });
    });
  }

  private onPermission(p: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const title = p.toolCall.title ?? (p as { title?: string }).title;
    const options: ApprovalOption[] = p.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind }));
    return this.park<acp.RequestPermissionResponse>((id, settle) => ({
      request: {
        id,
        kind: "approval",
        tool: title ?? p.toolCall.kind ?? "tool",
        summary: title ?? p.toolCall.kind ?? "permission requested",
        ...(p.toolCall.rawInput === undefined ? {} : { input: p.toolCall.rawInput }),
        options,
      },
      entry: { kind: "approval", options, settle },
    }));
  }

  private onElicitation(p: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
    if (p.mode !== "form") return Promise.resolve({ action: "decline" });
    const schema = (p as { requestedSchema?: acp.ElicitationSchema }).requestedSchema;
    const fields = formFields(p.message, schema);
    if (fields.length === 0) return Promise.resolve({ action: "decline" });
    const questions: Question[] = fields.map((f) => ({
      question: f.question,
      options: f.options.map((o) => ({ label: o.label })),
      multiSelect: f.multiSelect,
    }));
    return this.park<acp.CreateElicitationResponse>((id, settle) => ({
      request: { id, kind: "question", questions },
      entry: { kind: "question", fields, settle },
    }));
  }

  async prompt(text: string): Promise<void> {
    if (this.dead || this.closing) throw new Error("agent session is closed");
    if (this.turnActive) throw new Error("a turn is already running");
    this.turnActive = true;
    this.turnText = [];
    this.conn.agent
      .request(acp.methods.agent.session.prompt, {
        sessionId: this.sessionId as string,
        prompt: [{ type: "text", text }],
      })
      .then(
        (res) => {
          this.flushText();
          const result = this.turnText.join("\n\n");
          this.turnActive = false;
          this.emit({
            type: "turn_end",
            stopReason: STOP_REASONS[res.stopReason] ?? "end_turn",
            ...(result ? { result } : {}),
          });
        },
        (err: unknown) => {
          this.turnActive = false;
          if (this.dead || this.closing) return;
          this.flushText();
          this.emit({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            fatal: false,
          });
          this.emit({ type: "turn_end", stopReason: "error" });
        },
      );
  }

  async respond(requestId: string, answer: Answer): Promise<void> {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error(`no pending request ${requestId}`);
    if (entry.kind === "approval") {
      if (answer.kind !== "approval") throw new Error("expected an approval answer");
      if (!entry.options.some((o) => o.id === answer.optionId))
        throw new Error(`unknown option ${answer.optionId}`);
      entry.settle({ outcome: { outcome: "selected", optionId: answer.optionId } });
      return;
    }
    if (answer.kind !== "question") throw new Error("expected a question answer");
    entry.settle({ action: "accept", content: formContent(entry.fields, answer.answers) });
  }

  async interrupt(): Promise<void> {
    if (this.dead || !this.turnActive || !this.sessionId) return;
    await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
    for (const entry of [...this.pending.values()]) {
      if (entry.kind === "approval") entry.settle(CANCEL_APPROVAL);
      else entry.settle(CANCEL_ELICITATION);
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.pending.clear();
    const { child } = this;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.conn?.close();
      return;
    }
    child.stdin?.end();
    child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await this.exited;
    clearTimeout(killer);
    this.conn?.close();
  }
}

function formFields(message: string, schema: acp.ElicitationSchema | undefined): FormField[] {
  const entries = Object.entries(schema?.properties ?? {});
  return entries.flatMap(([key, prop]): FormField[] => {
    const p = prop as acp.ElicitationPropertySchema & Record<string, unknown>;
    const title = (p.title as string | undefined) ?? undefined;
    const description = (p.description as string | undefined) ?? undefined;
    const question = entries.length === 1 ? message : (title ?? description ?? key);
    switch (p.type) {
      case "string": {
        const oneOf = p.oneOf as { const: string; title: string }[] | undefined;
        const values = p.enum as string[] | undefined;
        const options = oneOf
          ? oneOf.map((o) => ({ label: o.title, value: o.const }))
          : (values ?? []).map((v) => ({ label: v, value: v }));
        return [{ key, question, multiSelect: false, type: "string", options }];
      }
      case "number":
      case "integer":
        return [{ key, question, multiSelect: false, type: p.type, options: [] }];
      case "boolean":
        return [
          {
            key,
            question,
            multiSelect: false,
            type: "boolean",
            options: [
              { label: "yes", value: true },
              { label: "no", value: false },
            ],
          },
        ];
      case "array": {
        const items = (p.items ?? {}) as { enum?: string[]; anyOf?: { const: string; title: string }[] };
        const options = items.anyOf
          ? items.anyOf.map((o) => ({ label: o.title, value: o.const }))
          : (items.enum ?? []).map((v) => ({ label: v, value: v }));
        return [{ key, question, multiSelect: true, type: "array", options }];
      }
      default:
        return [];
    }
  });
}

function formContent(
  fields: FormField[],
  answers: Record<string, string | string[]>,
): Record<string, acp.ElicitationContentValue> {
  const content: Record<string, acp.ElicitationContentValue> = {};
  for (const f of fields) {
    const raw = answers[f.question];
    if (raw === undefined) continue;
    const toValue = (label: string) => f.options.find((o) => o.label === label)?.value ?? label;
    if (f.type === "array") {
      content[f.key] = (Array.isArray(raw) ? raw : [raw]).map((l) => String(toValue(l)));
      continue;
    }
    const label = Array.isArray(raw) ? (raw[0] ?? "") : raw;
    const value = toValue(label);
    if (f.type === "boolean")
      content[f.key] = typeof value === "boolean" ? value : /^(y|yes|true)$/i.test(label.trim());
    else if (f.type === "number" || f.type === "integer") content[f.key] = Number(label);
    else content[f.key] = String(value);
  }
  return content;
}
