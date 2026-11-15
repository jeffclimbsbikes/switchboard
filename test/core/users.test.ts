import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SwitchboardError } from "../../src/core/api.js";
import { createNotifier, type Notification, type Notifier } from "../../src/core/notifier.js";
import { SessionManager } from "../../src/core/sessions.js";
import { migrate } from "../../src/core/store.js";
import { openDb } from "../../src/db.js";
import { FakeDriver } from "../../src/drivers/fake.js";
import { createMcpServer } from "../../src/mcp/server.js";

const DIANA = { email: "Diana@Example.com" };
const BOB = { email: "bob@example.com" };
const ADMIN = { email: "admin@example.com" };

function setup(db = openDb(":memory:")) {
  const config = parseConfig({
    agents: { fake: { driver: "fake", default: true }, other: { driver: "fake" } },
    workspaces: { main: "/tmp", side: "/var" },
    max_wait: 200,
    users: {
      "diana@example.com": { agents: ["other"], workspaces: ["side"], notify_chat: "diana-chat" },
      "bob@example.com": {},
    },
  });
  const notes: Notification[] = [];
  const notifier: Notifier = {
    async notify(n) {
      notes.push(n);
    },
  };
  const manager = new SessionManager({ config, db, drivers: { fake: new FakeDriver() }, notifier });
  managers.push(manager);
  return { manager, db, notes, config };
}

const managers: SessionManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});

async function code(p: Promise<unknown>) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SwitchboardError);
  return (err as SwitchboardError).code;
}

describe("per-user scoping", () => {
  it("filters agents and workspaces for restricted users only", () => {
    const { manager } = setup();
    expect(manager.agents(DIANA)).toEqual([{ id: "other", driver: "fake", default: true }]);
    expect(manager.workspaces(DIANA)).toEqual([{ id: "side", path: "/var", default: true }]);
    expect(manager.agents(BOB)).toHaveLength(2);
    expect(manager.agents(ADMIN)).toHaveLength(2);
    expect(manager.agents()).toHaveLength(2);
    expect(manager.workspaces(ADMIN)).toHaveLength(2);
  });

  it("starts with the user's own defaults and rejects what they may not use", async () => {
    const { manager } = setup();
    const view = await manager.start({ prompt: "hi" }, DIANA);
    expect(view).toMatchObject({ agent: "other", workspace: "side" });
    expect(await code(manager.start({ prompt: "hi", agent: "fake" }, DIANA))).toBe("not_found");
    expect(await code(manager.start({ prompt: "hi", workspace: "main" }, DIANA))).toBe("not_found");
    const err = await manager.start({ prompt: "hi", agent: "fake" }, DIANA).catch((e: Error) => e);
    expect((err as Error).message).toContain("Available: other.");
  });

  it("hides other people's sessions as if they did not exist", async () => {
    const { manager } = setup();
    const mine = await manager.start({ prompt: "mine" }, DIANA);
    const bobs = await manager.start({ prompt: "bobs" }, BOB);
    const admins = await manager.start({ prompt: "admins" }, ADMIN);
    const rootless = await manager.start({ prompt: "stdio" });

    expect(manager.list({}, DIANA).map((s) => s.session)).toEqual([mine.session]);
    expect(manager.list({}, BOB).map((s) => s.session)).toEqual([bobs.session]);
    expect(
      manager
        .list({}, ADMIN)
        .map((s) => s.session)
        .sort(),
    ).toEqual([mine.session, bobs.session, admins.session, rootless.session].sort());
    expect(manager.list()).toHaveLength(4);

    for (const call of [
      () => manager.send(bobs.session, "x", DIANA),
      () => manager.respond(bobs.session, "r", "yes", DIANA),
      () => manager.wait(bobs.session, { maxWaitMs: 0 }, DIANA),
      () => manager.stop(bobs.session, "close", DIANA),
      () => manager.send(admins.session, "x", DIANA),
      () => manager.stop("nonexistent", "close", DIANA),
    ]) {
      expect(await code(call())).toBe("not_found");
    }
    const err = await manager.stop(bobs.session, "close", DIANA).catch((e: Error) => e);
    expect((err as Error).message).toContain(`Sessions: ${mine.session}.`);
    expect((err as Error).message.split("Sessions:")[1]).not.toContain(bobs.session);
  });

  it("lets unrestricted callers act on restricted users' sessions", async () => {
    const { manager } = setup();
    const mine = await manager.start({ prompt: "mine" }, DIANA);
    await manager.wait(mine.session, { maxWaitMs: 500 }, ADMIN);
    expect((await manager.stop(mine.session, "close", ADMIN)).state).toBe("closed");
    expect((await manager.wait(mine.session, { maxWaitMs: 0 })).state).toBe("closed");
  });

  it("persists the owner", async () => {
    const { manager, db } = setup();
    const a = await manager.start({ prompt: "a" }, DIANA);
    const b = await manager.start({ prompt: "b" });
    const owner = (name: string) => db.prepare("SELECT owner FROM sessions WHERE name = ?").get(name)?.owner;
    expect(owner(a.session)).toBe("diana@example.com");
    expect(owner(b.session)).toBeNull();
  });

  it("keeps ownership across a restart", async () => {
    const db = openDb(":memory:");
    const first = setup(db);
    const mine = await first.manager.start({ prompt: "mine" }, DIANA);
    await first.manager.shutdown();
    const second = setup(db);
    expect(second.manager.list({}, DIANA).map((s) => s.session)).toEqual([mine.session]);
    expect(second.manager.list({}, BOB)).toEqual([]);
  });
});

describe("owner column migration", () => {
  it("upgrades a database created by the old schema", async () => {
    const db = openDb(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        name TEXT PRIMARY KEY, agent TEXT NOT NULL, workspace TEXT NOT NULL, cwd TEXT NOT NULL,
        model TEXT, title TEXT NOT NULL, state TEXT NOT NULL, agent_session_id TEXT, pending TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity TEXT
      );
      CREATE TABLE events (
        session TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (session, seq)
      );
      INSERT INTO sessions VALUES ('old', 'fake', 'main', '/tmp', NULL, 'old one', 'closed', NULL, NULL, 't', 't', NULL);
    `);
    const { manager } = setup(db);
    expect(manager.list().map((s) => s.session)).toEqual(["old"]);
    expect(manager.list({}, DIANA)).toEqual([]);
    expect(manager.list({}, ADMIN)).toHaveLength(1);
    const fresh = await manager.start({ prompt: "new" }, DIANA);
    expect(manager.list({}, DIANA).map((s) => s.session)).toEqual([fresh.session]);
  });

  it("is idempotent", () => {
    const db = openDb(":memory:");
    migrate(db);
    migrate(db);
    expect(
      db
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .filter((c) => c.name === "owner"),
    ).toHaveLength(1);
  });
});

describe("notification routing", () => {
  it("sends the owner's chat with notifications for their sessions only", async () => {
    const { manager, notes } = setup();
    const mine = await manager.start({ prompt: "mine" }, DIANA);
    const bobs = await manager.start({ prompt: "bobs" }, BOB);
    const rootless = await manager.start({ prompt: "x" });
    await new Promise((r) => setTimeout(r, 400));
    const chatOf = (s: string) => notes.filter((n) => n.session === s).map((n) => n.chat);
    expect(chatOf(mine.session).length).toBeGreaterThan(0);
    expect(chatOf(mine.session).every((c) => c === "diana-chat")).toBe(true);
    expect(notes.filter((n) => n.session === bobs.session).every((n) => !("chat" in n))).toBe(true);
    expect(notes.filter((n) => n.session === rootless.session).every((n) => !("chat" in n))).toBe(true);
  });

  it("the telegram channel prefers the notification's chat", async () => {
    const bodies: { chat_id: string }[] = [];
    const notifier = createNotifier(
      { telegram: { token_env: "T", chat: "household" }, nag_after: 1 },
      {
        env: { T: "tok" },
        fetch: (async (_url: string, init: { body: string }) => {
          bodies.push(JSON.parse(init.body));
          return { ok: true };
        }) as unknown as typeof fetch,
      },
    );
    await notifier.notify({ session: "otter", kind: "done", text: "x" });
    await notifier.notify({ session: "otter", kind: "done", text: "x", chat: "diana-chat" });
    expect(bodies.map((b) => b.chat_id)).toEqual(["household", "diana-chat"]);
  });
});

describe("tools with a caller identity", () => {
  async function connect(email: string | undefined, manager: SessionManager) {
    const server = createMcpServer(manager, { maxWaitMs: 200 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    if (email) {
      const send = clientTransport.send.bind(clientTransport);
      clientTransport.send = (message, options) =>
        send(message, {
          ...options,
          authInfo: { token: "t", clientId: "c", scopes: [], extra: { email } },
        });
    }
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    return client;
  }

  type Result = { structuredContent: Record<string, unknown>; isError?: boolean };
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
    (await c.callTool({ name, arguments: args })) as unknown as Result;

  it("scopes a restricted user while an unlisted admin sees everything", async () => {
    const { manager } = setup();
    const diana = await connect("diana@example.com", manager);
    const admin = await connect("admin@example.com", manager);
    const stdio = await connect(undefined, manager);

    const agents = (await call(diana, "agents")).structuredContent as { agents: { id: string }[] };
    expect(agents.agents.map((a) => a.id)).toEqual(["other"]);
    expect(((await call(admin, "agents")).structuredContent.agents as unknown[]).length).toBe(2);
    expect(((await call(stdio, "agents")).structuredContent.agents as unknown[]).length).toBe(2);

    const hers = (await call(diana, "start", { prompt: "hers" })).structuredContent.session as string;
    const adminOwn = (await call(admin, "start", { prompt: "admins" })).structuredContent.session as string;

    const dianaList = (await call(diana, "sessions")).structuredContent.sessions as { session: string }[];
    expect(dianaList.map((s) => s.session)).toEqual([hers]);
    const adminList = (await call(admin, "sessions")).structuredContent.sessions as { session: string }[];
    expect(adminList.map((s) => s.session).sort()).toEqual([hers, adminOwn].sort());

    const peek = await call(diana, "wait", { session: adminOwn, seconds: 0 });
    expect(peek.isError).toBe(true);
    expect(peek.structuredContent.error).toBe("not_found");
    expect((await call(diana, "send", { session: adminOwn, message: "x" })).isError).toBe(true);
    expect((await call(diana, "stop", { session: adminOwn, mode: "close" })).isError).toBe(true);
    expect((await call(diana, "start", { prompt: "x", agent: "fake" })).structuredContent.error).toBe(
      "not_found",
    );
    expect((await call(admin, "wait", { session: hers, seconds: 0 })).isError).toBeUndefined();
  });
});
