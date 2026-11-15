import { describe, expect, it } from "vitest";
import { defaultAgentId, parseConfig, parseDuration, workspaces } from "../src/config.js";

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
