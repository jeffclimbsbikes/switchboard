import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { canSee, resolveAccess } from "../../src/core/policy.js";

const base = {
  agents: { a: { driver: "fake" }, b: { driver: "fake", default: true }, c: { driver: "fake" } },
  workspaces: { w1: "/tmp", w2: "/var", w3: "/usr" },
};

const config = parseConfig({
  ...base,
  users: {
    "Alice@Example.com": { agents: ["c", "a"], workspaces: ["w2"] },
    "bob@example.com": { agents: ["a", "b"] },
  },
});

describe("resolveAccess", () => {
  it("leaves callers without an email unrestricted", () => {
    const access = resolveAccess(config);
    expect(access.restricted).toBe(false);
    expect(access.agents).toEqual(["a", "b", "c"]);
    expect(access.workspaces).toEqual(["w1", "w2", "w3"]);
    expect(access.defaultAgent).toBe("b");
    expect(access.defaultWorkspace).toBe("w1");
    expect(resolveAccess(config, {}).restricted).toBe(false);
  });

  it("leaves unlisted emails unrestricted", () => {
    const access = resolveAccess(config, { email: "admin@example.com" });
    expect(access.restricted).toBe(false);
    expect(access.agents).toHaveLength(3);
  });

  it("restricts listed users, compared case-insensitively", () => {
    const access = resolveAccess(config, { email: "ALICE@example.com" });
    expect(access).toMatchObject({
      restricted: true,
      email: "alice@example.com",
      agents: ["c", "a"],
      workspaces: ["w2"],
      defaultAgent: "c",
      defaultWorkspace: "w2",
    });
  });

  it("defaults to the global default when it is allowed, and allows everything for omitted lists", () => {
    const access = resolveAccess(config, { email: "bob@example.com" });
    expect(access.defaultAgent).toBe("b");
    expect(access.workspaces).toEqual(["w1", "w2", "w3"]);
    expect(access.defaultWorkspace).toBe("w1");
  });

  it("scopes visibility to the owner", () => {
    const alice = resolveAccess(config, { email: "alice@example.com" });
    const admin = resolveAccess(config);
    expect(canSee(alice, "alice@example.com")).toBe(true);
    expect(canSee(alice, "bob@example.com")).toBe(false);
    expect(canSee(alice, undefined)).toBe(false);
    expect(canSee(admin, "alice@example.com")).toBe(true);
    expect(canSee(admin, undefined)).toBe(true);
  });

  it("does not treat prototype keys as users", () => {
    expect(resolveAccess(config, { email: "constructor" }).restricted).toBe(false);
  });
});

describe("users config", () => {
  it("defaults to none", () => {
    expect(parseConfig(base).users).toEqual({});
  });

  it("rejects unknown agents and workspaces", () => {
    expect(() => parseConfig({ ...base, users: { "x@y.z": { agents: ["nope"] } } })).toThrow(
      /users.x@y.z.agents: unknown agent "nope"/,
    );
    expect(() => parseConfig({ ...base, users: { "x@y.z": { workspaces: ["nope"] } } })).toThrow(
      /unknown workspace "nope"/,
    );
  });
});
