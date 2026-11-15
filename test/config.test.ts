import { describe, expect, it } from "vitest";
import {
  type AgentConfig,
  agentDefaultModel,
  agentModels,
  defaultAgentId,
  parseConfig,
  parseDuration,
  workspaces,
} from "../src/config.js";

const minimal = {
  agents: { claude: { driver: "claude" } },
  workspaces: { pidev: "/srv/pidev" },
};

describe("config", () => {
  it("fills defaults", () => {
    const c = parseConfig(minimal);
    expect(c.listen).toBe("127.0.0.1:8787");
    expect(c.max_wait).toBe(25_000);
    expect(c.auth).toEqual({ login: "none" });
    expect(c.notify.nag_after).toBe(600_000);
    expect(defaultAgentId(c)).toBe("claude");
    expect(workspaces(c)).toEqual([{ id: "pidev", path: "/srv/pidev", default: true }]);
  });

  it("accepts descriptions on agents and workspaces", () => {
    const c = parseConfig({
      agents: {
        a: { driver: "claude", description: "Careful" },
        b: { driver: "acp", command: ["x"], description: "Fast" },
        c: { driver: "fake", description: "Test" },
      },
      workspaces: { plain: "/srv/plain", rich: { path: "/srv/rich", description: "The site" } },
    });
    expect(c.agents.a?.description).toBe("Careful");
    expect(c.agents.b?.description).toBe("Fast");
    expect(c.agents.c?.description).toBe("Test");
    expect(workspaces(c)).toEqual([
      { id: "plain", path: "/srv/plain", default: true },
      { id: "rich", path: "/srv/rich", description: "The site", default: false },
    ]);
  });

  it("limits descriptions to 300 characters", () => {
    const long = "x".repeat(301);
    expect(() =>
      parseConfig({ ...minimal, agents: { claude: { driver: "claude", description: long } } }),
    ).toThrow(/description/);
    expect(() => parseConfig({ ...minimal, workspaces: { w: { path: "/a", description: long } } })).toThrow(
      /description/,
    );
    expect(
      parseConfig({ ...minimal, agents: { claude: { driver: "claude", description: "x".repeat(300) } } }),
    ).toBeTruthy();
  });

  it("parses durations", () => {
    expect(parseDuration("25s")).toBe(25_000);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseConfig({ ...minimal, max_wait: "10s" }).max_wait).toBe(10_000);
  });

  it("picks the agent marked default", () => {
    const c = parseConfig({
      ...minimal,
      agents: {
        claude: { driver: "claude" },
        oc: { driver: "acp", command: ["opencode", "acp"], default: true },
      },
    });
    expect(defaultAgentId(c)).toBe("oc");
  });

  it("explains what is wrong", () => {
    expect(() => parseConfig({ agents: {}, workspaces: {} })).toThrow(/agents: configure at least one agent/);
    expect(() =>
      parseConfig({ ...minimal, auth: { login: "cloudflare-access", team: "t", aud: "a", allow: ["nope"] } }),
    ).toThrow(/auth.allow/);
  });
});

describe("model catalog and usage config", () => {
  const withModels = (models: unknown, extra: Record<string, unknown> = {}) =>
    parseConfig({
      ...minimal,
      agents: { oc: { driver: "acp", command: ["opencode", "acp"], models, ...extra } },
    });

  it("parses catalog entries with prices and notes", () => {
    const c = withModels([
      { id: "ollama-cloud/kimi-k3.1-pro", label: "Kimi", input_price: 0.6, output_price: 2.5, default: true },
      { id: "ollama-cloud/glm-5.3", notes: "fast" },
    ]);
    expect(agentModels(c.agents.oc as AgentConfig)).toEqual([
      { id: "ollama-cloud/kimi-k3.1-pro", label: "Kimi", inputPrice: 0.6, outputPrice: 2.5, default: true },
      { id: "ollama-cloud/glm-5.3", notes: "fast", default: false },
    ]);
  });

  it("rejects duplicate ids, two defaults and negative prices", () => {
    expect(() => withModels([{ id: "a" }, { id: "a" }])).toThrow(/duplicate model "a"/);
    expect(() =>
      withModels([
        { id: "a", default: true },
        { id: "b", default: true },
      ]),
    ).toThrow(/at most one model/);
    expect(() => withModels([{ id: "a", input_price: -1 }])).toThrow(/input_price/);
  });

  it("lets the agent's own model win over the catalog default", () => {
    const catalog = [{ id: "a" }, { id: "b", default: true }];
    expect(agentDefaultModel(withModels(catalog).agents.oc as AgentConfig)).toBe("b");
    expect(agentDefaultModel(withModels(catalog, { model: "a" }).agents.oc as AgentConfig)).toBe("a");
    expect(agentDefaultModel(withModels(undefined).agents.oc as AgentConfig)).toBeUndefined();
  });

  it("defaults usage to nothing and fills the Ollama key variable", () => {
    expect(parseConfig(minimal).usage).toEqual({});
    const c = parseConfig({ ...minimal, usage: { ollama: {}, claude: { probe: true } } });
    expect(c.usage).toEqual({ ollama: { api_key_env: "OLLAMA_API_KEY" }, claude: { probe: true } });
  });
});
