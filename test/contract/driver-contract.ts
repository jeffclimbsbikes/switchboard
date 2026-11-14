/**
 * Shared driver contract. Every driver runs this suite against a fake agent
 * that understands the same prompt script:
 *
 *   reply <text>                  → text "<text>", turn_end end_turn, result "<text>"
 *   count                         → "turn <n>", n = turns in this conversation incl. this one (survives resume)
 *   ask <question> | <a> | <b>    → request {kind: question, one question, options a, b}
 *                                   answered → "answered: <label>"
 *   approve <tool>                → request {kind: approval, tool, options incl. allow_once + reject_once}
 *                                   allow → "approved <tool>", reject → "denied <tool>"
 *   slow <ms>                     → tool event (running), then after ms "slept"; interrupt → turn_end cancelled
 *   crash                         → the agent process dies → error {fatal: true}
 *
 * Every session emits a `session` event (its resumable id) before its first turn_end.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession, Driver, DriverEvent } from "../../src/drivers/driver.js";

export interface ContractHarness {
  driver: Driver;
  cwd: string;
  cleanup?: () => Promise<void>;
}

export class Recorder {
  events: DriverEvent[] = [];
  private waiters: (() => void)[] = [];

  push = (e: DriverEvent) => {
    this.events.push(e);
    for (const w of this.waiters.splice(0)) w();
  };

  async waitFor<T extends DriverEvent>(pred: (e: DriverEvent) => e is T, timeoutMs?: number): Promise<T>;
  async waitFor(pred: (e: DriverEvent) => boolean, timeoutMs?: number): Promise<DriverEvent>;
  async waitFor(pred: (e: DriverEvent) => boolean, timeoutMs = 15_000): Promise<DriverEvent> {
    const deadline = Date.now() + timeoutMs;
    let from = 0;
    for (;;) {
      const hit = this.events.slice(from).find(pred);
      if (hit) return hit;
      from = this.events.length;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; events so far: ${JSON.stringify(this.events)}`);
      await new Promise<void>((res) => {
        const t = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }
  }

  /** Events after the given index. */
  since(i: number) {
    return this.events.slice(i);
  }
}

const isTurnEnd = (e: DriverEvent): e is Extract<DriverEvent, { type: "turn_end" }> => e.type === "turn_end";
const isRequest = (e: DriverEvent): e is Extract<DriverEvent, { type: "request" }> => e.type === "request";
const isSession = (e: DriverEvent): e is Extract<DriverEvent, { type: "session" }> => e.type === "session";

export function runDriverContract(label: string, makeHarness: () => Promise<ContractHarness>) {
  describe(`driver contract: ${label}`, () => {
    const open: { session: AgentSession; h: ContractHarness }[] = [];

    async function start(resume?: string) {
      const h = await makeHarness();
      const rec = new Recorder();
      const session = await h.driver.start({ cwd: h.cwd, onEvent: rec.push, ...(resume ? { resume } : {}) });
      open.push({ session, h });
      return { session, rec, h };
    }

    async function turn(session: AgentSession, rec: Recorder, text: string) {
      const mark = rec.events.length;
      await session.prompt(text);
      const end = await rec.waitFor((e): e is Extract<DriverEvent, { type: "turn_end" }> => {
        return isTurnEnd(e) && rec.events.indexOf(e) >= mark;
      });
      return end;
    }

    afterEach(async () => {
      for (const { session, h } of open.splice(0)) {
        await session.close().catch(() => {});
        await h.cleanup?.().catch(() => {});
      }
    });

    it("replies and reports a resumable session id", async () => {
      const { session, rec } = await start();
      const end = await turn(session, rec, "reply hello");
      expect(end.stopReason).toBe("end_turn");
      expect(end.result).toBe("hello");
      expect(rec.events.some((e) => e.type === "text" && e.text.includes("hello"))).toBe(true);
      const sid = rec.events.findIndex(isSession);
      expect(sid).toBeGreaterThanOrEqual(0);
      expect(sid).toBeLessThan(rec.events.indexOf(end));
    });

    it("keeps context across turns", async () => {
      const { session, rec } = await start();
      expect((await turn(session, rec, "count")).result).toBe("turn 1");
      expect((await turn(session, rec, "count")).result).toBe("turn 2");
    });

    it("surfaces a question and continues with the answer", async () => {
      const { session, rec } = await start();
      const mark = rec.events.length;
      await session.prompt("ask which colour? | red | blue");
      const { request } = await rec.waitFor(isRequest);
      expect(request.kind).toBe("question");
      if (request.kind !== "question") throw new Error("unreachable");
      const q = request.questions[0];
      expect(q?.question).toBe("which colour?");
      expect(q?.options.map((o) => o.label)).toEqual(["red", "blue"]);
      await session.respond(request.id, { kind: "question", answers: { "which colour?": "blue" } });
      const end = await rec.waitFor((e): e is Extract<DriverEvent, { type: "turn_end" }> => {
        return isTurnEnd(e) && rec.events.indexOf(e) > mark;
      });
      expect(end.result).toBe("answered: blue");
    });

    for (const [choice, expected] of [
      ["allow_once", "approved deploy"],
      ["reject_once", "denied deploy"],
    ] as const) {
      it(`asks for approval and honours ${choice}`, async () => {
        const { session, rec } = await start();
        await session.prompt("approve deploy");
        const { request } = await rec.waitFor(isRequest);
        expect(request.kind).toBe("approval");
        if (request.kind !== "approval") throw new Error("unreachable");
        expect(request.tool).toContain("deploy");
        const option = request.options.find((o) => o.kind === choice);
        expect(option).toBeDefined();
        await session.respond(request.id, { kind: "approval", optionId: option?.id as string });
        const end = await rec.waitFor(isTurnEnd);
        expect(end.result).toBe(expected);
      });
    }

    it("interrupts a running turn", async () => {
      const { session, rec } = await start();
      await session.prompt("slow 10000");
      await rec.waitFor((e) => e.type === "tool");
      const t0 = Date.now();
      await session.interrupt();
      const end = await rec.waitFor(isTurnEnd, 5_000);
      expect(end.stopReason).toBe("cancelled");
      expect(Date.now() - t0).toBeLessThan(5_000);
    });

    it("resumes a closed conversation", async () => {
      const first = await start();
      expect((await turn(first.session, first.rec, "count")).result).toBe("turn 1");
      const { agentSessionId } = await first.rec.waitFor(isSession);
      await first.session.close();
      const second = await start(agentSessionId);
      expect((await turn(second.session, second.rec, "count")).result).toBe("turn 2");
    });

    it("reports a crash as a fatal error", async () => {
      const { session, rec } = await start();
      await session.prompt("crash");
      const err = await rec.waitFor((e) => e.type === "error" && e.fatal);
      expect(err.type).toBe("error");
    });
  });
}
