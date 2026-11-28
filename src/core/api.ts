import type {
  AgentInfo,
  DashboardSessionDetail,
  DashboardSnapshot,
  HistoryQuery,
  HistoryResult,
  RefreshReport,
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
  /** Search live and archived sessions, or read one session's summary. Optional: stubs may omit it. */
  history?(input: HistoryQuery, caller?: Caller): Promise<HistoryResult>;
  stop(session: string, mode: "interrupt" | "close", caller?: Caller): Promise<SessionView>;
  /**
   * Restart an idle (live) session's agent process with the same conversation, so it reloads its
   * instructions, skills and MCP servers; a parked session is resumed now. No turn is started and the
   * session ends idle. Throws `busy` while a turn is running or a request is pending, and `bad_input`
   * for failed sessions or ones without a conversation id.
   */
  refresh(session: string, caller?: Caller): Promise<SessionView>;
  /** `refresh` for every live idle session the caller can see. Busy, parked and failed ones are reported as skipped. */
  refreshAll(caller?: Caller): Promise<RefreshReport>;
  shutdown(): Promise<void>;
}

/** Read-only views for the dashboard; honours the same access policy as the tools. */
export interface DashboardApi {
  snapshot(caller?: Caller): DashboardSnapshot;
  /** Starts a background refresh of stale plan usage; returns immediately. */
  touchUsage?(): void;
  history?(input: HistoryQuery, caller?: Caller): Promise<HistoryResult>;
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
