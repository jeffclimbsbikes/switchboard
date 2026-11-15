import { randomUUID } from "node:crypto";
import type { AgentSession, Driver, DriverEvent, DriverStartOptions } from "../../src/drivers/driver.js";
import type { PlanStatus } from "../../src/types.js";

export const NOW = new Date("2026-11-14T12:00:00.000Z");
export const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

/** A driver that reports cost, tokens and a plan window with every turn. */
export class ScriptedDriver implements Driver {
  readonly kind = "fake" as const;
  readonly starts: DriverStartOptions[] = [];
  costUsd = 0.5;
  limit: { window: string; utilization: number; status: PlanStatus; resetsAt: string } = {
    window: "five_hour",
    utilization: 0.34,
    status: "allowed",
    resetsAt: iso(3_600_000),
  };

  async start(options: DriverStartOptions): Promise<AgentSession> {
    this.starts.push(options);
    const agentSessionId = options.resume ?? randomUUID();
    queueMicrotask(() => options.onEvent({ type: "session", agentSessionId }));
    const emit = (e: DriverEvent) => queueMicrotask(() => options.onEvent(e));
    return {
      prompt: async () => {
        emit({ type: "rate_limit", provider: "claude", ...this.limit });
        emit({
          type: "turn_end",
          stopReason: "end_turn",
          result: "done",
          costUsd: this.costUsd,
          tokens: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10 },
        });
      },
      respond: async () => {},
      interrupt: async () => {},
      close: async () => {},
    };
  }
}
