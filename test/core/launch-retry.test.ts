import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import type { AgentSession, Driver, DriverStartOptions } from "../../src/drivers/driver.js";

class DyingDriver implements Driver {
  readonly kind = "fake" as const;
  readonly starts: DriverStartOptions[] = [];
  readonly prompts: string[] = [];
  constructor(
    private readonly dies: (start: number) => boolean,
    private readonly late = false,
    private readonly tick: () => void = () => {},
  ) {}

  async start(options: DriverStartOptions): Promise<AgentSession> {
    const n = this.starts.length;
    this.starts.push(options);
    const agentSessionId = options.resume ?? `agent-${n}`;
    const emit = (e: Parameters<DriverStartOptions["onEvent"]>[0]) =>
      queueMicrotask(() => options.onEvent(e));
    return {
      prompt: async (text) => {
        this.prompts.push(text);
        this.tick();
        if (this.dies(n)) {
          if (this.late) emit({ type: "session", agentSessionId });
          emit({ type: "error", message: "claude exited with code 1", fatal: true });
          return;
        }
        emit({ type: "session", agentSessionId });
        emit({ type: "turn_end", stopReason: "end_turn", result: "fine" });
      },
      respond: async () => {},
      interrupt: async () => {},
      close: async () => {},
    };
  }
}

const managers: SessionManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});

function make(driver: Driver, db = openDb(":memory:"), now?: () => Date) {
  const manager = new SessionManager({
    config: parseConfig({ agents: { a: { driver: "fake" } }, workspaces: { w: "/tmp" }, max_wait: 500 }),
    db,
    drivers: { a: driver },
    ...(now && { now }),
  });
  managers.push(manager);
  return { manager, db };
}

const noteTexts = (m: SessionManager, name: string) =>
  m
    .detail(name)
    .events.map((e) => e.event as { type: string; text?: string })
    .filter((e) => e.type === "note")
    .map((e) => e.text);

describe("retry an agent that dies at launch", () => {
  it("retries the start once with the same prompt and notes it", async () => {
    const driver = new DyingDriver((n) => n === 0);
    const { manager } = make(driver);
    const view = await manager.start({ prompt: "do the thing" });
    const result = await manager.wait(view.session, { maxWaitMs: 1000 });
    expect(result.state).toBe("idle");
    expect(result.reply).toBe("fine");
    expect(driver.starts).toHaveLength(2);
    expect(driver.prompts).toEqual(["do the thing", "do the thing"]);
    expect(noteTexts(manager, view.session)).toEqual(["agent exited at launch; retried"]);
    const events = manager.detail(view.session).events.map((e) => (e.event as { type: string }).type);
    expect(events.filter((t) => t === "prompt")).toHaveLength(1);
    expect(events).not.toContain("error");
  });

  it("fails normally when the retry dies too", async () => {
    const driver = new DyingDriver(() => true);
    const { manager } = make(driver);
    const view = await manager.start({ prompt: "doomed" });
    const result = await manager.wait(view.session, { maxWaitMs: 1000 });
    expect(result.state).toBe("failed");
    expect(result.error).toContain("exited with code 1");
    expect(driver.starts).toHaveLength(2);
  });

  it("does not retry a failure after the agent showed signs of life", async () => {
    const driver = new DyingDriver((n) => n === 0, true);
    const { manager } = make(driver);
    const view = await manager.start({ prompt: "late failure" });
    const result = await manager.wait(view.session, { maxWaitMs: 1000 });
    expect(result.state).toBe("failed");
    expect(driver.starts).toHaveLength(1);
    expect(noteTexts(manager, view.session)).toEqual([]);
  });

  it("does not retry after the 10 second window", async () => {
    const clock = { ms: Date.parse("2026-01-01T00:00:00Z") };
    const driver = new DyingDriver(
      (n) => n === 0,
      false,
      () => {
        clock.ms += 11_000;
      },
    );
    const { manager } = make(driver, openDb(":memory:"), () => new Date(clock.ms));
    const view = await manager.start({ prompt: "slow death" });
    const result = await manager.wait(view.session, { maxWaitMs: 1000 });
    expect(result.state).toBe("failed");
    expect(driver.starts).toHaveLength(1);
  });

  it("also covers resume-on-send", async () => {
    const db = openDb(":memory:");
    const first = make(new DyingDriver(() => false), db);
    const view = await first.manager.start({ prompt: "first turn" });
    await first.manager.wait(view.session, { maxWaitMs: 1000 });
    await first.manager.shutdown();

    const driver = new DyingDriver((n) => n === 0);
    const { manager } = make(driver, db);
    expect(manager.list()[0]?.state).toBe("parked");
    await manager.send(view.session, "second turn");
    const result = await manager.wait(view.session, { maxWaitMs: 1000 });
    expect(result.state).toBe("idle");
    expect(driver.starts).toHaveLength(2);
    expect(driver.starts.map((s) => s.resume)).toEqual(["agent-0", "agent-0"]);
    expect(driver.prompts).toEqual(["second turn", "second turn"]);
    expect(noteTexts(manager, view.session)).toContain("agent exited at launch; retried");
  });
});
