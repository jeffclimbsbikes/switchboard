import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AcpDriver } from "../../src/drivers/acp.js";
import type { AgentSession, DriverEvent } from "../../src/drivers/driver.js";
import { Recorder, runDriverContract } from "../contract/driver-contract.js";

const agentPath = fileURLToPath(new URL("../fixtures/fake-acp-agent.mjs", import.meta.url));

function makeDriver(
  mode: "resume" | "load",
  stateDir: string,
  extra: Record<string, string> = {},
  model?: string,
) {
  return new AcpDriver({
    command: [process.execPath, agentPath],
    env: { FAKE_ACP_STATE_DIR: stateDir, FAKE_ACP_RESUME_MODE: mode, ...extra },
    ...(model ? { model } : {}),
  });
}

for (const mode of ["resume", "load"] as const) {
  const stateDir = mkdtempSync(join(tmpdir(), "fake-acp-state-"));
  afterAll(() => rmSync(stateDir, { recursive: true, force: true }));
  runDriverContract(`acp (${mode})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-acp-"));
    return {
      driver: makeDriver(mode, stateDir),
      cwd: dir,
      cleanup: async () => rmSync(dir, { recursive: true, force: true }),
    };
  });
}

type TurnEnd = Extract<DriverEvent, { type: "turn_end" }>;
type Request = Extract<DriverEvent, { type: "request" }>;
const isTurnEnd = (e: DriverEvent): e is TurnEnd => e.type === "turn_end";
const isRequest = (e: DriverEvent): e is Request => e.type === "request";

describe("acp driver specifics", () => {
  const sessions: AgentSession[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.close().catch(() => {});
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function open(
    opts: {
      mode?: "resume" | "load";
      model?: string;
      env?: Record<string, string>;
      resume?: string;
      dir?: string;
    } = {},
  ) {
    const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "fake-acp-"));
    if (!opts.dir) dirs.push(dir);
    const rec = new Recorder();
    const driver = makeDriver(opts.mode ?? "resume", join(dir, "state"), opts.env, opts.model);
    const session = await driver.start({
      cwd: dir,
      onEvent: rec.push,
      ...(opts.resume ? { resume: opts.resume } : {}),
    });
    sessions.push(session);
    return { session, rec, dir };
  }

  it("applies the configured model through the model config option", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-acp-"));
    dirs.push(dir);
    const log = join(dir, "models.log");
    await open({ dir, model: "fake-large", env: { FAKE_ACP_MODEL_LOG: log } });
    expect(JSON.parse(readFileSync(log, "utf8").trim())).toEqual({ configId: "model", value: "fake-large" });
  });

  it("ignores a model the agent does not offer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-acp-"));
    dirs.push(dir);
    const log = join(dir, "models.log");
    const { session, rec } = await open({ dir, model: "nope", env: { FAKE_ACP_MODEL_LOG: log } });
    await session.prompt("reply ok");
    expect((await rec.waitFor(isTurnEnd)).result).toBe("ok");
    expect(() => readFileSync(log, "utf8")).toThrow();
  });

  it("does not emit the history replayed by session/load", async () => {
    const first = await open({ mode: "load" });
    await first.session.prompt("count");
    await first.rec.waitFor(isTurnEnd);
    const sid = first.rec.events.find((e) => e.type === "session");
    if (sid?.type !== "session") throw new Error("no session event");
    await first.session.close();

    const second = await open({ mode: "load", dir: first.dir, resume: sid.agentSessionId });
    await second.session.prompt("count");
    const end = await second.rec.waitFor(isTurnEnd);
    expect(end.result).toBe("turn 2");
    expect(JSON.stringify(second.rec.events)).not.toContain("REPLAYED");
  });

  it("fails clearly when resuming an unknown conversation", async () => {
    await expect(open({ resume: "fake-missing" })).rejects.toThrow();
  });

  it("maps tool call lifecycle and flushes text at the tool boundary", async () => {
    const { session, rec } = await open();
    await session.prompt("tools");
    const end = await rec.waitFor(isTurnEnd);
    expect(end.result).toBe("before\n\nafter");
    const kinds = rec.events.map((e) => (e.type === "tool" ? `tool:${e.status}` : e.type));
    expect(kinds.filter((k) => k !== "session")).toEqual([
      "text",
      "tool:pending",
      "tool:running",
      "tool:done",
      "text",
      "turn_end",
    ]);
    const titles = rec.events.filter((e) => e.type === "tool").map((e) => (e.type === "tool" ? e.title : ""));
    expect(new Set(titles)).toEqual(new Set(["read file"]));
  });

  it("maps boolean, free text and number form fields and converts answers back", async () => {
    const { session, rec } = await open();
    await session.prompt("askform");
    const { request } = await rec.waitFor(isRequest);
    if (request.kind !== "question") throw new Error("expected question");
    expect(request.questions.map((q) => [q.question, q.options.map((o) => o.label)])).toEqual([
      ["Proceed?", ["yes", "no"]],
      ["Name", []],
      ["Count", []],
    ]);
    await session.respond(request.id, {
      kind: "question",
      answers: { "Proceed?": "yes", Name: "Ada", Count: "3" },
    });
    const end = await rec.waitFor(isTurnEnd);
    expect(JSON.parse((end.result ?? "").replace(/^form: /, ""))).toEqual({
      proceed: true,
      name: "Ada",
      count: 3,
    });
  });

  it("maps every permission option 1:1", async () => {
    const { session, rec } = await open();
    await session.prompt("approve deploy");
    const { request } = await rec.waitFor(isRequest);
    if (request.kind !== "approval") throw new Error("expected approval");
    expect(request.options).toEqual([
      { id: "allow_once", label: "Allow once", kind: "allow_once" },
      { id: "allow_always", label: "Always allow", kind: "allow_always" },
      { id: "reject_once", label: "Reject", kind: "reject_once" },
      { id: "reject_always", label: "Always reject", kind: "reject_always" },
    ]);
    await session.respond(request.id, { kind: "approval", optionId: "reject_always" });
    expect((await rec.waitFor(isTurnEnd)).result).toBe("denied deploy");
  });

  it("cancels a pending permission on interrupt", async () => {
    const { session, rec } = await open();
    await session.prompt("approve deploy");
    await rec.waitFor(isRequest);
    await session.interrupt();
    expect((await rec.waitFor(isTurnEnd)).stopReason).toBe("cancelled");
  });

  it("rejects a second prompt while a turn is running", async () => {
    const { session, rec } = await open();
    await session.prompt("slow 5000");
    await expect(session.prompt("reply hi")).rejects.toThrow(/already running/);
    await session.interrupt();
    await rec.waitFor(isTurnEnd);
  });

  it("reports a missing executable from start()", async () => {
    const driver = new AcpDriver({ command: ["/nonexistent/acp-agent"] });
    await expect(driver.start({ cwd: tmpdir(), onEvent: () => {} })).rejects.toThrow(/cannot start/);
  });
});
