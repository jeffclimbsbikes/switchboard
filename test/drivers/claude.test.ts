import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeDriver, type ClaudeDriverOptions, rateLimitEvent } from "../../src/drivers/claude.js";
import { probeClaudeUsage } from "../../src/drivers/claude-usage.js";
import type { DriverEvent } from "../../src/drivers/driver.js";
import { type ContractHarness, Recorder, runDriverContract } from "../contract/driver-contract.js";

const fake = resolve(import.meta.dirname, "../fixtures/fake-claude.mjs");

function harness(opts: ClaudeDriverOptions = {}) {
  const state = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const cwd = mkdtempSync(join(tmpdir(), "fake-claude-cwd-"));
  const driver = new ClaudeDriver({
    executable: fake,
    ...opts,
    env: { FAKE_CLAUDE_STATE: state, ...opts.env },
  });
  const cleanup = async () => {
    rmSync(state, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  };
  return { driver, cwd, state, cleanup };
}

const stateDirs = new Map<string, string>();
runDriverContract("claude (fake-claude)", async (): Promise<ContractHarness> => {
  const shared = stateDirs.get("contract") ?? mkdtempSync(join(tmpdir(), "fake-claude-"));
  stateDirs.set("contract", shared);
  const h = harness({ env: { FAKE_CLAUDE_STATE: shared } });
  return { driver: h.driver, cwd: h.cwd, cleanup: h.cleanup };
});

const isRequest = (e: DriverEvent): e is Extract<DriverEvent, { type: "request" }> => e.type === "request";
const isTurnEnd = (e: DriverEvent): e is Extract<DriverEvent, { type: "turn_end" }> => e.type === "turn_end";

describe("ClaudeDriver specifics", () => {
  it("still surfaces questions in bypassPermissions mode", async () => {
    const h = harness({ permissionMode: "bypassPermissions" });
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("ask pick? | a | b");
    const { request } = await rec.waitFor(isRequest);
    expect(request.kind).toBe("question");
    await s.respond(request.id, { kind: "question", answers: { "pick?": "a" } });
    expect((await rec.waitFor(isTurnEnd)).result).toBe("answered: a");
    await s.close();
    await h.cleanup();
  });

  it("does not prompt for tool approval in bypassPermissions mode", async () => {
    const h = harness({ permissionMode: "bypassPermissions" });
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("approve deploy");
    expect((await rec.waitFor(isTurnEnd)).result).toBe("approved deploy");
    expect(rec.events.some(isRequest)).toBe(false);
    await s.close();
    await h.cleanup();
  });

  it("joins multi-select answers", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("ask which? | a | b");
    const { request } = await rec.waitFor(isRequest);
    await s.respond(request.id, { kind: "question", answers: { "which?": ["a", "b"] } });
    expect((await rec.waitFor(isTurnEnd)).result).toBe("answered: a, b");
    await s.close();
    await h.cleanup();
  });

  it("titles tools with a short argument summary and reports completion", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("slow 50");
    await rec.waitFor(isTurnEnd);
    const tools = rec.events.filter((e) => e.type === "tool");
    expect(tools).toEqual([
      { type: "tool", id: expect.any(String), title: "Bash: sleep 0.05", status: "running" },
      { type: "tool", id: expect.any(String), title: "Bash: sleep 0.05", status: "done" },
    ]);
    await s.close();
    await h.cleanup();
  });

  it("marks rejected tools failed and passes the rejection message", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("approve deploy");
    const { request } = await rec.waitFor(isRequest);
    await s.respond(request.id, { kind: "approval", optionId: "reject", message: "nope" });
    await rec.waitFor(isTurnEnd);
    expect(rec.events.filter((e) => e.type === "tool").map((e) => e.type === "tool" && e.status)).toEqual([
      "running",
      "failed",
    ]);
    const log = readFileSync(join(h.state, "log.jsonl"), "utf8");
    expect(log).toContain('"message":"nope"');
    await s.close();
    await h.cleanup();
  });

  it("allow_always forwards the permission suggestions", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("approve deploy");
    const { request } = await rec.waitFor(isRequest);
    if (request.kind !== "approval") throw new Error("expected approval");
    expect(request.options.map((o) => o.kind)).toEqual(["allow_once", "allow_always", "reject_once"]);
    const always = request.options.find((o) => o.kind === "allow_always");
    await s.respond(request.id, { kind: "approval", optionId: always?.id as string });
    expect((await rec.waitFor(isTurnEnd)).result).toBe("approved deploy");
    const entry = readFileSync(join(h.state, "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .find((e) => e.kind === "approve_response");
    expect(entry.response.updatedPermissions).toEqual([
      { type: "addRules", rules: [{ toolName: "deploy" }], behavior: "allow", destination: "localSettings" },
    ]);
    await s.close();
    await h.cleanup();
  });

  it("denies a pending request when the turn is interrupted", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("approve deploy");
    await rec.waitFor(isRequest);
    await s.interrupt();
    await rec.waitFor(isTurnEnd);
    await s.close();
    await h.cleanup();
  });
});

describe("ClaudeDriver models and usage", () => {
  const init = (state: string) =>
    readFileSync(join(state, "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((e) => e.kind === "init");

  it("passes the per-session model to the SDK, overriding the driver default", async () => {
    const h = harness({ model: "sonnet" });
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, model: "opus", onEvent: rec.push });
    await s.prompt("reply hi");
    await rec.waitFor(isTurnEnd);
    expect(init(h.state).map((e) => e.model)).toEqual(["opus"]);
    await s.close();
    const other = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await other.prompt("reply hi");
    await rec.waitFor(() => rec.events.filter(isTurnEnd).length === 2);
    expect(init(h.state).map((e) => e.model)).toEqual(["opus", "sonnet"]);
    await other.close();
    await h.cleanup();
  });

  it("reports each turn's own cost and tokens, not the running total", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("reply one");
    await rec.waitFor(isTurnEnd);
    await s.prompt("reply two");
    await rec.waitFor(() => rec.events.filter(isTurnEnd).length === 2);
    const ends = rec.events.filter(isTurnEnd);
    expect(ends.map((e) => e.costUsd)).toEqual([0.25, 0.25]);
    expect(ends[0]?.tokens).toEqual({ input: 100, output: 20, cacheRead: 50, cacheWrite: 10 });
    await s.close();
    await h.cleanup();
  });

  it("subtracts the cost a resumed conversation already carries", async () => {
    const h = harness();
    const rec = new Recorder();
    const first = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await first.prompt("reply one");
    await rec.waitFor(isTurnEnd);
    const sid = rec.events.find((e) => e.type === "session");
    if (sid?.type !== "session") throw new Error("no session event");
    await first.close();

    const again = new Recorder();
    const resumed = await h.driver.start({
      cwd: h.cwd,
      resume: sid.agentSessionId,
      priorCostUsd: 0.25,
      onEvent: again.push,
    });
    await resumed.prompt("reply two");
    expect((await again.waitFor(isTurnEnd)).costUsd).toBe(0.25);
    await resumed.close();
    await h.cleanup();
  });

  it("turns SDK rate limit events into rate_limit events", async () => {
    const h = harness();
    const rec = new Recorder();
    const s = await h.driver.start({ cwd: h.cwd, onEvent: rec.push });
    await s.prompt("reply hi");
    await rec.waitFor(isTurnEnd);
    const limit = rec.events.find((e) => e.type === "rate_limit");
    expect(limit).toMatchObject({
      type: "rate_limit",
      provider: "claude",
      window: "five_hour",
      utilization: 0.42,
      status: "warning",
    });
    if (limit?.type !== "rate_limit") throw new Error("no rate_limit");
    expect(Date.parse(limit.resetsAt ?? "")).toBeGreaterThan(Date.now());
    await s.close();
    await h.cleanup();
  });

  it("maps rate limit info edge cases", () => {
    expect(rateLimitEvent({ status: "rejected", rateLimitType: "seven_day", utilization: 100 })).toEqual({
      type: "rate_limit",
      provider: "claude",
      window: "seven_day",
      status: "rejected",
      utilization: 1,
    });
    expect(rateLimitEvent({ status: "allowed" })).toBeUndefined();
  });

  it("probes plan usage through the experimental request without sending a prompt", async () => {
    const h = harness();
    const probe = await probeClaudeUsage({ executable: fake, env: { FAKE_CLAUDE_STATE: h.state } });
    expect(probe).toMatchObject({ available: true, subscriptionType: "max" });
    expect(probe.windows.map((w) => [w.window, w.utilization])).toEqual([
      ["five_hour", 0.34],
      ["seven_day", 0.61],
    ]);
    expect(() => readFileSync(join(h.state, "log.jsonl"), "utf8")).toThrow();
    await h.cleanup();
  });
});
