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

export interface AgentInfo {
  id: string;
  driver: "claude" | "acp" | "fake";
  model?: string;
  default: boolean;
}

export interface WorkspaceInfo {
  id: string;
  path: string;
  default: boolean;
}
