import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AcpDriver } from "../../src/drivers/acp.js";
import type { DriverEvent } from "../../src/drivers/driver.js";

describe.skipIf(process.env.SWITCHBOARD_LIVE !== "1")("acp live: opencode", () => {
  it("initializes, creates a session and closes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-live-"));
    const events: DriverEvent[] = [];
    try {
      const session = await new AcpDriver({ command: ["opencode", "acp"] }).start({
        cwd,
        onEvent: (e) => events.push(e),
      });
      expect(events.some((e) => e.type === "session")).toBe(true);
      await session.close();
      expect(events.some((e) => e.type === "error")).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});
