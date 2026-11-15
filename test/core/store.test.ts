import { describe, expect, it } from "vitest";
import { SessionStore } from "../../src/core/store.js";
import { openDb } from "../../src/db.js";

const row = (name: string) => ({
  name,
  agent: "fake",
  workspace: "w",
  cwd: "/tmp",
  title: "t",
  state: "starting" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("SessionStore", () => {
  it("round-trips sessions, patches and pending requests", () => {
    const store = new SessionStore(openDb(":memory:"));
    store.create(row("otter"));
    const pending = { id: "r", kind: "approval" as const, tool: "x", summary: "y", options: [] };
    store.update("otter", { state: "waiting", pending, agentSessionId: "abc" });
    expect(store.get("otter")).toMatchObject({ state: "waiting", pending, agentSessionId: "abc" });
    store.update("otter", { pending: null });
    expect(store.get("otter")?.pending).toBeUndefined();
    expect(store.list("waiting")).toHaveLength(1);
    expect(store.list("idle")).toHaveLength(0);
    expect(store.names()).toEqual(["otter"]);
  });

  it("numbers events per session from 1", () => {
    const store = new SessionStore(openDb(":memory:"));
    store.create(row("a"));
    store.create(row("b"));
    expect(store.appendEvent("a", "t", { type: "prompt", text: "x" })).toBe(1);
    expect(store.appendEvent("a", "t", { type: "text", text: "y" })).toBe(2);
    expect(store.appendEvent("b", "t", { type: "note", text: "z" })).toBe(1);
    expect(store.lastSeq("a")).toBe(2);
    expect(store.lastSeq("none")).toBe(0);
    expect(store.lastSeqOfKind("a", "prompt")).toBe(1);
    expect(store.eventsAfter("a", 1).map((e) => e.data)).toEqual([{ type: "text", text: "y" }]);
  });

  it("persists across store instances on the same db", () => {
    const db = openDb(":memory:");
    new SessionStore(db).create(row("a"));
    expect(new SessionStore(db).get("a")?.name).toBe("a");
  });
});
