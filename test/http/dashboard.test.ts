import type { AddressInfo } from "node:net";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import { FakeDriver } from "../../src/drivers/fake.js";
import { createHttpApp } from "../../src/http/server.js";
import { createMcpServer, INSTRUCTIONS } from "../../src/mcp/server.js";
import { AUD, baseConfig, exchange, getCode, type Harness, OWNER, pkce, register, TEAM } from "./harness.js";

const ALICE = "alice@example.com";
const TOOLS = ["agents", "respond", "send", "sessions", "start", "stop", "wait"];

type Schema = {
  type: string;
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
};

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function boot(over: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const config = baseConfig({
    agents: { fake: { driver: "fake", default: true, description: "stand-in" }, other: { driver: "fake" } },
    workspaces: { w: "/tmp", side: "/var" },
    max_wait: 300,
    auth: { login: "cloudflare-access", team: TEAM, aud: AUD, allow: [OWNER, ALICE] },
    ...over,
  });
  const db = openDb(":memory:");
  const fake = new FakeDriver();
  const manager = new SessionManager({ config, db, drivers: { fake, other: fake } });
  const app = createHttpApp({
    config,
    db,
    createMcpServer: () => createMcpServer(manager, { maxWaitMs: config.max_wait }),
    dashboard: manager,
    accessKeys: createLocalJWKSet({ keys: [jwk] }),
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  closers.push(
    () => new Promise((r) => listener.close(r)),
    () => manager.shutdown(),
  );
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const jwt = async (o: { email?: string; aud?: string } = {}) =>
    new SignJWT({ email: o.email ?? OWNER })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(o.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  const get = async (path: string, token?: string) =>
    fetch(`${base}${path}`, { headers: token ? { "cf-access-jwt-assertion": token } : {} });
  const h = { base, db, jwt, clock: { ms: Date.now() }, close: async () => {} } as unknown as Harness;
  return { base, manager, db, jwt, get, h };
}

async function settled(manager: SessionManager, name: string, caller?: { email: string }) {
  await manager.wait(name, { maxWaitMs: 2000 }, caller);
}

describe("dashboard auth", () => {
  it("auth none is open", async () => {
    const { get } = await boot({ auth: { login: "none" } });
    const page = await get("/dashboard");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain("/dashboard/api/state");
    const res = await get("/dashboard/api/state");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { viewer: { restricted: boolean } }).viewer.restricted).toBe(false);
  });

  it("dev mode uses the configured email", async () => {
    const { get } = await boot({ auth: { login: "dev", email: "Dev@Example.com" } });
    const res = await get("/dashboard/api/state");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { viewer: { email: string } }).viewer.email).toBe("dev@example.com");
  });

  it("cloudflare-access verifies the JWT like /authorize", async () => {
    const { get, jwt } = await boot();
    for (const path of ["/dashboard", "/dashboard/api/state", "/dashboard/api/sessions/x"]) {
      expect((await get(path)).status).toBe(403);
      expect((await get(path, "garbage")).status).toBe(403);
      expect((await get(path, await jwt({ aud: "other-aud" }))).status).toBe(403);
      expect((await get(path, await jwt({ email: "stranger@example.com" }))).status).toBe(403);
    }
    const denied = await get("/dashboard");
    expect(await denied.text()).toContain("Cloudflare Access");
    expect(((await get("/dashboard/api/state")).headers.get("content-type") ?? "").includes("json")).toBe(
      true,
    );
    const ok = await get("/dashboard", await jwt());
    expect(ok.status).toBe(200);
    expect((await get("/dashboard/api/state", await jwt())).status).toBe(200);
  });

  it("is not mounted without a dashboard source", async () => {
    const config = baseConfig({ auth: { login: "none" } });
    const app = createHttpApp({
      config,
      db: openDb(":memory:"),
      createMcpServer: () => createMcpServer({} as never, { maxWaitMs: 1000 }),
    });
    const listener = app.listen(0, "127.0.0.1");
    await new Promise((r) => listener.once("listening", r));
    closers.push(() => new Promise((r) => listener.close(r)));
    const res = await fetch(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/dashboard`);
    expect(res.status).toBe(404);
  });
});

describe("dashboard state", () => {
  it("includes the real tool contract and instructions", async () => {
    const { get, jwt } = await boot();
    const body = (await (await get("/dashboard/api/state", await jwt())).json()) as {
      version: string;
      mcp: {
        instructions: string;
        tools: {
          name: string;
          title?: string;
          description?: string;
          inputSchema: Schema;
          annotations?: Record<string, boolean>;
        }[];
      };
    };
    expect(body.version).toBeTruthy();
    expect(body.mcp.instructions).toBe(INSTRUCTIONS);
    expect(body.mcp.tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of body.mcp.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description).toBeTruthy();
    }
    const start = body.mcp.tools.find((t) => t.name === "start");
    expect(start?.inputSchema.required).toEqual(["prompt"]);
    expect(start?.inputSchema.properties.prompt?.minLength).toBe(1);
    const wait = body.mcp.tools.find((t) => t.name === "wait");
    expect(wait?.inputSchema.properties.seconds?.maximum).toBe(1);
    expect(wait?.annotations?.readOnlyHint).toBe(true);
    expect(body.mcp.tools.find((t) => t.name === "stop")?.annotations?.destructiveHint).toBe(true);
  });

  it("can omit the tool contract for polling", async () => {
    const { get, jwt } = await boot();
    const body = (await (await get("/dashboard/api/state?tools=0", await jwt())).json()) as Record<
      string,
      unknown
    >;
    expect(body.mcp).toBeUndefined();
    expect(body.agents).toBeDefined();
  });

  it("reports agents, sessions, counts and config without secrets", async () => {
    const { get, jwt, manager } = await boot({
      notify: { ntfy: { url: "https://ntfy.sh/secret-topic" }, telegram: { chat: "99887766" } },
    });
    const view = await manager.start({ prompt: "ask Pick a color? | red | blue" }, { email: OWNER });
    await settled(manager, view.session);
    const body = (await (await get("/dashboard/api/state", await jwt())).json()) as {
      agents: { id: string; driver: string; default: boolean; live: number; liveSessions: string[] }[];
      sessions: { name: string; state: string; live: boolean; owner: string; pending?: { kind: string } }[];
      counts: { live: number; maxLive: number; total: number; byState: Record<string, number> };
      config: { maxLiveSessions: number; notify: { channels: string[] } };
    };
    expect(body.agents.map((a) => a.id)).toEqual(["fake", "other"]);
    expect(body.agents[0]).toMatchObject({ driver: "fake", default: true, live: 1 });
    expect(body.agents[0]?.liveSessions).toEqual([view.session]);
    expect(body.sessions[0]).toMatchObject({
      name: view.session,
      state: "waiting",
      live: true,
      owner: OWNER,
      pending: { kind: "question" },
    });
    expect(body.counts).toMatchObject({ live: 1, maxLive: 4, total: 1 });
    expect(body.counts.byState.waiting).toBe(1);
    expect(body.config.notify.channels).toEqual(["telegram", "ntfy"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("secret-topic");
    expect(raw).not.toContain("99887766");
    expect(raw).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("lists grants for unrestricted users only", async () => {
    const t = await boot({ users: { [ALICE]: { agents: ["other"], workspaces: ["side"] } } });
    const { body: client } = await register(t.h);
    const { verifier, challenge } = pkce();
    const code = await getCode(t.h, client.client_id as string, challenge);
    await exchange(t.h, client.client_id as string, code, verifier);
    const admin = (await (await t.get("/dashboard/api/state", await t.jwt())).json()) as {
      grants: { clientName: string; email: string; expiresAt: string }[];
    };
    expect(admin.grants).toHaveLength(1);
    expect(admin.grants[0]).toMatchObject({ clientName: "Claude", email: OWNER });
    expect(admin.grants[0]).not.toHaveProperty("family");
    const alice = (await (await t.get("/dashboard/api/state", await t.jwt({ email: ALICE }))).json()) as {
      grants: unknown[];
    };
    expect(alice.grants).toEqual([]);
  });
});

describe("restricted users", () => {
  it("only see their own sessions, agents and workspaces", async () => {
    const t = await boot({ users: { [ALICE]: { agents: ["other"], workspaces: ["side"] } } });
    const mine = await t.manager.start(
      { prompt: "count", agent: "other", workspace: "side" },
      { email: ALICE },
    );
    const theirs = await t.manager.start({ prompt: "count" }, { email: OWNER });
    await settled(t.manager, mine.session, { email: ALICE });

    const view = async (email: string) =>
      (await (await t.get("/dashboard/api/state", await t.jwt({ email }))).json()) as {
        viewer: { restricted: boolean };
        agents: { id: string }[];
        workspaces: { id: string }[];
        sessions: { name: string; owner?: string; cwd: string }[];
        counts: { total: number };
        grants: unknown[];
        config: { auth: Record<string, unknown> };
      };
    const d = await view(ALICE);
    expect(d.viewer.restricted).toBe(true);
    expect(d.agents.map((a) => a.id)).toEqual(["other"]);
    expect(d.workspaces.map((w) => w.id)).toEqual(["side"]);
    expect(d.sessions.map((s) => s.name)).toEqual([mine.session]);
    expect(d.sessions[0]).not.toHaveProperty("owner");
    expect(d.counts.total).toBe(1);
    expect(d.grants).toEqual([]);
    expect(d.config.auth).toEqual({ login: "cloudflare-access" });

    const a = await view(OWNER);
    expect(a.sessions.map((s) => s.name).sort()).toEqual([mine.session, theirs.session].sort());
    expect(a.agents.map((x) => x.id)).toEqual(["fake", "other"]);

    const own = await t.get(`/dashboard/api/sessions/${mine.session}`, await t.jwt({ email: ALICE }));
    expect(own.status).toBe(200);
    const other = await t.get(`/dashboard/api/sessions/${theirs.session}`, await t.jwt({ email: ALICE }));
    expect(other.status).toBe(404);
    const missing = await t.get("/dashboard/api/sessions/nope", await t.jwt({ email: ALICE }));
    expect(await other.json()).toMatchObject({ error: "not_found" });
    expect(missing.status).toBe(404);
  });
});

describe("session detail", () => {
  type Detail = {
    session: { name: string; state: string; activity: string[] };
    events: { seq: number; event: { type: string } }[];
    lastSeq: number;
    hasMore: boolean;
    truncated: boolean;
  };

  it("returns the full event log, paged by since", async () => {
    const t = await boot({ auth: { login: "none" } });
    const view = await t.manager.start({ prompt: "count" });
    await settled(t.manager, view.session);
    await t.manager.send(view.session, "count");
    await settled(t.manager, view.session);
    const url = `/dashboard/api/sessions/${view.session}`;

    const all = (await (await t.get(`${url}?since=0`)).json()) as Detail;
    expect(all.session).toMatchObject({ name: view.session, state: "idle" });
    expect(all.events.map((e) => e.seq)).toEqual(Array.from({ length: all.lastSeq }, (_, i) => i + 1));
    expect(all.events.map((e) => e.event.type)).toContain("prompt");
    expect(all.hasMore).toBe(false);
    expect(all.truncated).toBe(false);
    expect(all.lastSeq).toBeGreaterThanOrEqual(6);

    const first = (await (await t.get(`${url}?since=0&limit=2`)).json()) as Detail;
    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    const next = (await (await t.get(`${url}?since=2&limit=2`)).json()) as Detail;
    expect(next.events.map((e) => e.seq)).toEqual([3, 4]);
    const end = (await (await t.get(`${url}?since=${all.lastSeq}`)).json()) as Detail;
    expect(end.events).toEqual([]);
    expect(end.hasMore).toBe(false);

    const tail = (await (await t.get(`${url}?limit=2`)).json()) as Detail;
    expect(tail.events.map((e) => e.seq)).toEqual([all.lastSeq - 1, all.lastSeq]);
    expect(tail.truncated).toBe(true);
    expect(tail.hasMore).toBe(false);
  });

  it("rejects bad paging and unknown sessions", async () => {
    const t = await boot({ auth: { login: "none" } });
    const view = await t.manager.start({ prompt: "count" });
    expect((await t.get(`/dashboard/api/sessions/${view.session}?since=abc`)).status).toBe(400);
    expect((await t.get(`/dashboard/api/sessions/${view.session}?limit=-1`)).status).toBe(400);
    expect((await t.get("/dashboard/api/sessions/nope")).status).toBe(404);
  });
});

describe("dashboard history", () => {
  it("searches live sessions, serves 404 for unknown ones, and reports the archive", async () => {
    const { get, manager, jwt } = await boot({ archive: { summarizer: { agent: "other" } } });
    const view = await manager.start({ prompt: "reply sprinkler schedule", title: "garden sprinkler" });
    await settled(manager, view.session);
    const token = await jwt();
    const found = (await (await get("/dashboard/api/history?q=SPRINKLER", token)).json()) as {
      entries: { session: string; state: string }[];
    };
    expect(found.entries).toMatchObject([{ session: view.session, state: "live" }]);
    expect(
      ((await (await get("/dashboard/api/history?q=nothing-here", token)).json()) as { entries: unknown[] })
        .entries,
    ).toEqual([]);
    expect((await get("/dashboard/api/history?session=ghost", token)).status).toBe(404);
    expect((await get("/dashboard/api/history?limit=x", token)).status).toBe(400);
    expect((await get("/dashboard/api/history")).status).toBe(403);
    const state = (await (await get("/dashboard/api/state?tools=0", token)).json()) as {
      archive: { count: number; recent: unknown[] };
    };
    expect(state.archive).toEqual({ count: 0, recent: [] });
  });

  it("has no archive section without [archive]", async () => {
    const { get, jwt } = await boot();
    const state = (await (await get("/dashboard/api/state?tools=0", await jwt())).json()) as Record<
      string,
      unknown
    >;
    expect(state.archive).toBeUndefined();
  });
});
