import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SwitchboardError } from "../../src/core/api.js";
import type { Notification, Notifier } from "../../src/core/notifier.js";
import { SessionManager } from "../../src/core/sessions.js";
import { type Db, openDb } from "../../src/db.js";
import { FakeDriver } from "../../src/drivers/fake.js";

function setup(extra: Record<string, unknown> = {}, db: Db = openDb(":memory:"), driver = new FakeDriver()) {
  const config = parseConfig({
    agents: { fake: { driver: "fake" }, other: { driver: "fake" } },
    workspaces: { main: "/tmp", side: "/var" },
    max_wait: 200,
    ...extra,
  });
  const notes: Notification[] = [];
  const notifier: Notifier = {
    async notify(n) {
      notes.push(n);
    },
  };
  const manager = new SessionManager({ config, db, drivers: { fake: driver, other: driver }, notifier });
  return { manager, db, notes, driver, config };
}

const managers: SessionManager[] = [];
function make(...args: Parameters<typeof setup>) {
  const s = setup(...args);
  managers.push(s.manager);
  return s;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const m of managers.splice(0)) await m.shutdown();
});

async function expectError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SwitchboardError);
  expect((err as SwitchboardError).code).toBe(code);
  return err as SwitchboardError;
}

describe("SessionManager lifecycle", () => {
  it("lists agents and workspaces from config", () => {
    const { manager } = make();
    expect(manager.agents()).toEqual([
      { id: "fake", driver: "fake", default: true },
      { id: "other", driver: "fake", default: false },
    ]);
    expect(manager.workspaces()).toEqual([
      { id: "main", path: "/tmp", default: true },
      { id: "side", path: "/var", default: false },
    ]);
  });

  it("includes descriptions, filtered by access", () => {
    const { manager } = make({
      agents: {
        fake: { driver: "fake", description: "Quick" },
        other: { driver: "fake" },
      },
      workspaces: { main: { path: "/tmp", description: "Main repo" }, side: "/var" },
      users: { "a@x.com": { agents: ["fake"], workspaces: ["main"] } },
    });
    expect(manager.agents()).toEqual([
      { id: "fake", driver: "fake", description: "Quick", default: true },
      { id: "other", driver: "fake", default: false },
    ]);
    expect(manager.workspaces()[0]).toEqual({
      id: "main",
      path: "/tmp",
      description: "Main repo",
      default: true,
    });
    const caller = { email: "a@x.com" };
    expect(manager.agents(caller).map((a) => a.id)).toEqual(["fake"]);
    expect(manager.workspaces(caller)).toEqual([
      { id: "main", path: "/tmp", description: "Main repo", default: true },
    ]);
  });

  it("runs a full conversation: reply, count, question, approval, interrupt, close", async () => {
    const { manager } = make();
    const view = await manager.start({ prompt: "reply hello there from the fake agent today" });
    expect(["working", "idle"]).toContain(view.state);
    expect(view.title).toBe("reply hello there from the fake");
    const name = view.session;

    const first = await manager.wait(name);
    expect(first.state).toBe("idle");
    expect(first.reply).toBe("hello there from the fake agent today");

    await manager.send(name, "count");
    expect((await manager.wait(name)).reply).toBe("turn 2");

    await manager.send(name, "ask which colour? | red | blue");
    const asked = await manager.wait(name);
    expect(asked.state).toBe("waiting");
    expect(asked.activity.at(-1)).toBe("asked: which colour?");
    expect(asked.pending?.kind).toBe("question");
    await expectError(manager.send(name, "count"), "busy");
    await expectError(manager.respond(name, "nope", "red"), "no_pending_request");
    await expectError(manager.respond(name, asked.pending?.id as string, "   "), "bad_answer");
    expect(["working", "idle"]).toContain(
      (await manager.respond(name, asked.pending?.id as string, "2")).state,
    );
    const answered = await manager.wait(name);
    expect(answered.reply).toBe("answered: blue");
    expect(answered.pending).toBeUndefined();

    await manager.send(name, "approve deploy");
    const approval = await manager.wait(name);
    expect(approval.pending).toMatchObject({ kind: "approval", tool: "deploy" });
    await manager.respond(name, approval.pending?.id as string, "yes");
    expect((await manager.wait(name)).reply).toBe("approved deploy");

    await manager.send(name, "approve deploy");
    const second = await manager.wait(name);
    await manager.respond(name, second.pending?.id as string, "no, too risky");
    expect((await manager.wait(name)).reply).toBe("denied deploy");

    await manager.send(name, "slow 60000");
    const running = await manager.wait(name, { maxWaitMs: 20 });
    expect(running.state).toBe("working");
    expect(running.activity).toContain("running: sleeping");
    await expectError(manager.send(name, "count"), "busy");
    await manager.stop(name, "interrupt");
    const stopped = await manager.wait(name, { cursor: running.cursor });
    expect(stopped.state).toBe("idle");
    expect(stopped.activity).toContain("stopped");

    expect((await manager.stop(name, "close")).state).toBe("closed");
    await expectError(manager.send(name, "count"), "closed");
    expect(manager.list({ state: "closed" })).toHaveLength(1);
    expect(manager.list({ state: "idle" })).toHaveLength(0);
  });

  it("validates agent, workspace, session and prompt", async () => {
    const { manager } = make();
    expect(
      (await expectError(manager.start({ prompt: "count", agent: "zzz" }), "not_found")).message,
    ).toMatch(/fake, other/);
    expect(
      (await expectError(manager.start({ prompt: "count", workspace: "zzz" }), "not_found")).message,
    ).toMatch(/main, side/);
    await expectError(manager.start({ prompt: "  " }), "bad_input");
    await expectError(manager.send("ghost", "x"), "not_found");
    await expectError(manager.wait("ghost"), "not_found");
  });

  it("uses the chosen workspace and title", async () => {
    const { manager } = make();
    const view = await manager.start({
      prompt: "count",
      workspace: "side",
      agent: "other",
      title: "Counting",
    });
    expect(view).toMatchObject({ workspace: "side", agent: "other", title: "Counting" });
    expect(manager.list()[0]).toMatchObject({ session: view.session });
  });

  it("returns activity with a working state when a wait times out", async () => {
    const { manager } = make();
    const { session } = await manager.start({ prompt: "slow 60000" });
    const result = await manager.wait(session, { maxWaitMs: 30 });
    expect(result.state).toBe("working");
    expect(result.reply).toBeUndefined();
    expect(result.activity).toEqual(["running: sleeping"]);
    expect(result.cursor).toBeGreaterThan(0);
  });

  it("wakes a long-poll as soon as the turn ends", async () => {
    const { manager } = make({ max_wait: 10_000 });
    const { session } = await manager.start({ prompt: "slow 30" });
    const t0 = Date.now();
    const result = await manager.wait(session);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(result.reply).toBe("slept");
  });

  it("reports a crash as failed and resumes it with the next send", async () => {
    const { manager } = make();
    const { session } = await manager.start({ prompt: "count" });
    await manager.wait(session);
    await manager.send(session, "crash");
    const failed = await manager.wait(session);
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("fake agent crashed");
    await manager.send(session, "count");
    expect((await manager.wait(session)).reply).toBe("turn 3");
  });
});

describe("parking, capacity, recovery", () => {
  it("parks an idle session after idle_park_after and resumes with context", async () => {
    vi.useFakeTimers();
    const { manager } = make({ idle_park_after: "1m" });
    const { session } = await manager.start({ prompt: "count" });
    expect((await manager.wait(session)).reply).toBe("turn 1");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(manager.list()[0]?.state).toBe("idle");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(manager.list()[0]?.state).toBe("parked");
    await manager.send(session, "count");
    expect((await manager.wait(session)).reply).toBe("turn 2");
  });

  it("parks the least recently active idle session to make room, else refuses", async () => {
    const { manager } = make({ max_live_sessions: 2 });
    const a = await manager.start({ prompt: "count" });
    await manager.wait(a.session);
    const b = await manager.start({ prompt: "slow 60000" });
    const c = await manager.start({ prompt: "slow 60000" });
    const state = (name: string) => manager.list().find((s) => s.session === name)?.state;
    expect(state(a.session)).toBe("parked");
    expect(state(b.session)).toBe("working");
    await expectError(manager.start({ prompt: "count" }), "capacity");
    await expectError(manager.send(a.session, "count"), "capacity");
    await manager.stop(c.session, "interrupt");
    await manager.wait(c.session, { cursor: 0 });
    await manager.send(a.session, "count");
    expect((await manager.wait(a.session)).reply).toBe("turn 2");
    expect(state(c.session)).toBe("parked");
  });

  it("recovers on restart: live sessions park, interrupted turns are noted, context survives", async () => {
    const db = openDb(":memory:");
    const driver = new FakeDriver();
    const first = setup({}, db, driver);
    managers.push(first.manager);
    const idle = await first.manager.start({ prompt: "count" });
    await first.manager.wait(idle.session);
    const busy = await first.manager.start({ prompt: "slow 60000" });
    await first.manager.wait(busy.session, { maxWaitMs: 10 });
    const asking = await first.manager.start({ prompt: "ask why? | a | b" });
    await first.manager.wait(asking.session);

    const second = setup({}, db, driver);
    managers.push(second.manager);
    const states = Object.fromEntries(second.manager.list().map((s) => [s.session, s]));
    expect(states[idle.session]?.state).toBe("parked");
    expect(states[busy.session]?.state).toBe("parked");
    expect(states[asking.session]).toMatchObject({ state: "parked" });
    expect(states[asking.session]?.pending).toBeUndefined();

    const recovered = await second.manager.wait(busy.session, { cursor: 0 });
    expect(recovered.state).toBe("parked");
    expect(recovered.activity).toContain("switchboard restarted; the last turn was interrupted");
    expect((await second.manager.wait(idle.session, { cursor: 0 })).activity).not.toContain(
      "switchboard restarted; the last turn was interrupted",
    );

    await second.manager.send(idle.session, "count");
    expect((await second.manager.wait(idle.session)).reply).toBe("turn 2");
  });
});

describe("notifications", () => {
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it("notifies done, waiting and failed when nobody is waiting", async () => {
    const { manager, notes } = make();
    const { session } = await manager.start({ prompt: `reply ${"x".repeat(500)}` });
    await tick();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ session, kind: "done" });
    expect(notes[0]?.text).toHaveLength(300);

    await manager.send(session, "ask which? | a | b");
    await tick();
    expect(notes[1]).toEqual({ session, kind: "waiting", text: "asked: which?" });
    const pending = (await manager.wait(session)).pending;
    await manager.respond(session, pending?.id as string, "a");
    await tick();
    expect(notes[2]).toMatchObject({ kind: "done", text: "answered: a" });

    await manager.send(session, "crash");
    await tick();
    expect(notes[3]).toEqual({ session, kind: "failed", text: "fake agent crashed" });
  });

  it("stays quiet while a waiter is active", async () => {
    const { manager, notes } = make({ max_wait: 5_000 });
    const { session } = await manager.start({ prompt: "slow 30" });
    const result = await manager.wait(session);
    expect(result.reply).toBe("slept");
    await tick();
    expect(notes).toHaveLength(0);
  });

  it("nags once when a request stays pending", async () => {
    vi.useFakeTimers();
    const { manager, notes } = make({ notify: { nag_after: "10m" } });
    const { session } = await manager.start({ prompt: "approve deploy" });
    await vi.advanceTimersByTimeAsync(1);
    expect(notes.map((n) => n.kind)).toEqual(["waiting"]);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(notes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(notes).toHaveLength(2);
    expect(notes[1]?.text).toMatch(/^still waiting: wants approval: deploy/);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(notes).toHaveLength(2);
    await manager.stop(session, "close");
  });

  it("does not nag once the request is answered", async () => {
    vi.useFakeTimers();
    const { manager, notes } = make({ notify: { nag_after: "10m" } });
    const { session } = await manager.start({ prompt: "approve deploy" });
    const pending = (await manager.wait(session)).pending;
    await manager.respond(session, pending?.id as string, "allow");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(notes.map((n) => n.kind)).toEqual(["waiting", "done"]);
  });
});

describe("driver selection", () => {
  it("uses the driver of the named agent, not the first one of the same kind", async () => {
    const { SessionManager } = await import("../../src/core/sessions.js");
    const { FakeDriver } = await import("../../src/drivers/fake.js");
    const { parseConfig } = await import("../../src/config.js");
    const { openDb } = await import("../../src/db.js");
    const config = parseConfig({
      agents: { mine: { driver: "fake", default: true }, theirs: { driver: "fake" } },
      workspaces: { w: "/tmp" },
    });
    const used: string[] = [];
    const tagged = (tag: string) => {
      const d = new FakeDriver();
      const start = d.start.bind(d);
      d.start = (opts) => {
        used.push(tag);
        return start(opts);
      };
      return d;
    };
    const m = new SessionManager({
      config,
      db: openDb(":memory:"),
      drivers: { mine: tagged("mine"), theirs: tagged("theirs") },
    });
    const view = await m.start({ prompt: "reply hi", agent: "theirs" });
    await m.wait(view.session, { maxWaitMs: 2_000 });
    expect(used).toEqual(["theirs"]);
    await m.stop(view.session, "close");
    await m.send(view.session, "count").catch(() => {});
    await m.shutdown();
  });
});
