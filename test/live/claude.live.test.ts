import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeDriver } from "../../src/drivers/claude.js";
import type { DriverEvent } from "../../src/drivers/driver.js";
import { Recorder } from "../contract/driver-contract.js";

const live = process.env.SWITCHBOARD_LIVE === "1";
const isTurnEnd = (e: DriverEvent): e is Extract<DriverEvent, { type: "turn_end" }> => e.type === "turn_end";
const isSession = (e: DriverEvent): e is Extract<DriverEvent, { type: "session" }> => e.type === "session";

describe.skipIf(!live)("claude live", () => {
  const cwd = mkdtempSync(join(tmpdir(), "switchboard-live-"));
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  it("round-trips a turn and resumes the conversation", async () => {
    const driver = new ClaudeDriver({ model: "haiku", permissionMode: "default" });

    const first = new Recorder();
    const s1 = await driver.start({ cwd, onEvent: first.push });
    await s1.prompt("Reply with the word ok and nothing else.");
    const end = await first.waitFor(isTurnEnd, 90_000);
    expect(end.stopReason).toBe("end_turn");
    expect(end.result?.toLowerCase()).toContain("ok");
    const { agentSessionId } = await first.waitFor(isSession);
    await s1.close();

    const second = new Recorder();
    const s2 = await driver.start({ cwd, resume: agentSessionId, onEvent: second.push });
    await s2.prompt("What single word did I ask you to reply with earlier? Answer with just that word.");
    const end2 = await second.waitFor(isTurnEnd, 90_000);
    expect(end2.result?.toLowerCase()).toContain("ok");
    await s2.close();
  }, 200_000);
});
