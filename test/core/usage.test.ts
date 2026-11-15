import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SwitchboardError } from "../../src/core/api.js";
import { SessionManager } from "../../src/core/sessions.js";
import { SessionStore } from "../../src/core/store.js";
import { parseOllamaUsage, UsageService } from "../../src/core/usage.js";
import { openDb } from "../../src/db.js";
import { iso, NOW, ScriptedDriver } from "./scripted-driver.js";

const managers: SessionManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});

function setup(extra: Record<string, unknown> = {}, usageFetch?: typeof fetch, probe?: () => Promise<never>) {
  const config = parseConfig({
    agents: {
      cl: {
        driver: "claude",
        models: [
          { id: "opus", label: "Opus", default: true },
          { id: "sonnet", description: "Quick", input_price: 3, output_price: 15 },
        ],
      },
      oc: {
        driver: "acp",
        command: ["opencode", "acp"],
        model: "ollama-cloud/glm-5.3",
        models: [
          { id: "ollama-cloud/kimi-k3.1-pro", label: "Kimi", default: true },
          { id: "ollama-cloud/glm-5.3" },
        ],
      },
      plain: { driver: "fake" },
    },
    workspaces: { w: "/tmp" },
    max_wait: 200,
    ...extra,
  });
  const db = openDb(":memory:");
  const driver = new ScriptedDriver();
  const clock = { now: NOW };
  const usage = new UsageService({
    config,
    db,
    now: () => clock.now,
    ...(usageFetch ? { fetch: usageFetch } : {}),
    env: { OLLAMA_API_KEY: "sk-test" },
    log: () => {},
    ...(probe ? { probe } : {}),
  });
  const manager = new SessionManager({
    config,
    db,
    drivers: { cl: driver, oc: driver, plain: driver },
    now: () => clock.now,
    usage,
  });
  managers.push(manager);
  return { manager, usage, driver, db, clock, config };
}

async function expectError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SwitchboardError);
  expect((err as SwitchboardError).code).toBe(code);
  return err as SwitchboardError;
}

describe("model catalog", () => {
  it("lists models under each agent and the effective default", () => {
    const { manager } = setup();
    const agents = manager.agents();
    expect(agents.find((a) => a.id === "cl")).toMatchObject({
      model: "opus",
      models: [
        { id: "opus", label: "Opus", default: true },
        { id: "sonnet", description: "Quick", inputPrice: 3, outputPrice: 15, default: false },
      ],
    });
    expect(agents.find((a) => a.id === "oc")?.model).toBe("ollama-cloud/glm-5.3");
    expect(agents.find((a) => a.id === "plain")).toEqual({ id: "plain", driver: "fake", default: false });
  });

  it("accepts a catalog model and hands it to the driver", async () => {
    const { manager, driver } = setup();
    await manager.start({ prompt: "go", agent: "oc", model: "ollama-cloud/glm-5.3" });
    expect(driver.starts[0]?.model).toBe("ollama-cloud/glm-5.3");
  });

  it("rejects a model outside the catalog and lists the options", async () => {
    const { manager, driver } = setup();
    const err = await expectError(manager.start({ prompt: "go", agent: "cl", model: "haiku" }), "bad_input");
    expect(err.message).toBe("The cl agent has no model called haiku. Choose one of: opus, sonnet.");
    expect(driver.starts).toHaveLength(0);
  });

  it("keeps today's behaviour for agents without a catalog", async () => {
    const { manager, driver } = setup();
    await manager.start({ prompt: "go", agent: "plain", model: "anything" });
    expect(driver.starts[0]?.model).toBe("anything");
  });

  it("falls back to the agent's model, then the catalog default", async () => {
    const { manager, driver } = setup();
    await manager.start({ prompt: "go", agent: "oc" });
    await manager.start({ prompt: "go", agent: "cl" });
    expect(driver.starts.map((s) => s.model)).toEqual(["ollama-cloud/glm-5.3", "opus"]);
  });
});

describe("usage tracking", () => {
  it("keeps per-session totals and the latest plan windows", async () => {
    const { manager, usage, db } = setup();
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    await manager.send(view.session, "again");
    await manager.wait(view.session, { maxWaitMs: 1000 });

    const row = new SessionStore(db).get(view.session);
    expect(row?.usage).toEqual({
      turns: 2,
      costUsd: 1,
      input: 200,
      output: 40,
      cacheRead: 100,
      cacheWrite: 20,
    });
    const plan = usage.claudePlan();
    expect(plan.windows).toEqual([
      {
        window: "five_hour",
        label: "5-hour",
        utilization: 0.34,
        status: "allowed",
        resetsAt: iso(3_600_000),
        seenAt: NOW.toISOString(),
        source: "session",
      },
    ]);
    expect(plan).toMatchObject({ lastSeenAt: NOW.toISOString(), source: "session" });
    const stored = await manager.wait(view.session, { maxWaitMs: 0 });
    expect(JSON.stringify(stored.activity)).not.toContain("rate_limit");
  });

  it("persists plan windows across restarts", async () => {
    const first = setup();
    const view = await first.manager.start({ prompt: "go", agent: "cl" });
    await first.manager.wait(view.session, { maxWaitMs: 1000 });
    const again = new UsageService({ config: first.config, db: first.db, now: () => NOW });
    expect(again.claudePlan().windows[0]).toMatchObject({ window: "five_hour", utilization: 0.34 });
  });

  it("drops windows that have already reset", async () => {
    const { manager, usage, clock } = setup();
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    clock.now = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(usage.claudePlan().windows).toEqual([]);
  });

  it("charges a resumed conversation only for its new turns", async () => {
    const { manager, driver } = setup();
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    await manager.stop(view.session, "close");
    expect(driver.starts[0]?.priorCostUsd).toBeUndefined();
    const second = await manager.start({ prompt: "other", agent: "cl" });
    await manager.wait(second.session, { maxWaitMs: 1000 });
    await (manager as unknown as { park(n: string): Promise<void> }).park(second.session);
    await manager.send(second.session, "more");
    expect(driver.starts.at(-1)?.priorCostUsd).toBe(0.5);
  });

  it("aggregates today, 7 days and all time per agent and session", async () => {
    const { manager, driver, clock } = setup();
    const a = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(a.session, { maxWaitMs: 1000 });
    clock.now = new Date(NOW.getTime() + 2 * 86_400_000);
    driver.costUsd = 2;
    await manager.send(a.session, "later");
    await manager.wait(a.session, { maxWaitMs: 1000 });

    const snap = manager.snapshot();
    const cl = snap.usage.agents.find((x) => x.agent === "cl");
    expect(cl?.today).toMatchObject({ costUsd: 2, turns: 1 });
    expect(cl?.week).toMatchObject({ costUsd: 2.5, turns: 2 });
    expect(cl?.total).toMatchObject({ costUsd: 2.5, turns: 2, input: 200 });
    expect(snap.usage.sessions).toHaveLength(1);
    expect(snap.usage.sessions[0]).toMatchObject({ name: a.session, agent: "cl" });
    expect(snap.usage.sessions[0]?.week.costUsd).toBe(2.5);
    expect(Object.keys(snap.catalog).sort()).toEqual(["cl", "oc"]);
    expect(snap.agents.every((x) => !("models" in x))).toBe(true);
  });

  it("migrates a database from before usage totals existed", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sessions (
      name TEXT PRIMARY KEY, agent TEXT NOT NULL, workspace TEXT NOT NULL, cwd TEXT NOT NULL, model TEXT,
      title TEXT NOT NULL, state TEXT NOT NULL, agent_session_id TEXT, pending TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, last_activity TEXT, owner TEXT)`);
    db.prepare(
      "INSERT INTO sessions (name, agent, workspace, cwd, title, state, created_at, updated_at) VALUES ('old','a','w','/','t','idle','x','x')",
    ).run();
    const store = new SessionStore(db);
    expect(store.get("old")?.usage).toEqual({
      turns: 0,
      costUsd: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    store.addTurn("old", { costUsd: 1.5 });
    expect(store.get("old")?.usage).toMatchObject({ turns: 1, costUsd: 1.5 });
  });
});

describe("usage hint and visibility", () => {
  it("summarises plan windows and Ollama usage for the MCP client", async () => {
    const fetchMock = fakeOllama();
    const { manager, usage, driver } = setup({ usage: { ollama: {} } }, fetchMock.fetch);
    driver.limit = {
      window: "seven_day",
      utilization: 0.61,
      status: "allowed",
      resetsAt: iso(2 * 86_400_000),
    };
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    await usage.refreshOllama();
    expect(manager.usageHint()).toMatch(
      /^Usage: Claude plan: 7-day 61% \(resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\); Ollama: Pro, 412 requests this week$/,
    );
  });

  it("only mentions providers the caller's agents use", async () => {
    const { manager, usage } = setup(
      {
        usage: { ollama: {} },
        users: { "diana@example.com": { agents: ["plain"] }, "ollie@example.com": { agents: ["oc"] } },
      },
      fakeOllama().fetch,
    );
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    await usage.refreshOllama();
    expect(manager.usageHint({ email: "diana@example.com" })).toBeUndefined();
    expect(manager.usageHint({ email: "ollie@example.com" })).toBe(
      "Usage: Ollama: Pro, 412 requests this week",
    );
    expect(manager.usageHint()).toContain("Claude plan: 5-hour 34%");
    const snap = manager.snapshot({ email: "diana@example.com" });
    expect(snap.usage.claude).toBeUndefined();
    expect(snap.usage.ollama).toBeUndefined();
    expect(snap.usage.sessions).toEqual([]);
  });

  it("is silent when nothing is known", () => {
    expect(setup().manager.usageHint()).toBeUndefined();
  });
});

function fakeOllama(over: { me?: () => Response; usage?: () => Response } = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const days = Array.from({ length: 9 }, (_, i) => ({
    date: `2026-11-${String(5 + i).padStart(2, "0")}T00:00:00Z`,
    request_count: i === 8 ? 100 : 39,
  }));
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/api/me")) {
      return (
        over.me?.() ??
        json({ id: "u_123", email: "jeff@example.com", name: "Jeff Aronhalt", Plan: "pro", avatar: "x" })
      );
    }
    return over.usage?.() ?? json({ usage: days, total: { request_count: 412 } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe("Ollama poller", () => {
  it("reads the plan and 7 days of requests and drops everything personal", async () => {
    const mock = fakeOllama();
    const { usage } = setup({ usage: { ollama: {} } }, mock.fetch);
    await usage.refreshOllama();
    const o = usage.ollama();
    expect(o).toEqual({
      plan: "pro",
      days: expect.any(Array),
      totalRequests: 412,
      fetchedAt: NOW.toISOString(),
    });
    expect(o?.days).toHaveLength(7);
    expect(o?.days.at(-1)).toEqual({ date: "2026-11-13", requests: 100 });
    const raw = JSON.stringify(o);
    for (const secret of ["jeff@example.com", "Jeff", "u_123", "sk-test", "avatar"]) {
      expect(raw).not.toContain(secret);
    }
    expect(mock.calls.map((c) => [c.url, c.auth])).toEqual([
      ["https://ollama.com/api/me", "Bearer sk-test"],
      ["https://ollama.com/api/usage", "Bearer sk-test"],
    ]);
  });

  it("caches for ten minutes and refreshes when stale", async () => {
    const mock = fakeOllama();
    const { usage, clock } = setup({ usage: { ollama: {} } }, mock.fetch);
    usage.tick();
    await usage.refreshOllama();
    usage.tick();
    expect(mock.calls).toHaveLength(2);
    clock.now = new Date(NOW.getTime() + 11 * 60_000);
    usage.tick();
    await usage.refreshOllama();
    expect(mock.calls).toHaveLength(4);
  });

  it("fails soft and keeps the last good data", async () => {
    let broken = false;
    const mock = fakeOllama({
      me: () => (broken ? new Response("secret body", { status: 500 }) : new Response('{"Plan":"max"}')),
      usage: () => (broken ? new Response("nope", { status: 401 }) : new Response('{"usage":[]}')),
    });
    const { usage } = setup({ usage: { ollama: {} } }, mock.fetch);
    await usage.refreshOllama();
    expect(usage.ollama()?.plan).toBe("max");
    broken = true;
    await usage.refreshOllama();
    expect(usage.ollama()).toMatchObject({
      plan: "max",
      error: "/api/me: HTTP 500; /api/usage: HTTP 401",
    });
    expect(JSON.stringify(usage.ollama())).not.toContain("secret body");
  });

  it("survives a throwing fetch and a missing key", async () => {
    const boom = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const { usage } = setup({ usage: { ollama: {} } }, boom);
    await usage.refreshOllama();
    expect(usage.ollama()?.error).toContain("offline");

    const config = parseConfig({
      agents: { a: { driver: "fake" } },
      workspaces: { w: "/tmp" },
      usage: { ollama: { api_key_env: "NOPE" } },
    });
    const keyless = new UsageService({ config, db: openDb(":memory:"), env: {}, log: () => {} });
    await keyless.refreshOllama();
    expect(keyless.ollama()?.error).toBe("NOPE is not set");
  });

  it("is absent when not configured", async () => {
    const { usage, manager } = setup();
    await usage.refreshOllama();
    expect(usage.ollama()).toBeUndefined();
    expect(manager.snapshot().usage.ollama).toBeUndefined();
  });

  it("reads the usage payload in a few plausible shapes", () => {
    expect(parseOllamaUsage([{ date: "2026-11-01", request_count: 3 }])).toEqual({
      days: [{ date: "2026-11-01", requests: 3 }],
      totalRequests: 3,
    });
    expect(parseOllamaUsage({ days: [{ day: "2026-11-02", request_count: 4 }], total_requests: 9 })).toEqual({
      days: [{ date: "2026-11-02", requests: 4 }],
      totalRequests: 9,
    });
    expect(parseOllamaUsage({ hello: "world" })).toBeUndefined();
  });
});

describe("Claude plan probe (experimental)", () => {
  const result = {
    available: true,
    subscriptionType: "max",
    windows: [
      { window: "five_hour", utilization: 0.34, resetsAt: iso(3_600_000) },
      { window: "seven_day", utilization: 0.85, resetsAt: iso(86_400_000) },
    ],
  };

  it("stores windows and the plan type, deriving a status", async () => {
    const { usage } = setup({ usage: { claude: { probe: true } } }, undefined, async () => result as never);
    await usage.probeClaude();
    const plan = usage.claudePlan();
    expect(plan).toMatchObject({ subscriptionType: "max", probe: true, source: "probe" });
    expect(plan.windows.map((w) => [w.label, w.utilization, w.status, w.source])).toEqual([
      ["5-hour", 0.34, "allowed", "probe"],
      ["7-day", 0.85, "warning", "probe"],
    ]);
  });

  it("only probes when no live event was seen in the last 15 minutes", async () => {
    let probes = 0;
    const { usage, clock, manager } = setup({ usage: { claude: { probe: true } } }, undefined, async () => {
      probes++;
      return result as never;
    });
    const view = await manager.start({ prompt: "go", agent: "cl" });
    await manager.wait(view.session, { maxWaitMs: 1000 });
    usage.tick();
    expect(probes).toBe(0);
    clock.now = new Date(NOW.getTime() + 16 * 60_000);
    usage.tick();
    usage.tick();
    await usage.probeClaude();
    expect(probes).toBe(1);
  });

  it("logs and ignores failures", async () => {
    const logged: string[] = [];
    const config = parseConfig({
      agents: { a: { driver: "claude" } },
      workspaces: { w: "/tmp" },
      usage: { claude: { probe: true } },
    });
    const usage = new UsageService({
      config,
      db: openDb(":memory:"),
      log: (m) => logged.push(m),
      probe: async () => {
        throw new Error("no such method");
      },
    });
    await usage.probeClaude();
    expect(logged).toEqual(["claude usage probe failed: no such method"]);
    expect(usage.claudePlan().windows).toEqual([]);
  });

  it("notes when plan limits do not apply", async () => {
    const { usage } = setup(
      { usage: { claude: { probe: true } } },
      undefined,
      async () =>
        ({
          available: false,
          windows: [],
        }) as never,
    );
    await usage.probeClaude();
    expect(usage.claudePlan().unavailable).toBe(true);
  });

  it("is off unless configured", async () => {
    const { usage } = setup();
    await usage.probeClaude();
    expect(usage.claudePlan()).toEqual({ windows: [], probe: false });
  });
});

describe("ollama usage shape seen in production", () => {
  it("reads daily buckets keyed by `from` and the totals", async () => {
    const { parseOllamaUsage } = await import("../../src/core/usage.js");
    const parsed = parseOllamaUsage({
      range: "7d",
      totals: { request_count: 2418 },
      buckets: [
        { from: "2026-11-08T00:00:00Z", until: "2026-11-09T00:00:00Z", request_count: 11 },
        { from: "2026-11-14T00:00:00Z", until: "2026-11-15T00:00:00Z", request_count: 5 },
        { from: "2026-11-15T00:00:00Z", until: "2026-11-15T04:13:35Z", partial: true, request_count: 2402 },
      ],
    });
    expect(parsed?.days.map((d) => d.date)).toEqual(["2026-11-08", "2026-11-14", "2026-11-15"]);
    expect(parsed?.totalRequests).toBe(2418);
  });
});
