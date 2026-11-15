import type { AddressInfo } from "node:net";
import { Script } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import { DASHBOARD_HTML } from "../../src/http/dashboard/page.js";
import { createHttpApp } from "../../src/http/server.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { ScriptedDriver } from "../core/scripted-driver.js";

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

interface State {
  catalog: Record<string, unknown>;
  agents: object[];
  usage: {
    claude: { windows: Record<string, unknown>[]; probe: boolean };
    ollama?: unknown;
    agents: { agent: string; total: Record<string, number> }[];
    sessions: Record<string, unknown>[];
  };
}

async function boot() {
  const config = parseConfig({
    agents: {
      claude: { driver: "claude", models: [{ id: "opus", default: true, notes: "slow" }] },
      plain: { driver: "fake" },
    },
    workspaces: { w: "/tmp" },
    max_wait: 200,
    auth: { login: "none" },
  });
  const driver = new ScriptedDriver();
  driver.limit.resetsAt = new Date(Date.now() + 3_600_000).toISOString();
  const manager = new SessionManager({
    config,
    db: openDb(":memory:"),
    drivers: { claude: driver, plain: driver },
  });
  const app = createHttpApp({
    config,
    db: openDb(":memory:"),
    createMcpServer: () => createMcpServer(manager, { maxWaitMs: 200 }),
    dashboard: manager,
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  closers.push(
    () => new Promise((r) => listener.close(r)),
    () => manager.shutdown(),
  );
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  return {
    manager,
    state: async () => (await fetch(`${base}/dashboard/api/state?tools=0`)).json() as Promise<State>,
  };
}

describe("dashboard usage and catalog", () => {
  it("carries the catalog and usage, with rate limits and cost flowing through", async () => {
    const t = await boot();
    const view = await t.manager.start({ prompt: "go", agent: "claude" });
    await t.manager.wait(view.session, { maxWaitMs: 1000 });
    const body = await t.state();

    expect(body.catalog).toEqual({ claude: [{ id: "opus", notes: "slow", default: true }] });
    expect(body.agents.every((a) => !("models" in a))).toBe(true);
    expect(body.usage.claude.windows[0]).toMatchObject({
      window: "five_hour",
      label: "5-hour",
      utilization: 0.34,
      status: "allowed",
      source: "session",
    });
    expect(body.usage.claude.probe).toBe(false);
    expect(body.usage.ollama).toBeUndefined();
    expect(body.usage.agents.find((a) => a.agent === "claude")?.total).toMatchObject({
      costUsd: 0.5,
      turns: 1,
      input: 100,
    });
    expect(body.usage.sessions[0]).toMatchObject({ name: view.session, agent: "claude" });
    expect(JSON.stringify(body.usage).length).toBeLessThan(3000);
  });

  it("ships availability, usage and catalog sections in the page", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(DASHBOARD_HTML)?.[1] ?? "";
    expect(() => new Script(script)).not.toThrow();
    expect(DASHBOARD_HTML).toContain("available agents");
    expect(DASHBOARD_HTML).toContain("plan windows");
    expect(DASHBOARD_HTML).toContain('["tools", "Tools"]');
    expect(DASHBOARD_HTML).toContain("API-equivalent cost (subscription usage, not a bill)");
    expect(DASHBOARD_HTML).toContain("https://ollama.com/settings");
    expect(DASHBOARD_HTML).toContain("price not published");
    expect(DASHBOARD_HTML).toContain("undocumented API");
  });
});
