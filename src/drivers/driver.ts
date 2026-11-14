import type { Answer, PendingRequest, StopReason } from "../types.js";

/**
 * Everything a driver reports about one live agent session. Drivers translate
 * their agent's native stream (Claude Agent SDK messages, ACP session/update
 * notifications, ...) into these.
 */
export type DriverEvent =
  /** The agent's own session id is known; persist it so the session can be resumed later. */
  | { type: "session"; agentSessionId: string }
  /** A complete piece of assistant text (not a token-level delta). */
  | { type: "text"; text: string }
  | { type: "tool"; id: string; title: string; status: "pending" | "running" | "done" | "failed" }
  | { type: "plan"; entries: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  /** The agent is blocked until `respond(request.id, answer)` is called. */
  | { type: "request"; request: PendingRequest }
  /** The current turn finished. `result` is the final assistant text, when the agent provides one. */
  | { type: "turn_end"; stopReason: StopReason; result?: string }
  /** `fatal: true` means the process is gone; the session can only continue via a resumed start(). */
  | { type: "error"; message: string; fatal: boolean };

export interface DriverStartOptions {
  /** Absolute working directory for the agent. */
  cwd: string;
  model?: string;
  /** Agent session id from an earlier `session` event: continue that conversation. */
  resume?: string;
  /** Extra system prompt appended to the agent's own. */
  appendSystemPrompt?: string;
  onEvent: (event: DriverEvent) => void;
}

/** One live session inside an agent process. */
export interface AgentSession {
  /** Start a turn. Resolves once the agent accepted it; progress arrives through onEvent. */
  prompt(text: string): Promise<void>;
  /** Answer a pending request from a `request` event. */
  respond(requestId: string, answer: Answer): Promise<void>;
  /** Stop the current turn. A `turn_end` with stopReason "cancelled" follows. */
  interrupt(): Promise<void>;
  /** End the process. The conversation stays resumable through its agentSessionId. */
  close(): Promise<void>;
}

export interface Driver {
  readonly kind: "claude" | "acp" | "fake";
  start(options: DriverStartOptions): Promise<AgentSession>;
}
