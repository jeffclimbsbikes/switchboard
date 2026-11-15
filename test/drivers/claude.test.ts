import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeDriver, type ClaudeDriverOptions } from "../../src/drivers/claude.js";
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
