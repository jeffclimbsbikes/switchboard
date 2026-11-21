import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService, deriveAccounts, parseAuthorizeUrl } from "../../src/core/accounts.js";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import { FakeDriver } from "../../src/drivers/fake.js";
import { createHttpApp } from "../../src/http/server.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { AUD, baseConfig, OWNER, PUBLIC_URL, TEAM } from "./harness.js";

const GUEST = "guest@example.com";
const FAKE_LOGIN = resolve("test/fixtures/fake-claude-login.mjs");
const FAKE_SUDO = resolve("test/fixtures/fake-sudo-home.sh");
const SECRET = /sk-ant|SECRET|secret@example/;

const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

function agents() {
  return {
    main: { driver: "claude", executable: FAKE_LOGIN, default: true },
    apps: { driver: "claude", executable: FAKE_LOGIN, run_as: "diana" },
    plain: { driver: "fake" },
  };
}

async function boot(timing: Record<string, number> = {}, over: Record<string, unknown> = {}) {
  const homes = mkdtempSync(join(tmpdir(), "sb-accounts-"));
  process.env.FAKE_HOMES = homes;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const config = baseConfig({
    agents: agents(),
    auth: { login: "cloudflare-access", team: TEAM, aud: AUD, allow: [OWNER, GUEST] },
    users: { [GUEST]: { agents: ["apps"] } },
    ...over,
  });
  const db = openDb(":memory:");
  const fake = new FakeDriver();
  const manager = new SessionManager({
    config,
    db,
    drivers: { main: fake, apps: fake, plain: fake },
  });
  const accounts = new AccountsService({
    config,
    sudoPath: FAKE_SUDO,
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(homes, "self") },
    ...timing,
  });
  const app = createHttpApp({
    config,
    db,
    createMcpServer: () => createMcpServer(manager, { maxWaitMs: config.max_wait }),
    dashboard: manager,
    accounts,
    accessKeys: createLocalJWKSet({ keys: [jwk] }),
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  closers.push(
    () => new Promise((r) => listener.close(r)),
    () => manager.shutdown(),
    () => accounts.close(),
  );
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const jwt = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  const get = async (path: string, email = OWNER) =>
    fetch(`${base}${path}`, { headers: { "cf-access-jwt-assertion": await jwt(email) } });
  const post = async (
    path: string,
    body: unknown,
    o: { email?: string; origin?: string | null; type?: string; raw?: string } = {},
  ) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": await jwt(o.email ?? OWNER),
        "content-type": o.type ?? "application/json",
        ...(o.origin === null ? {} : { origin: o.origin ?? PUBLIC_URL }),
      },
      body: o.raw ?? JSON.stringify(body),
    });
  return { base, homes, accounts, get, post };
}

type Info = {
  account: string;
  agents: string[];
  status: string;
  expiresAt?: string;
  subscriptionType?: string;
};
const A = "/dashboard/api/accounts";

describe("account derivation", () => {
  it("one account per Unix user, claude agents only", () => {
    const config = baseConfig({
      agents: { ...agents(), another: { driver: "claude", executable: "/x" } },
    });
    expect(deriveAccounts(config)).toEqual([
      { id: "self", executable: FAKE_LOGIN, agents: ["main", "another"] },
      { id: "diana", executable: FAKE_LOGIN, agents: ["apps"] },
    ]);
  });

  it("parses the authorize URL out of CLI output and ignores foreign hosts", () => {
    const out =
      "Opening browser…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&x=1\nPaste code here if prompted > ";
    expect(parseAuthorizeUrl(out)).toBe("https://claude.com/cai/oauth/authorize?code=true&x=1");
    expect(parseAuthorizeUrl("visit https://evil.example/phish")).toBeUndefined();
    expect(parseAuthorizeUrl("visit https://claude.com.evil.example/x")).toBeUndefined();
  });
});

describe("GET /dashboard/api/accounts", () => {
  it("lists every account for an unrestricted caller, with non-secret status", async () => {
    const { get } = await boot();
    const res = await get(A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Info[];
    expect(body).toEqual([
      { account: "self", agents: ["main"], status: "logged_out" },
      { account: "diana", agents: ["apps"], status: "logged_out" },
    ]);
  });

  it("restricted users see only the accounts their agents run as", async () => {
    const { get } = await boot();
    const body = (await (await get(A, GUEST)).json()) as Info[];
    expect(body.map((a) => a.account)).toEqual(["diana"]);
  });

  it("is empty when no claude agent is configured", async () => {
    const { get } = await boot({}, { agents: { plain: { driver: "fake" } }, users: {} });
    expect(await (await get(A)).json()).toEqual([]);
  });

  it("requires the dashboard identity", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}${A}`)).status).toBe(403);
  });
});

describe("login flow", () => {
  it("start, parse URL, accept code, status flips", async () => {
    const { post, get, homes } = await boot();
    const start = await post(`${A}/diana/login`, {});
    expect(start.status).toBe(200);
    const { loginId, url } = (await start.json()) as { loginId: string; url: string };
    expect(url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    expect(loginId).toBeTruthy();

    const done = await post(`${A}/diana/login/${loginId}`, { code: "good-code#abc" });
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(text).not.toMatch(SECRET);
    expect(text).not.toContain("good-code");
    const body = JSON.parse(text) as { ok: boolean; account: Info };
    expect(body.ok).toBe(true);
    expect(body.account).toMatchObject({ account: "diana", status: "logged_in", subscriptionType: "max" });
    expect(readFileSync(join(homes, "diana", "login.json"), "utf8")).toContain("accessToken");

    const list = (await (await get(A)).json()) as Info[];
    expect(list.map((a) => [a.account, a.status])).toEqual([
      ["self", "logged_out"],
      ["diana", "logged_in"],
    ]);
    expect(JSON.stringify(list)).not.toMatch(SECRET);
  });

  it("works for the switchboard user itself", async () => {
    const { post } = await boot();
    const { loginId } = (await (await post(`${A}/self/login`, {})).json()) as { loginId: string };
    const res = await post(`${A}/self/login/${loginId}`, { code: "good-code#abc" });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("a wrong code fails without echoing it and the login must be restarted", async () => {
    const { post } = await boot();
    const { loginId } = (await (await post(`${A}/diana/login`, {})).json()) as { loginId: string };
    const res = await post(`${A}/diana/login/${loginId}`, { code: "wrong-code#zzz" });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain("wrong-code");
    expect(JSON.parse(text).ok).toBe(false);
    const again = await post(`${A}/diana/login/${loginId}`, { code: "good-code#abc" });
    expect(again.status).toBe(409);
  });

  it("rejects malformed codes", async () => {
    const { post } = await boot();
    const { loginId } = (await (await post(`${A}/diana/login`, {})).json()) as { loginId: string };
    expect((await post(`${A}/diana/login/${loginId}`, { code: "has space\nnewline" })).status).toBe(400);
    expect((await post(`${A}/diana/login/${loginId}`, { code: 5 })).status).toBe(400);
    expect((await post(`${A}/diana/login/${loginId}`, null, { raw: "{nope" })).status).toBe(400);
  });

  it("keeps one active login per account: a new start kills the old one", async () => {
    const { post, homes, accounts } = await boot();
    const first = (await (await post(`${A}/diana/login`, {})).json()) as { loginId: string };
    const pid = Number(readFileSync(join(homes, "diana", "login.pid"), "utf8"));
    const second = (await (await post(`${A}/diana/login`, {})).json()) as { loginId: string };
    expect(second.loginId).not.toBe(first.loginId);
    expect(accounts.activeLogins()).toBe(1);
    await waitDead(pid);
    const stale = await post(`${A}/diana/login/${first.loginId}`, { code: "good-code#abc" });
    expect(stale.status).toBe(409);
  });

  it("kills a login that is not finished within the time limit", async () => {
    const { post, homes, accounts } = await boot({ loginTtlMs: 150 });
    const { loginId } = (await (await post(`${A}/diana/login`, {})).json()) as { loginId: string };
    const pid = Number(readFileSync(join(homes, "diana", "login.pid"), "utf8"));
    await waitDead(pid);
    expect(accounts.activeLogins()).toBe(0);
    expect((await post(`${A}/diana/login/${loginId}`, { code: "good-code#abc" })).status).toBe(409);
  });

  it("reports an error when the CLI prints no sign-in link", async () => {
    const { post } = await boot(
      { urlTimeoutMs: 300 },
      { agents: { apps: { driver: "claude", executable: "/bin/cat", run_as: "diana" } }, users: {} },
    );
    const res = await post(`${A}/diana/login`, {});
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("no_url");
  });
});

describe("access scoping", () => {
  it("restricted users get 404 for accounts they do not own", async () => {
    const { post, get } = await boot();
    expect((await post(`${A}/self/login`, {}, { email: GUEST })).status).toBe(404);
    expect((await post(`${A}/self/login/x`, { code: "a" }, { email: GUEST })).status).toBe(404);
    expect((await post(`${A}/nobody/login`, {}, { email: OWNER })).status).toBe(404);
    expect((await post(`${A}/diana/login`, {}, { email: GUEST })).status).toBe(200);
    expect((await get(A, GUEST)).status).toBe(200);
  });

  it("a restricted user cannot finish another caller's login id on a visible account", async () => {
    const { post } = await boot();
    const { loginId } = (await (await post(`${A}/self/login`, {})).json()) as { loginId: string };
    const res = await post(`${A}/diana/login/${loginId}`, { code: "good-code#abc" }, { email: GUEST });
    expect(res.status).toBe(409);
  });
});

describe("CSRF", () => {
  it("refuses cross-origin, missing-origin and non-JSON posts, and starts nothing", async () => {
    const { post, accounts } = await boot();
    expect((await post(`${A}/diana/login`, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(`${A}/diana/login`, {}, { origin: null })).status).toBe(403);
    expect((await post(`${A}/diana/login`, {}, { type: "text/plain", raw: "{}" })).status).toBe(415);
    expect(
      (await post(`${A}/diana/login`, {}, { type: "application/x-www-form-urlencoded", raw: "a=1" })).status,
    ).toBe(415);
    expect(accounts.activeLogins()).toBe(0);
  });

  it("accepts the request's own host as origin", async () => {
    const { post, base } = await boot();
    const res = await post(`${A}/diana/login`, {}, { origin: base });
    expect(res.status).toBe(200);
  });

  it("requires the authenticated caller", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}${A}/diana/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_URL },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("dashboard page", () => {
  it("ships the Claude login card", async () => {
    const { get } = await boot();
    const html = await (await get("/dashboard")).text();
    expect(html).toContain('id="claudeLogin"');
    expect(html).toContain("/dashboard/api/accounts");
    expect(html).not.toContain("__LOGIN_");
  });
});

async function waitDead(pid: number) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`process ${pid} still alive`);
}
