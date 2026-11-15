export type SessionState = "starting" | "working" | "waiting" | "idle" | "parked" | "failed" | "closed";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export type ApprovalOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface ApprovalOption {
  id: string;
  label: string;
  kind: ApprovalOptionKind;
}

export type PendingRequest =
  | { id: string; kind: "question"; questions: Question[] }
  | {
      id: string;
      kind: "approval";
      tool: string;
      summary: string;
      input?: unknown;
      options: ApprovalOption[];
    };

/** Answers are keyed by question text; multi-select questions take an array of labels. */
export type Answer =
  | { kind: "question"; answers: Record<string, string | string[]>; note?: string }
  | { kind: "approval"; optionId: string; message?: string };

export type StopReason = "end_turn" | "cancelled" | "max_tokens" | "refusal" | "error";

export interface SessionView {
  session: string;
  agent: string;
  workspace: string;
  title: string;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
}

export interface WaitResult {
  session: string;
  state: SessionState;
  cursor: number;
  /** Condensed, speakable lines about what happened since the cursor, oldest first. */
  activity: string[];
  pending?: PendingRequest;
  /** Final assistant text of a turn that ended since the cursor. */
  reply?: string;
  error?: string;
}

export interface SessionSummary extends SessionView {
  lastActivity?: string;
  pending?: PendingRequest;
}

export interface ModelInfo {
  id: string;
  label?: string;
  description?: string;
  /** USD per million tokens, list price for comparison. */
  inputPrice?: number;
  outputPrice?: number;
  notes?: string;
  default: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentInfo {
  id: string;
  driver: "claude" | "acp" | "fake";
  model?: string;
  description?: string;
  models?: ModelInfo[];
  default: boolean;
}

export interface WorkspaceInfo {
  id: string;
  path: string;
  description?: string;
  default: boolean;
}

export interface DashboardAgent extends Omit<AgentInfo, "models"> {
  runAs?: string;
  live: number;
  liveSessions: string[];
}

export interface DashboardSession extends Omit<SessionView, "session"> {
  name: string;
  cwd: string;
  model?: string;
  owner?: string;
  live: boolean;
  lastActivity?: string;
  activity: string[];
  pending?: PendingRequest;
}

export type PlanStatus = "allowed" | "warning" | "rejected";

export interface PlanWindow {
  window: string;
  label: string;
  /** 0..1 */
  utilization?: number;
  resetsAt?: string;
  status: PlanStatus;
  seenAt: string;
  source: "session" | "probe";
}

export interface ClaudePlan {
  subscriptionType?: string;
  windows: PlanWindow[];
  lastSeenAt?: string;
  source?: "session" | "probe";
  /** The probe is enabled in the config. */
  probe: boolean;
  /** A probe found that plan limits do not apply (API key, Bedrock, ...). */
  unavailable?: boolean;
}

export interface UsageTotals extends TokenUsage {
  costUsd: number;
  turns: number;
}

export interface AgentUsage {
  agent: string;
  driver: AgentInfo["driver"];
  today: UsageTotals;
  week: UsageTotals;
  total: UsageTotals;
}

export interface SessionUsage {
  name: string;
  agent: string;
  title: string;
  today: UsageTotals;
  week: UsageTotals;
  total: UsageTotals;
}

export interface OllamaUsage {
  plan?: string;
  days: { date: string; requests: number }[];
  totalRequests?: number;
  fetchedAt?: string;
  error?: string;
}

export interface UsageSnapshot {
  claude?: ClaudePlan;
  ollama?: OllamaUsage;
  agents: AgentUsage[];
  sessions: SessionUsage[];
}

export interface DashboardSnapshot {
  viewer: { email?: string; restricted: boolean };
  agents: DashboardAgent[];
  catalog: Record<string, ModelInfo[]>;
  usage: UsageSnapshot;
  workspaces: WorkspaceInfo[];
  sessions: DashboardSession[];
  counts: { total: number; live: number; maxLive: number; byState: Record<SessionState, number> };
}

export interface DashboardEvent {
  seq: number;
  at: string;
  event: unknown;
}

export interface DashboardSessionDetail {
  session: DashboardSession;
  events: DashboardEvent[];
  lastSeq: number;
  hasMore: boolean;
  truncated: boolean;
}
