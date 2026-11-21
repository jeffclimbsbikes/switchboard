import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeDriver } from "../../src/drivers/claude.js";
import type { DriverEvent } from "../../src/drivers/driver.js";
import { passthroughEnv, runAsInvocation } from "../../src/drivers/run-as.js";
import { Recorder } from "../contract/driver-contract.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");
const WRAPPER = 'cd "$0" && exec "$@"';

describe("run_as command construction", () => {
  it("wraps a command in sudo with the environment re-injected", () => {
    expect(
      runAsInvocation(
        { user: "alice" },
        {
          cwd: "/home/alice/src",
          command: "claude",
          args: ["--flag", "a b"],
          env: { PATH: "/bin", CLAUDE_X: "1" },
        },
      ),
    ).toEqual({
      command: "sudo",
      args: [
        "-n",
        "-u",
        "alice",
        "-H",
        "--",
        "env",
        "PATH=/bin",
        "CLAUDE_X=1",
        "bash",
        "-c",
        WRAPPER,
        "/home/alice/src",
        "claude",
        "--flag",
        "a b",
      ],
    });
  });

  it("honours a custom sudo path and an empty environment", () => {
    const inv = runAsInvocation(
      { user: "d", sudoPath: "/x/sudo" },
      { cwd: "/w", command: "c", args: [], env: {} },
    );
    expect(inv).toEqual({
      command: "/x/sudo",
      args: ["-n", "-u", "d", "-H", "--", "env", "bash", "-c", WRAPPER, "/w", "c"],
    });
  });

  it("forwards only claude, anthropic, switchboard variables and PATH", () => {
    expect(
      passthroughEnv(
        {
          PATH: "/bin",
          HOME: "/home/owner",
          CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
          ANTHROPIC_API_KEY: "k",
          SWITCHBOARD_SESSION: "s",
          AWS_SECRET_ACCESS_KEY: "nope",
          CLAUDE: "no",
          ANTHROPIC_UNSET: undefined,
        },
        { EXTRA: "1" },
      ),
    ).toEqual({
      PATH: "/bin",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      ANTHROPIC_API_KEY: "k",
      SWITCHBOARD_SESSION: "s",
      EXTRA: "1",
    });
  });
});

describe("ClaudeDriver with run_as", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.FAKE_SUDO_LOG;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("spawns claude through the sudo wrapper and still completes a turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-as-"));
    dirs.push(dir);
    const cwd = join(dir, "cwd");
    const log = join(dir, "sudo.log");
    process.env.FAKE_SUDO_LOG = log;
    const driver = new ClaudeDriver({
      executable: join(fixtures, "fake-claude.mjs"),
      runAs: "alice",
      sudoPath: join(fixtures, "fake-sudo.sh"),
      env: { FAKE_CLAUDE_STATE: join(dir, "state") },
    });
    const rec = new Recorder();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(cwd);
    const session = await driver.start({ cwd, onEvent: rec.push });
    await session.prompt("hello");
    const end = await rec.waitFor(
      (e: DriverEvent): e is Extract<DriverEvent, { type: "turn_end" }> => e.type === "turn_end",
    );
    expect(end.stopReason).toBe("end_turn");
    await session.close();

    const argv = readFileSync(log, "utf8").trim();
    expect(argv).toMatch(/^-n -u alice -H -- env /);
    expect(argv).toContain("FAKE_CLAUDE_STATE=");
    expect(argv).toContain(`bash -c ${WRAPPER} ${cwd} `);
  });
});
