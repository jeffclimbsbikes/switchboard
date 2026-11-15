import { randomUUID } from "node:crypto";
import type { Answer, PendingRequest } from "../types.js";
import type { AgentSession, Driver, DriverEvent, DriverStartOptions } from "./driver.js";

const sharedTurns = new Map<string, number>();

export class FakeDriver implements Driver {
  readonly kind = "fake" as const;

  constructor(private readonly turns: Map<string, number> = sharedTurns) {}

  async start(options: DriverStartOptions): Promise<AgentSession> {
    const agentSessionId = options.resume ?? randomUUID();
    if (!this.turns.has(agentSessionId)) this.turns.set(agentSessionId, 0);
    const session = new FakeSession(agentSessionId, this.turns, options.onEvent);
    queueMicrotask(() => session.emit({ type: "session", agentSessionId }));
    return session;
  }
}

type Pending =
  | { kind: "question"; request: PendingRequest; question: string }
  | { kind: "approval"; request: PendingRequest; tool: string };

class FakeSession implements AgentSession {
  private closed = false;
  private pending?: Pending;
  private slowTimer?: NodeJS.Timeout;

  constructor(
    private readonly id: string,
    private readonly turns: Map<string, number>,
    private readonly onEvent: (event: DriverEvent) => void,
  ) {}

  emit(event: DriverEvent): void {
    if (!this.closed) this.onEvent(event);
  }

  private later(event: DriverEvent): void {
    queueMicrotask(() => this.emit(event));
  }

  private finish(result: string): void {
    this.later({ type: "text", text: result });
    this.later({ type: "turn_end", stopReason: "end_turn", result });
  }

  async prompt(text: string): Promise<void> {
    if (this.closed) throw new Error("fake agent is closed");
    const turn = (this.turns.get(this.id) ?? 0) + 1;
    this.turns.set(this.id, turn);
    const trimmed = text.trim();
    const [command = "", ...rest] = trimmed.split(/\s+/);
    const arg = trimmed.slice(command.length).trim();
    switch (command) {
      case "count":
        return this.finish(`turn ${turn}`);
      case "ask": {
        const [question = "", ...options] = arg.split("|").map((s) => s.trim());
        const request: PendingRequest = {
          id: randomUUID(),
          kind: "question",
          questions: [
            { question, options: options.filter(Boolean).map((label) => ({ label })), multiSelect: false },
          ],
        };
        this.pending = { kind: "question", request, question };
        return this.later({ type: "request", request });
      }
      case "approve": {
        const tool = rest[0] ?? "tool";
        const request: PendingRequest = {
          id: randomUUID(),
          kind: "approval",
          tool,
          summary: `run ${tool}`,
          options: [
            { id: "allow", label: "Allow", kind: "allow_once" },
            { id: "always", label: "Always allow", kind: "allow_always" },
            { id: "deny", label: "Deny", kind: "reject_once" },
          ],
        };
        this.pending = { kind: "approval", request, tool };
        return this.later({ type: "request", request });
      }
      case "slow": {
        const ms = Number(rest[0] ?? 0) || 0;
        this.later({ type: "tool", id: `slow-${turn}`, title: "sleeping", status: "running" });
        this.slowTimer = setTimeout(() => {
          this.slowTimer = undefined;
          this.emit({ type: "tool", id: `slow-${turn}`, title: "sleeping", status: "done" });
          this.finish("slept");
        }, ms);
        return;
      }
      case "crash":
        this.later({ type: "error", message: "fake agent crashed", fatal: true });
        queueMicrotask(() => queueMicrotask(() => this.shutdown()));
        return;
      case "reply":
        return this.finish(arg);
      default:
        return this.finish(trimmed);
    }
  }

  async respond(requestId: string, answer: Answer): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.request.id !== requestId) throw new Error(`no pending request ${requestId}`);
    this.pending = undefined;
    if (pending.kind === "question" && answer.kind === "question") {
      const value = answer.answers[pending.question];
      return this.finish(`answered: ${Array.isArray(value) ? value.join(", ") : (value ?? "")}`);
    }
    if (pending.kind === "approval" && answer.kind === "approval") {
      const option =
        pending.request.kind === "approval" && pending.request.options.find((o) => o.id === answer.optionId);
      const allowed = option && (option.kind === "allow_once" || option.kind === "allow_always");
      return this.finish(`${allowed ? "approved" : "denied"} ${pending.tool}`);
    }
    throw new Error("answer kind does not match the pending request");
  }

  async interrupt(): Promise<void> {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = undefined;
    } else if (this.pending) {
      this.pending = undefined;
    } else {
      return;
    }
    this.later({ type: "turn_end", stopReason: "cancelled" });
  }

  async close(): Promise<void> {
    this.shutdown();
  }

  private shutdown(): void {
    this.closed = true;
    this.pending = undefined;
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.slowTimer = undefined;
  }
}
