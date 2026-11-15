import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { type ClaudeProbeResult, probeClaudeUsage } from "../drivers/claude-usage.js";
import type { DriverEvent } from "../drivers/driver.js";
import type {
  AgentInfo,
  AgentUsage,
  ClaudePlan,
  OllamaUsage,
  PlanStatus,
  PlanWindow,
  SessionUsage,
  UsageSnapshot,
  UsageTotals,
} from "../types.js";
import type { SessionRow } from "./store.js";

export const OLLAMA_REFRESH_MS = 600_000;
export const PROBE_AFTER_MS = 900_000;
const OLLAMA_BASE = "https://ollama.com";
const DAY_MS = 86_400_000;
const KEEP_TURNS_DAYS = 30;
const SESSIONS_SHOWN = 20;
const CLAUDE_STATE = "claude_plan";

type TurnEnd = Extract<DriverEvent, { type: "turn_end" }>;
type RateLimit = Extract<DriverEvent, { type: "rate_limit" }>;

interface StoredWindow {
  utilization?: number;
  resetsAt?: string;
  status: PlanStatus;
  seenAt: string;
  source: "session" | "probe";
}

interface PlanState {
  subscriptionType?: string;
  unavailable?: boolean;
  windows: Record<string, StoredWindow>;
  lastEventAt?: string;
  lastProbeAt?: string;
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "7-day",
  seven_day_opus: "7-day Opus",
  seven_day_sonnet: "7-day Sonnet",
  seven_day_overage_included: "7-day (overage included)",
  overage: "overage",
};
const WINDOW_ORDER = Object.keys(WINDOW_LABELS);

export function windowLabel(window: string): string {
  return WINDOW_LABELS[window] ?? (window.startsWith("model:") ? `7-day ${window.slice(6)}` : window);
}

/** The probe reports no status, so derive one from the utilization. */
function statusFor(utilization: number | undefined): PlanStatus {
  if (utilization === undefined) return "allowed";
  return utilization >= 1 ? "rejected" : utilization >= 0.8 ? "warning" : "allowed";
}

const zero = (): UsageTotals => ({ costUsd: 0, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function addTo(total: UsageTotals, row: Partial<UsageTotals>): void {
  total.costUsd += row.costUsd ?? 0;
  total.turns += row.turns ?? 0;
  total.input += row.input ?? 0;
  total.output += row.output ?? 0;
  total.cacheRead += row.cacheRead ?? 0;
  total.cacheWrite += row.cacheWrite ?? 0;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isoDay(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const t = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * /api/usage is undocumented, so read it defensively: find the array of
 * objects carrying a numeric `request_count`, whichever key holds it.
 */
export function parseOllamaUsage(
  body: unknown,
): { days: OllamaUsage["days"]; totalRequests?: number } | undefined {
  const isBucket = (o: unknown): o is Record<string, unknown> =>
    !!o && typeof o === "object" && typeof (o as Record<string, unknown>).request_count === "number";
  const root = body as Record<string, unknown> | unknown[] | null;
  const list = Array.isArray(root)
    ? root
    : root && typeof root === "object"
      ? Object.values(root).find((v): v is unknown[] => Array.isArray(v) && v.some(isBucket))
      : undefined;
  if (!list) return undefined;
  const byDay = new Map<string, number>();
  for (const b of list.filter(isBucket)) {
    const key =
      ["date", "day", "start", "start_time", "timestamp", "time", "period"]
        .map((k) => isoDay(b[k]))
        .find((d) => d !== undefined) ?? "";
    byDay.set(key, (byDay.get(key) ?? 0) + (b.request_count as number));
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, requests]) => ({ date, requests }));
  let totalRequests: number | undefined;
  if (root && !Array.isArray(root)) {
    const total =
      root.total_requests ?? root.request_count ?? (root.total as Record<string, unknown> | undefined);
    if (typeof total === "number") totalRequests = total;
    else if (isBucket(total)) totalRequests = total.request_count as number;
  }
  return { days, totalRequests: totalRequests ?? days.reduce((n, d) => n + d.requests, 0) };
}

export interface UsageServiceOptions {
  config: Config;
  db: Db;
  now?: () => Date;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** EXPERIMENTAL plan probe; defaults to the SDK's usage request when `[usage.claude] probe = true`. */
  probe?: () => Promise<ClaudeProbeResult>;
  log?: (message: string) => void;
}

export class UsageService {
  private readonly config: Config;
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly fetchFn: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly probe: (() => Promise<ClaudeProbeResult>) | undefined;
  private readonly log: (message: string) => void;
  private plan: PlanState;
  private ollamaState: OllamaUsage | undefined;
  private ollamaAttemptAt = 0;
  private probeAttemptAt = 0;
  private ollamaBusy: Promise<void> | undefined;
  private probeBusy: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: UsageServiceOptions) {
    this.config = options.config;
    this.db = options.db;
    this.now = options.now ?? (() => new Date());
    this.fetchFn = options.fetch ?? fetch;
    this.env = options.env ?? process.env;
    this.log = options.log ?? ((m) => console.error(`[switchboard] ${m}`));
    this.probe = options.probe ?? this.defaultProbe();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_turns (
        session TEXT NOT NULL,
        agent TEXT NOT NULL,
        at TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        input INTEGER NOT NULL,
        output INTEGER NOT NULL,
        cache_read INTEGER NOT NULL,
        cache_write INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_turns_at ON usage_turns (at);
      CREATE TABLE IF NOT EXISTS usage_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.plan = this.loadPlan();
    if (this.config.usage.ollama) this.ollamaState = { days: [] };
  }

  private defaultProbe(): (() => Promise<ClaudeProbeResult>) | undefined {
    if (!this.config.usage.claude?.probe) return undefined;
    const agent = Object.values(this.config.agents).find((a) => a.driver === "claude" && !a.run_as);
    if (agent?.driver !== "claude") return undefined;
    return () => probeClaudeUsage({ ...(agent.executable ? { executable: agent.executable } : {}) });
  }

  start(): void {
    if (this.timer || (!this.config.usage.ollama && !this.probe)) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), OLLAMA_REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Refreshes whatever is stale in the background; never throws and never blocks. */
  tick(): void {
    const at = this.now().getTime();
    if (this.config.usage.ollama && at - this.ollamaAttemptAt >= OLLAMA_REFRESH_MS) void this.refreshOllama();
    if (this.probe && this.claudeNeedsProbe(at)) void this.probeClaude();
  }

  private claudeNeedsProbe(at: number): boolean {
    const seen = Math.max(
      Date.parse(this.plan.lastEventAt ?? "") || 0,
      Date.parse(this.plan.lastProbeAt ?? "") || 0,
      this.probeAttemptAt,
    );
    return at - seen >= PROBE_AFTER_MS;
  }

  recordTurn(session: { name: string; agent: string }, at: string, event: TurnEnd): void {
    if (event.costUsd === undefined && !event.tokens) return;
    const t = event.tokens;
    this.db
      .prepare(
        "INSERT INTO usage_turns (session, agent, at, cost_usd, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.name,
        session.agent,
        at,
        event.costUsd ?? 0,
        t?.input ?? 0,
        t?.output ?? 0,
        t?.cacheRead ?? 0,
        t?.cacheWrite ?? 0,
      );
    const cutoff = new Date(this.now().getTime() - KEEP_TURNS_DAYS * DAY_MS).toISOString();
    this.db.prepare("DELETE FROM usage_turns WHERE at < ?").run(cutoff);
  }

  noteRateLimit(event: RateLimit, at: string): void {
    const previous = this.plan.windows[event.window];
    const sameCycle = previous && (!event.resetsAt || previous.resetsAt === event.resetsAt);
    const utilization = event.utilization ?? (sameCycle ? previous.utilization : undefined);
    const resetsAt = event.resetsAt ?? (sameCycle ? previous.resetsAt : undefined);
    this.plan.windows[event.window] = {
      status: event.status,
      seenAt: at,
      source: "session",
      ...(utilization !== undefined && { utilization }),
      ...(resetsAt && { resetsAt }),
    };
    this.plan.lastEventAt = at;
    this.plan.unavailable = false;
    this.savePlan();
  }

  /** EXPERIMENTAL: see probeClaudeUsage. Failures are logged and ignored. */
  probeClaude(): Promise<void> {
    if (!this.probe) return Promise.resolve();
    this.probeBusy ??= this.runProbe(this.probe).finally(() => {
      this.probeBusy = undefined;
    });
    return this.probeBusy;
  }

  private async runProbe(probe: () => Promise<ClaudeProbeResult>): Promise<void> {
    this.probeAttemptAt = this.now().getTime();
    try {
      const res = await probe();
      const at = this.now().toISOString();
      if (res.subscriptionType) this.plan.subscriptionType = res.subscriptionType;
      this.plan.unavailable = !res.available;
      for (const w of res.windows) {
        this.plan.windows[w.window] = {
          status: statusFor(w.utilization),
          seenAt: at,
          source: "probe",
          ...(w.utilization !== undefined && { utilization: w.utilization }),
          ...(w.resetsAt && { resetsAt: w.resetsAt }),
        };
      }
      this.plan.lastProbeAt = at;
      this.savePlan();
    } catch (err) {
      this.log(`claude usage probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  refreshOllama(): Promise<void> {
    if (!this.config.usage.ollama) return Promise.resolve();
    this.ollamaBusy ??= this.fetchOllama(this.config.usage.ollama.api_key_env).finally(() => {
      this.ollamaBusy = undefined;
    });
    return this.ollamaBusy;
  }

  /** Only `Plan` is taken from /api/me; the rest of that payload (email, name, ids) is never kept. */
  private async fetchOllama(keyEnv: string): Promise<void> {
    this.ollamaAttemptAt = this.now().getTime();
    const previous = this.ollamaState ?? { days: [] };
    const key = this.env[keyEnv];
    if (!key) {
      this.ollamaState = { ...previous, error: `${keyEnv} is not set` };
      return;
    }
    const get = async (path: string): Promise<unknown> => {
      const res = await this.fetchFn(`${OLLAMA_BASE}${path}`, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json();
    };
    const [me, usage] = await Promise.allSettled([get("/api/me"), get("/api/usage")]);
    const errors: string[] = [];
    const next: OllamaUsage = { ...previous };
    delete next.error;
    if (me.status === "fulfilled") {
      const plan = (me.value as { Plan?: unknown } | null)?.Plan;
      if (typeof plan === "string" && plan.trim()) next.plan = plan.trim().slice(0, 40);
    } else errors.push(me.reason instanceof Error ? me.reason.message : "/api/me failed");
    if (usage.status === "fulfilled") {
      const parsed = parseOllamaUsage(usage.value);
      if (parsed) {
        next.days = parsed.days;
        if (parsed.totalRequests !== undefined) next.totalRequests = parsed.totalRequests;
      } else errors.push("/api/usage: unrecognised response");
    } else errors.push(usage.reason instanceof Error ? usage.reason.message : "/api/usage failed");
    if (errors.length < 2) next.fetchedAt = this.now().toISOString();
    if (errors.length) next.error = errors.join("; ");
    this.ollamaState = next;
  }

  ollama(): OllamaUsage | undefined {
    return this.ollamaState;
  }

  claudePlan(): ClaudePlan {
    const at = this.now().getTime();
    const windows: PlanWindow[] = Object.entries(this.plan.windows)
      .filter(([, w]) => !w.resetsAt || Date.parse(w.resetsAt) > at)
      .map(([window, w]) => ({ window, label: windowLabel(window), ...w }))
      .sort((a, b) => {
        const ia = WINDOW_ORDER.indexOf(a.window);
        const ib = WINDOW_ORDER.indexOf(b.window);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.window.localeCompare(b.window);
      });
    const latest = Object.values(this.plan.windows).sort((a, b) => b.seenAt.localeCompare(a.seenAt))[0];
    return {
      windows,
      probe: !!this.probe,
      ...(this.plan.subscriptionType && { subscriptionType: this.plan.subscriptionType }),
      ...(latest && { lastSeenAt: latest.seenAt, source: latest.source }),
      ...(this.plan.unavailable && windows.length === 0 && { unavailable: true }),
    };
  }

  /** One line the MCP client can steer by; only the providers the caller can actually use. */
  hint(scope: { claude: boolean; ollama: boolean }): string | undefined {
    const parts: string[] = [];
    if (scope.claude) {
      const plan = this.claudePlan();
      const shown = ["five_hour", "seven_day"]
        .map((id) => plan.windows.find((w) => w.window === id))
        .filter((w): w is PlanWindow => !!w && w.utilization !== undefined);
      if (shown.length) {
        const weekly = shown.find((w) => w.window === "seven_day");
        const resets = weekly?.resetsAt
          ? ` (resets ${new Date(weekly.resetsAt).toLocaleDateString("en-US", { weekday: "short" })})`
          : "";
        const limited = plan.windows.some((w) => w.status === "rejected") ? " — limit reached" : "";
        parts.push(
          `Claude plan: ${shown.map((w) => `${w.label} ${Math.round((w.utilization ?? 0) * 100)}%`).join(", ")}${resets}${limited}`,
        );
      }
    }
    const ollama = scope.ollama ? this.ollamaState : undefined;
    if (ollama?.fetchedAt) {
      const bits = [
        ...(ollama.plan ? [capitalize(ollama.plan)] : []),
        ...(ollama.totalRequests !== undefined ? [`${ollama.totalRequests} requests this week`] : []),
      ];
      if (bits.length) parts.push(`Ollama: ${bits.join(", ")}`);
    }
    return parts.length ? `Usage: ${parts.join("; ")}` : undefined;
  }

  snapshot(input: {
    agents: Pick<AgentInfo, "id" | "driver">[];
    rows: SessionRow[];
    includeClaude: boolean;
    includeOllama: boolean;
  }): UsageSnapshot {
    const at = this.now();
    const midnight = new Date(at).setHours(0, 0, 0, 0);
    const weekStart = at.getTime() - 7 * DAY_MS;
    const visible = new Set(input.rows.map((r) => r.name));
    const agents = new Map<string, AgentUsage>(
      input.agents.map((a) => [
        a.id,
        { agent: a.id, driver: a.driver, today: zero(), week: zero(), total: zero() },
      ]),
    );
    const sessions = new Map<string, SessionUsage>();
    const eligible = input.rows
      .filter((r) => r.usage && (r.usage.turns > 0 || r.usage.costUsd > 0))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const r of eligible) {
      addTo(agents.get(r.agent)?.total ?? zero(), r.usage as UsageTotals);
      if (sessions.size < SESSIONS_SHOWN) {
        sessions.set(r.name, {
          name: r.name,
          agent: r.agent,
          title: r.title,
          today: zero(),
          week: zero(),
          total: { ...(r.usage as UsageTotals) },
        });
      }
    }
    const turns = this.db
      .prepare(
        "SELECT session, agent, at, cost_usd, input, output, cache_read, cache_write FROM usage_turns WHERE at >= ?",
      )
      .all(new Date(weekStart).toISOString());
    for (const t of turns) {
      if (!visible.has(t.session as string)) continue;
      const row: Partial<UsageTotals> = {
        costUsd: t.cost_usd as number,
        turns: 1,
        input: t.input as number,
        output: t.output as number,
        cacheRead: t.cache_read as number,
        cacheWrite: t.cache_write as number,
      };
      const isToday = Date.parse(t.at as string) >= midnight;
      for (const target of [agents.get(t.agent as string), sessions.get(t.session as string)]) {
        if (!target) continue;
        addTo(target.week, row);
        if (isToday) addTo(target.today, row);
      }
    }
    return {
      ...(input.includeClaude && { claude: this.claudePlan() }),
      ...(input.includeOllama && this.ollamaState && { ollama: this.ollamaState }),
      agents: [...agents.values()],
      sessions: [...sessions.values()],
    };
  }

  private loadPlan(): PlanState {
    try {
      const row = this.db.prepare("SELECT value FROM usage_state WHERE key = ?").get(CLAUDE_STATE);
      if (row) return JSON.parse(row.value as string) as PlanState;
    } catch {}
    return { windows: {} };
  }

  private savePlan(): void {
    this.db
      .prepare(
        "INSERT INTO usage_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(CLAUDE_STATE, JSON.stringify(this.plan));
  }
}
