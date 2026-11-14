import type {
  AgentInfo,
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

/** What the MCP tools need from the core. Errors are thrown as `SwitchboardError` with a speakable message. */
export interface SessionManagerApi {
  agents(): AgentInfo[];
  workspaces(): WorkspaceInfo[];
  /** Spawns the agent and sends the first prompt; returns as soon as the turn is running. */
  start(input: StartInput): Promise<SessionView>;
  /** Next turn. Resumes a parked or failed session first. Throws if a turn is running or a request is pending. */
  send(session: string, message: string): Promise<SessionView>;
  /**
   * Answer the pending request. `answer` is what the user said: an option label (case-insensitive),
   * an option number ("2"), "allow"/"yes"/"deny"/"no"/"always" for approvals, or free text.
   */
  respond(session: string, requestId: string, answer: string): Promise<SessionView>;
  /**
   * Long-poll. Resolves as soon as something needs attention (request pending, turn ended, failed) or after
   * maxWaitMs, with everything since `cursor` (default: the start of the current turn).
   */
  wait(session: string, opts?: { cursor?: number; maxWaitMs?: number }): Promise<WaitResult>;
  list(filter?: { state?: SessionState }): SessionSummary[];
  stop(session: string, mode: "interrupt" | "close"): Promise<SessionView>;
  shutdown(): Promise<void>;
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
