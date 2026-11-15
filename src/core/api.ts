import type {
  AgentInfo,
  DashboardSessionDetail,
  DashboardSnapshot,
  SessionState,
  SessionSummary,
  SessionView,
  WaitResult,
  WorkspaceInfo,
} from "../types.js";

export interface StartInput {
  prompt: string;
  agent?: string;
  workspace?: string;
  model?: string;
  title?: string;
}

/** Who is calling. No email (stdio, auth none) means the unrestricted household admin. */
export type Caller = { email?: string };

/** What the MCP tools need from the core. Errors are thrown as `SwitchboardError` with a speakable message. */
export interface SessionManagerApi {
  agents(caller?: Caller): AgentInfo[];
  workspaces(caller?: Caller): WorkspaceInfo[];
  /** Spawns the agent and sends the first prompt; returns as soon as the turn is running. */
  start(input: StartInput, caller?: Caller): Promise<SessionView>;
  /** Next turn. Resumes a parked or failed session first. Throws if a turn is running or a request is pending. */
  send(session: string, message: string, caller?: Caller): Promise<SessionView>;
  /**
   * Answer the pending request. `answer` is what the user said: an option label (case-insensitive),
   * an option number ("2"), "allow"/"yes"/"deny"/"no"/"always" for approvals, or free text.
   */
  respond(session: string, requestId: string, answer: string, caller?: Caller): Promise<SessionView>;
  /**
   * Long-poll. Resolves as soon as something needs attention (request pending, turn ended, failed) or after
   * maxWaitMs, with everything since `cursor` (default: the start of the current turn).
   */
  wait(session: string, opts?: { cursor?: number; maxWaitMs?: number }, caller?: Caller): Promise<WaitResult>;
  list(filter?: { state?: SessionState }, caller?: Caller): SessionSummary[];
  /** One line about plan usage for the agents the caller can use, when known. */
  usageHint?(caller?: Caller): string | undefined;
  stop(session: string, mode: "interrupt" | "close", caller?: Caller): Promise<SessionView>;
  shutdown(): Promise<void>;
}

/** Read-only views for the dashboard; honours the same access policy as the tools. */
export interface DashboardApi {
  snapshot(caller?: Caller): DashboardSnapshot;
  /** Starts a background refresh of stale plan usage; returns immediately. */
  touchUsage?(): void;
  /** Without `since`: the newest `limit` events. With it: events after that seq, oldest first. */
  detail(session: string, opts?: { since?: number; limit?: number }, caller?: Caller): DashboardSessionDetail;
}

export class SwitchboardError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "busy"
      | "no_pending_request"
      | "bad_answer"
      | "bad_input"
      | "capacity"
      | "closed" = "bad_input",
  ) {
    super(message);
    this.name = "SwitchboardError";
  }
}
