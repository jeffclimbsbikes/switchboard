import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SwitchboardError } from "../../src/core/api.js";
import { ArchiveService, claudeProjectSlug, elide } from "../../src/core/archive.js";
import type { Notification } from "../../src/core/notifier.js";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import type { AgentSession, Driver, DriverStartOptions } from "../../src/drivers/driver.js";
import { FakeDriver } from "../../src/drivers/fake.js";
import { ScriptedDriver } from "./scripted-driver.js";

const DAY = 86_400_000;
const T0 = new Date("2026-01-01T10:00:00.000Z");

class SummarizerDriver implements Driver {
  readonly kind = "fake" as const;
  readonly prompts: string[] = [];
  readonly starts: DriverStartOptions[] = [];
  fail: string | undefined;
  reply = (n: number) =>
    `<abstract>\nBuilt thing number ${n} for the household.\n</abstract>\n\n## Goal\nBuild thing ${n}.\n\n## What happened (chronological)\nUnicorn-${n} was deployed.\n`;

  async start(options: DriverStartOptions): Promise<AgentSession> {
    this.starts.push(options);
    return {
      prompt: async (text) => {
        this.prompts.push(text);
        queueMicrotask(() => {
          if (this.fail) options.onEvent({ type: "error", message: this.fail, fatal: true });
          else
            options.onEvent({
              type: "turn_end",
              stopReason: "end_turn",
              result: this.reply(this.prompts.length),
            });
        });
      },
      respond: async () => {},
      interrupt: async () => {},
      close: async () => {},
    };
  }
}

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

function setup(
  over: {
    archive?: Record<string, unknown>;
    users?: Record<string, unknown>;
    agents?: Record<string, unknown>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "sb-archive-test-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "archive");
  const clock = { now: new Date(T0) };
  const config = parseConfig({
    state_dir: root,
    agents: { fake: { driver: "fake" }, sum: { driver: "fake" }, ...over.agents },
    workspaces: { main: "/tmp/work.space_1" },
    max_wait: 200,
    users: over.users ?? {},
    archive: { dir, summarizer: { agent: "sum" }, ...over.archive },
  });
  const db = openDb(":memory:");
  const summarizer = new SummarizerDriver();
  const notes: Notification[] = [];
  const fake = new FakeDriver();
  const drivers = { fake, sum: summarizer, claude: new ScriptedDriver() };
  const manager = new SessionManager({
    config,
    db,
    drivers,
    now: () => clock.now,
    notifier: {
      async notify(n) {
        notes.push(n);
      },
    },
  });
  cleanup.push(() => manager.shutdown());
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const create = async (prompt: string, caller?: { email: string }, close = true) => {
    const view = await manager.start({ prompt }, caller);
    await manager.wait(view.session, { maxWaitMs: 1000 }, caller);
    if (close) await manager.stop(view.session, "close", caller);
    return view.session;
  };
  const count = (table: string, session: string) =>
    (db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "sessions" ? "name" : "session"} = ?`)
      .get(session)?.n ?? 0) as number;
  return { root, dir, config, db, manager, summarizer, notes, advance, create, count, clock, drivers };
}

describe("session archive", () => {
  it("only archives sessions that are not live and older than the cutoff", async () => {
    const s = setup();
    const old = await s.create("reply old work");
    await s.create("reply still here", undefined, false);
    s.advance(10 * DAY);
    const recent = await s.create("reply recent work");
    s.advance(30 * DAY);
    const archive = s.manager.archive as ArchiveService;
    const dry = await archive.run({ dryRun: true });
    expect(dry.sessions.map((x) => x.name)).toEqual([old]);
    expect(existsSync(s.dir)).toBe(false);
    expect(s.count("sessions", old)).toBe(1);
    expect(s.summarizer.prompts).toEqual([]);

    s.advance(10 * DAY);
    const dry2 = await archive.run({ dryRun: true });
    expect(dry2.sessions.map((x) => x.name).sort()).toEqual([old, recent].sort());
  });

  it("writes the summary, front matter, outline and index line, then deletes the rows", async () => {
    const s = setup();
    const name = await s.create("reply build the packing list", undefined, false);
    await s.manager.send(name, "reply now add dark mode");
    await s.manager.wait(name, { maxWaitMs: 1000 });
    await s.manager.stop(name, "close");
    s.advance(40 * DAY);

    const run = await (s.manager.archive as ArchiveService).run();
    expect(run.failed).toEqual([]);
    const file = `2026/01/2026-01-01-${name}-fake.md`;
    expect(run.sessions.map((x) => x.file)).toEqual([file]);

    const text = readFileSync(join(s.dir, file), "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    for (const key of [
      `session: "${name}"`,
      'agent: "fake"',
      'workspace: "main"',
      'cwd: "/tmp/work.space_1"',
      'state: "closed"',
      'created: "2026-01-01T10:00:00.000Z"',
      'updated: "2026-01-01T10:00:00.000Z"',
      `archived: "${s.clock.now.toISOString()}"`,
      "turns: 2",
      "cost_usd: 0",
      "agent_session_id:",
      "title:",
    ]) {
      expect(text).toContain(key);
    }
    expect(text).toContain("Built thing number 1 for the household.");
    expect(text).toContain("## Goal");
    expect(text).not.toContain("<abstract>");
    expect(text).toMatch(/## Outline[\s\S]*- 2026-01-01T10:00:00.000Z — reply build the packing list/);
    expect(text).toContain("— reply now add dark mode");

    const index = readFileSync(join(s.dir, "index.jsonl"), "utf8").trim().split("\n");
    expect(index).toHaveLength(1);
    expect(JSON.parse(index[0] as string)).toMatchObject({
      session: name,
      agent: "fake",
      file,
      abstract: "Built thing number 1 for the household.",
      turns: 2,
      state: "closed",
    });

    expect(s.count("sessions", name)).toBe(0);
    expect(s.count("events", name)).toBe(0);
    expect(s.count("usage_turns", name)).toBe(0);
    expect(readdirSync(join(s.dir, "2026", "01")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(s.summarizer.starts[0]?.cwd).toContain("switchboard-archive-");
    expect(existsSync(s.summarizer.starts[0]?.cwd as string)).toBe(false);
    const prompt = s.summarizer.prompts[0] as string;
    expect(prompt).toContain("## Notable errors");
    expect(prompt).toContain("USER: reply build the packing list");
    expect(prompt).toContain("USER: reply now add dark mode");
    expect(s.notes.filter((n) => n.session === "archive").map((n) => n.text)).toEqual(["archived 1 session"]);
  });

  it("leaves the session untouched when the summarizer or the write fails, and retries next run", async () => {
    const s = setup();
    const name = await s.create("reply flaky");
    s.advance(40 * DAY);
    const archive = s.manager.archive as ArchiveService;

    s.summarizer.fail = "boom";
    const failed = await archive.run();
    expect(failed.sessions).toEqual([]);
    expect(failed.failed[0]).toMatchObject({ name });
    expect(failed.failed[0]?.error).toContain("boom");
    expect(s.count("sessions", name)).toBe(1);
    expect(s.count("events", name)).toBeGreaterThan(0);
    expect(existsSync(s.dir)).toBe(false);
    expect(s.notes.filter((n) => n.session === "archive")).toEqual([]);

    s.summarizer.fail = undefined;
    mkdirSync(s.root, { recursive: true });
    writeFileSync(join(s.root, "blocker"), "x");
    const blocked = new ArchiveService({
      config: parseConfig({
        state_dir: s.root,
        agents: { fake: { driver: "fake" }, sum: { driver: "fake" } },
        workspaces: { main: "/tmp" },
        archive: { dir: join(s.root, "blocker"), summarizer: { agent: "sum" } },
      }),
      db: s.db,
      drivers: s.drivers,
      now: () => s.clock.now,
      log: () => {},
    });
    const blockedRun = await blocked.run();
    expect(blockedRun.failed).toHaveLength(1);
    expect(s.count("sessions", name)).toBe(1);

    const ok = await archive.run();
    expect(ok.sessions.map((x) => x.name)).toEqual([name]);
    expect(s.count("sessions", name)).toBe(0);
  });

  it("does not archive twice when only the row deletion was missed", async () => {
    const s = setup();
    const name = await s.create("reply once");
    s.advance(40 * DAY);
    const archive = s.manager.archive as ArchiveService;
    const row = s.db.prepare("SELECT * FROM sessions WHERE name = ?").get(name) as Record<string, never>;
    await archive.run();
    const keys = Object.keys(row);
    s.db
      .prepare(`INSERT INTO sessions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...Object.values(row));
    const again = await archive.run();
    expect(again.sessions.map((x) => x.name)).toEqual([name]);
    expect(s.count("sessions", name)).toBe(0);
    expect(s.summarizer.prompts).toHaveLength(1);
    expect(readFileSync(join(s.dir, "index.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("honours max_per_run, oldest first", async () => {
    const s = setup({ archive: { max_per_run: 2 } });
    const a = await s.create("reply a");
    s.advance(DAY);
    const b = await s.create("reply b");
    s.advance(DAY);
    const c = await s.create("reply c");
    s.advance(60 * DAY);
    const run = await (s.manager.archive as ArchiveService).run();
    expect(run.sessions.map((x) => x.name)).toEqual([a, b]);
    expect(s.count("sessions", c)).toBe(1);
    expect(s.notes.filter((n) => n.session === "archive").map((n) => n.text)).toEqual([
      "archived 2 sessions",
    ]);
  });

  it("reads the Claude Code transcript and deletes it only when asked", async () => {
    for (const del of [false, true]) {
      const s = setup({
        agents: { claude: { driver: "claude", run_as: "bob" } },
        archive: { delete_agent_transcripts: del },
      });
      const view = await s.manager.start({ prompt: "reply native", agent: "claude" });
      await s.manager.wait(view.session, { maxWaitMs: 1000 });
      await s.manager.stop(view.session, "close");
      const id = s.db.prepare("SELECT agent_session_id AS id FROM sessions").get()?.id as string;
      const home = join(s.root, "home-bob");
      const projectDir = join(home, ".claude", "projects", "-tmp-work-space-1");
      mkdirSync(projectDir, { recursive: true });
      const transcript = join(projectDir, `${id}.jsonl`);
      writeFileSync(
        transcript,
        [
          {
            type: "user",
            timestamp: "2026-01-01T10:00:00Z",
            message: { role: "user", content: "NATIVE-USER-MARKER" },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "secret" },
                { type: "text", text: "NATIVE-ASSISTANT-MARKER" },
                { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
              ],
            },
          },
          { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "total 0" }] } },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n"),
      );
      s.advance(40 * DAY);
      const asked: (string | undefined)[] = [];
      const archive = new ArchiveService({
        config: s.config,
        db: s.db,
        drivers: s.drivers,
        now: () => s.clock.now,
        home: (user) => {
          asked.push(user);
          return home;
        },
      });
      const run = await archive.run();
      expect(run.failed).toEqual([]);
      const prompt = s.summarizer.prompts[0] as string;
      expect(prompt).toContain("NATIVE-USER-MARKER");
      expect(prompt).toContain("NATIVE-ASSISTANT-MARKER");
      expect(prompt).toContain("TOOL: Bash: ls -la");
      expect(prompt).toContain("RESULT: total 0");
      expect(prompt).not.toContain("secret");
      expect(asked[0]).toBe("bob");
      expect(existsSync(transcript)).toBe(!del);
    }
  });

  it("archives fine when the Claude transcript is unreadable", async () => {
    const s = setup({ agents: { claude: { driver: "claude" } } });
    const view = await s.manager.start({ prompt: "reply nothing native", agent: "claude" });
    await s.manager.wait(view.session, { maxWaitMs: 1000 });
    await s.manager.stop(view.session, "close");
    s.advance(40 * DAY);
    const run = await new ArchiveService({
      config: s.config,
      db: s.db,
      drivers: s.drivers,
      now: () => s.clock.now,
      home: () => join(s.root, "nowhere"),
    }).run();
    expect(run.sessions).toHaveLength(1);
    expect(s.summarizer.prompts[0]).not.toContain("OWN TRANSCRIPT");
  });

  it("keeps long transcripts under budget with an elision marker", () => {
    const text = `${"a".repeat(1000)}${"b".repeat(1000)}`;
    const out = elide(text, 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain("[... 1900 characters elided ...]");
    expect(out.startsWith("aaaa")).toBe(true);
    expect(out.endsWith("bbbb")).toBe(true);
    expect(elide("short", 100)).toBe("short");
  });

  it("slugs the cwd the way Claude Code does", () => {
    expect(claudeProjectSlug("/Users/jeff/dev/my.app_2")).toBe("-Users-jeff-dev-my-app-2");
  });

  it("validates the summarizer against the agents and catalog", () => {
    const base = { agents: { a: { driver: "fake", models: [{ id: "m1" }] } }, workspaces: { w: "/tmp" } };
    expect(() => parseConfig({ ...base, archive: { summarizer: { agent: "nope" } } })).toThrow(
      /unknown agent "nope"/,
    );
    expect(() => parseConfig({ ...base, archive: { summarizer: { agent: "a", model: "m2" } } })).toThrow(
      /no model "m2"/,
    );
    expect(() => parseConfig({ ...base, archive: {} })).toThrow(/summarizer/);
    const ok = parseConfig({ ...base, archive: { summarizer: { agent: "a", model: "m1" } } });
    expect(ok.archive).toMatchObject({
      after: 35 * DAY,
      max_per_run: 20,
      delete_agent_transcripts: false,
      agent_hint: true,
    });
    expect(parseConfig(base).archive).toBeUndefined();
  });
});

describe("agent hint", () => {
  it("is appended to Claude's system prompt and prepended to the first ACP prompt", async () => {
    const root = mkdtempSync(join(tmpdir(), "sb-hint-test-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const config = parseConfig({
      state_dir: root,
      agents: {
        claude: { driver: "claude", append_system_prompt: "Be brief." },
        acp: { driver: "acp", command: ["x"] },
        sum: { driver: "fake" },
      },
      workspaces: { main: "/tmp" },
      archive: { summarizer: { agent: "sum" } },
    });
    const claude = new ScriptedDriver();
    const prompts: string[] = [];
    const acp = new ScriptedDriver();
    const origStart = acp.start.bind(acp);
    acp.start = async (o) => {
      const s = await origStart(o);
      const prompt = s.prompt.bind(s);
      s.prompt = async (text) => {
        prompts.push(text);
        return prompt(text);
      };
      return s;
    };
    const manager = new SessionManager({
      config,
      db: openDb(":memory:"),
      drivers: { claude, acp, sum: new FakeDriver() },
    });
    cleanup.push(() => manager.shutdown());

    const c = await manager.start({ prompt: "hello claude", agent: "claude" });
    const hint = `Past sessions are summarized in ${join(root, "archive")} (markdown files plus index.jsonl, newest last). Grep them when earlier work matters.`;
    expect(claude.starts[0]?.appendSystemPrompt).toBe(`Be brief.\n\n${hint}`);
    const a = await manager.start({ prompt: "hello acp", agent: "acp" });
    expect(acp.starts[0]?.appendSystemPrompt).toBeUndefined();
    expect(prompts).toEqual([`${hint}\n\nhello acp`]);
    const detail = manager.detail(a.session);
    expect(detail.events.find((e) => (e.event as { type: string }).type === "prompt")?.event).toEqual({
      type: "prompt",
      text: "hello acp",
    });
    expect(c.session).not.toBe(a.session);
  });

  it("is absent without [archive] or with agent_hint = false", async () => {
    for (const archive of [undefined, { summarizer: { agent: "sum" }, agent_hint: false }]) {
      const claude = new ScriptedDriver();
      const manager = new SessionManager({
        config: parseConfig({
          agents: {
            claude: { driver: "claude", append_system_prompt: "Be brief." },
            sum: { driver: "fake" },
          },
          workspaces: { main: "/tmp" },
          ...(archive && { archive }),
        }),
        db: openDb(":memory:"),
        drivers: { claude, sum: new FakeDriver() },
      });
      cleanup.push(() => manager.shutdown());
      await manager.start({ prompt: "hi", agent: "claude" });
      expect(claude.starts[0]?.appendSystemPrompt).toBe("Be brief.");
    }
  });
});

describe("history", () => {
  async function seeded() {
    const s = setup({ users: { "alice@x.com": {}, "bob@x.com": {} } });
    const alice = { email: "alice@x.com" };
    const bob = { email: "bob@x.com" };
    const first = await s.create("reply packing list app", alice);
    s.advance(DAY);
    const second = await s.create("reply garden sprinkler schedule", bob);
    s.advance(DAY);
    const third = await s.create("reply packing the garage");
    s.advance(60 * DAY);
    const live = await s.create("reply packing live thing", undefined, false);
    await s.manager.archive?.run();
    return { s, alice, bob, first, second, third, live };
  }

  it("searches archived summaries and live sessions, newest first, all words must match", async () => {
    const { s, first, third, live } = await seeded();
    const history = s.manager.history as NonNullable<SessionManager["history"]>;
    expect(s.count("sessions", first)).toBe(0);

    const byAbstract = await history({ query: "HOUSEHOLD" });
    expect(byAbstract.entries.map((e) => e.state)).toEqual(["archived", "archived", "archived"]);

    const fullText = await history({ query: "unicorn-2" });
    expect(fullText.entries.map((e) => e.session)).toHaveLength(1);

    const both = await history({ query: "packing" });
    expect(both.entries.map((e) => e.session)).toEqual([live, third, first]);
    expect(both.entries[0]).toMatchObject({ state: "live", sessionState: "idle", agent: "fake" });
    expect(both.entries[1]).toMatchObject({
      state: "archived",
      agent: "fake",
      title: "reply packing the garage",
    });
    expect(both.entries[1]?.path).toBe(join(s.dir, `2026/01/2026-01-03-${third}-fake.md`));

    expect((await history({ query: "packing garage" })).entries.map((e) => e.session)).toEqual([third]);
    expect((await history({ query: "packing sprinkler" })).entries).toEqual([]);
    expect((await history({ query: "packing", limit: 2 })).entries).toHaveLength(2);
    expect((await history({})).entries.length).toBe(4);
  });

  it("returns a whole summary by session name or id, or the live session's line", async () => {
    const { s, first, live } = await seeded();
    const history = s.manager.history as NonNullable<SessionManager["history"]>;
    const archived = await history({ session: first });
    expect(archived.summary).toContain("## Goal");
    expect(archived.summary).toContain(`session: "${first}"`);
    expect(archived.entries[0]?.id).toBe(`2026-01-01-${first}-fake`);
    expect((await history({ session: archived.entries[0]?.id })).summary).toBe(archived.summary);
    const liveResult = await history({ session: live });
    expect(liveResult.summary).toContain("still a live session");
    await expect(history({ session: "ghost" })).rejects.toBeInstanceOf(SwitchboardError);
  });

  it("shows restricted users only their own sessions and archives, and hides paths", async () => {
    const { s, alice, bob, first, second } = await seeded();
    const history = s.manager.history as NonNullable<SessionManager["history"]>;
    const mine = await history({ query: "household" }, alice);
    expect(mine.entries.map((e) => e.session)).toEqual([first]);
    expect(mine.entries[0]?.path).toBeUndefined();
    expect((await history({ query: "household" }, bob)).entries.map((e) => e.session)).toEqual([second]);
    await expect(history({ session: second }, alice)).rejects.toMatchObject({ code: "not_found" });
    expect((await history({ session: first }, alice)).summary).toContain("## Goal");
    const snapshot = s.manager.snapshot(alice);
    expect(snapshot.archive?.count).toBe(1);
    expect(s.manager.snapshot().archive?.count).toBe(3);
  });

  it("is only offered when [archive] is configured", () => {
    const manager = new SessionManager({
      config: parseConfig({ agents: { fake: { driver: "fake" } }, workspaces: { w: "/tmp" } }),
      db: openDb(":memory:"),
      drivers: { fake: new FakeDriver() },
    });
    cleanup.push(() => manager.shutdown());
    expect(manager.history).toBeUndefined();
    expect(manager.archive).toBeUndefined();
    expect(manager.snapshot().archive).toBeUndefined();
  });
});
