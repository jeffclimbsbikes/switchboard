import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { archiveDir, type Config } from "../config.js";
import type { Db } from "../db.js";
import { summarizeTool } from "../drivers/claude.js";
import type { AgentSession, Driver } from "../drivers/driver.js";
import { describeRequest } from "./activity.js";
import { appendIndex, readIndex } from "./archive-index.js";
import { type Notifier, nullNotifier } from "./notifier.js";
import { type SessionRow, SessionStore, type StoredEvent } from "./store.js";

export interface ArchiveDeps {
  config: Config;
  db: Db;
  drivers: Record<string, Driver>;
  notifier?: Notifier;
  now?: () => Date;
  /** Sessions with a running process are never archived. Defaults to none. */
  isLive?: (name: string) => boolean;
  log?: (message: string) => void;
  /** Home directory of the account an agent runs as; the current user when `user` is undefined. */
  home?: (user?: string) => string;
}

export interface ArchiveRun {
  /** Sessions that were (or, in a dry run, would be) archived. */
  sessions: { name: string; agent: string; updatedAt: string; title: string; file?: string }[];
  failed: { name: string; error: string }[];
}

const FIRST_RUN_MS = 10 * 60_000;
const INTERVAL_MS = 24 * 3_600_000;
const SUMMARIZER_TIMEOUT_MS = 10 * 60_000;
const EVENTS_BUDGET = 50_000;
const NATIVE_BUDGET = 100_000;
const ITEM_CHARS = 6_000;
const RESULT_CHARS = 300;
const OUTLINE_PROMPT_CHARS = 200;
const OUTLINE_MAX = 100;
const ARCHIVABLE = new Set(["idle", "parked", "failed", "closed"]);

const INSTRUCTIONS = `You are archiving a finished coding-agent session. Read the transcript below and write a detailed, factual summary in markdown. Use only what the transcript shows: do not invent anything, and say so when something is unknown. Do not use any tools.

Start with an abstract of 2-3 sentences, wrapped exactly like this:
<abstract>
...
</abstract>

Then write these sections in order as level-2 headings ("None." when a section has nothing):
## Goal
## What happened (chronological)
## Changes (repos/files/commands/deploys)
## Decisions and why
## Outcome (URLs, results)
## Open issues / follow-ups
## Notable errors`;

/** Claude Code names a project folder after its cwd with every non-alphanumeric character as "-". */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function defaultHome(user?: string): string {
  if (!user) return homedir();
  try {
    for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
      const f = line.split(":");
      if (f[0] === user && f[5]) return f[5];
    }
  } catch {}
  return join(dirname(homedir()), user);
}

export function elide(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.4);
  const tail = budget - head;
  return `${text.slice(0, head)}\n\n[... ${text.length - budget} characters elided ...]\n\n${text.slice(-tail)}`;
}

const clip = (text: string) => elide(text.trim(), ITEM_CHARS);

export function renderEvents(events: StoredEvent[]): string {
  const items: string[] = [];
  const tools = new Map<string, { index: number; at: string }>();
  for (const { at, data: e } of events) {
    switch (e.type) {
      case "prompt":
        items.push(`[${at}] USER: ${clip(e.text)}`);
        break;
      case "text":
        if (e.text.trim()) items.push(`[${at}] ASSISTANT: ${clip(e.text)}`);
        break;
      case "tool": {
        const known = tools.get(e.id);
        if (known) {
          items[known.index] = `[${known.at}] TOOL (${e.status}): ${e.title}`;
        } else {
          tools.set(e.id, { index: items.length, at });
          items.push(`[${at}] TOOL (${e.status}): ${e.title}`);
        }
        break;
      }
      case "request":
        items.push(`[${at}] REQUEST: ${describeRequest(e.request)}`);
        break;
      case "answer":
        items.push(`[${at}] ANSWER: ${clip(e.text)}`);
        break;
      case "note":
        items.push(`[${at}] NOTE: ${e.text}`);
        break;
      case "turn_end":
        items.push(
          `[${at}] TURN END (${e.stopReason}${e.costUsd !== undefined ? `, $${e.costUsd}` : ""})${e.result ? `: ${clip(e.result)}` : ""}`,
        );
        break;
      case "error":
        items.push(`[${at}] ERROR${e.fatal ? " (fatal)" : ""}: ${clip(e.message)}`);
        break;
      default:
        break;
    }
  }
  return items.join("\n\n");
}

type Json = Record<string, unknown>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Json[])
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function renderClaudeTranscript(jsonl: string): string {
  const items: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Json;
    try {
      entry = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if ((entry.type !== "user" && entry.type !== "assistant") || entry.isMeta) continue;
    const who = entry.type === "user" ? "USER" : "ASSISTANT";
    const at = typeof entry.timestamp === "string" ? `[${entry.timestamp}] ` : "";
    const content = (entry.message as Json | undefined)?.content;
    if (typeof content === "string") {
      if (content.trim()) items.push(`${at}${who}: ${clip(content)}`);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content as Json[]) {
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text.trim()) items.push(`${at}${who}: ${clip(block.text)}`);
      } else if (block.type === "tool_use") {
        items.push(`${at}TOOL: ${summarizeTool(String(block.name ?? "tool"), block.input)}`);
      } else if (block.type === "tool_result") {
        const text = textOf(block.content).replace(/\s+/g, " ").trim();
        if (text)
          items.push(
            `${at}RESULT: ${text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS - 1)}…` : text}`,
          );
      }
    }
  }
  return items.join("\n\n");
}

function frontMatter(fields: Record<string, string | number | undefined>): string {
  const lines = Object.entries(fields)
    .filter((kv): kv is [string, string | number] => kv[1] !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export function parseSummary(text: string): { abstract: string; body: string } {
  const m = /<abstract>([\s\S]*?)<\/abstract>/i.exec(text);
  if (m) return { abstract: (m[1] ?? "").replace(/\s+/g, " ").trim(), body: text.replace(m[0], "").trim() };
  const body = text.trim();
  const first = body.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith("#")) ?? "";
  return { abstract: first.replace(/\s+/g, " ").trim().slice(0, 400), body };
}

function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o755 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o644 });
    chmodSync(tmp, 0o644);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ArchiveService {
  private readonly archive: NonNullable<Config["archive"]>;
  private readonly store: SessionStore;
  private readonly notifier: Notifier;
  private readonly now: () => Date;
  private readonly isLive: (name: string) => boolean;
  private readonly log: (message: string) => void;
  private readonly home: (user?: string) => string;
  private timer?: NodeJS.Timeout;
  private running?: Promise<ArchiveRun>;

  constructor(private readonly deps: ArchiveDeps) {
    if (!deps.config.archive) throw new Error("archive is not configured");
    this.archive = deps.config.archive;
    this.store = new SessionStore(deps.db);
    this.notifier = deps.notifier ?? nullNotifier;
    this.now = deps.now ?? (() => new Date());
    this.isLive = deps.isLive ?? (() => false);
    this.log = deps.log ?? ((m) => console.error(`[switchboard] ${m}`));
    this.home = deps.home ?? defaultHome;
  }

  get dir(): string {
    return archiveDir(this.deps.config);
  }

  start(): void {
    if (this.timer) return;
    const schedule = (ms: number) => {
      this.timer = setTimeout(() => {
        this.run()
          .catch((err) => this.log(`archive run failed: ${messageOf(err)}`))
          .finally(() => schedule(INTERVAL_MS));
      }, ms);
      this.timer.unref?.();
    };
    schedule(FIRST_RUN_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  eligible(): SessionRow[] {
    const cutoff = this.now().getTime() - this.archive.after;
    return this.store
      .list()
      .filter((r) => ARCHIVABLE.has(r.state) && !this.isLive(r.name) && Date.parse(r.updatedAt) < cutoff)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
      .slice(0, this.archive.max_per_run);
  }

  run(opts: { dryRun?: boolean } = {}): Promise<ArchiveRun> {
    if (opts.dryRun) {
      const sessions = this.eligible().map((r) => ({
        name: r.name,
        agent: r.agent,
        updatedAt: r.updatedAt,
        title: r.title,
      }));
      return Promise.resolve({ sessions, failed: [] });
    }
    this.running ??= this.execute().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async execute(): Promise<ArchiveRun> {
    const result: ArchiveRun = { sessions: [], failed: [] };
    for (const row of this.eligible()) {
      try {
        const file = await this.archiveOne(row);
        result.sessions.push({
          name: row.name,
          agent: row.agent,
          updatedAt: row.updatedAt,
          title: row.title,
          file,
        });
      } catch (err) {
        this.log(`archive: ${row.name} left in place: ${messageOf(err)}`);
        result.failed.push({ name: row.name, error: messageOf(err) });
      }
    }
    const n = result.sessions.length;
    if (n > 0) {
      await this.notifier
        .notify({ session: "archive", kind: "done", text: `archived ${n} session${n === 1 ? "" : "s"}` })
        .catch((err) => this.log(`archive: notifier failed: ${messageOf(err)}`));
    }
    return result;
  }

  private nativeTranscriptPath(row: SessionRow): string | undefined {
    const agent = this.deps.config.agents[row.agent];
    if (agent?.driver !== "claude" || !row.agentSessionId || !/^[\w.-]+$/.test(row.agentSessionId)) {
      return undefined;
    }
    return join(
      this.home(agent.run_as),
      ".claude",
      "projects",
      claudeProjectSlug(row.cwd),
      `${row.agentSessionId}.jsonl`,
    );
  }

  private readNative(row: SessionRow): string | undefined {
    const path = this.nativeTranscriptPath(row);
    if (!path) return undefined;
    try {
      return renderClaudeTranscript(readFileSync(path, "utf8")) || undefined;
    } catch {
      return undefined;
    }
  }

  private async archiveOne(row: SessionRow): Promise<string> {
    const dir = this.dir;
    const prior = readIndex(dir).find((e) => e.session === row.name && e.created === row.createdAt);
    if (prior) {
      this.finish(row);
      return prior.file;
    }

    const events = this.store.eventsAfter(row.name, 0);
    const native = this.readNative(row);
    const usage = row.usage;
    const raw = await this.summarize(
      [
        INSTRUCTIONS,
        "=== SESSION ===",
        [
          `name: ${row.name}`,
          `agent: ${row.agent}`,
          `workspace: ${row.workspace} (${row.cwd})`,
          `model: ${row.model ?? "default"}`,
          `title: ${row.title}`,
          `final state: ${row.state}`,
          `created: ${row.createdAt}`,
          `last updated: ${row.updatedAt}`,
          `turns: ${usage?.turns ?? 0}, cost: $${usage?.costUsd ?? 0}`,
        ].join("\n"),
        "=== SWITCHBOARD EVENT LOG ===",
        elide(renderEvents(events), EVENTS_BUDGET) || "(no events)",
        ...(native ? ["=== THE AGENT'S OWN TRANSCRIPT ===", elide(native, NATIVE_BUDGET)] : []),
      ].join("\n\n"),
    );
    const { abstract, body } = parseSummary(raw);
    if (!body) throw new Error("the summarizer returned nothing");

    const outline = events
      .filter((e) => e.data.type === "prompt")
      .slice(0, OUTLINE_MAX)
      .map((e) => {
        const text = (e.data as { text: string }).text.replace(/\s+/g, " ").trim();
        const short =
          text.length > OUTLINE_PROMPT_CHARS ? `${text.slice(0, OUTLINE_PROMPT_CHARS - 1)}…` : text;
        return `- ${e.at} — ${short}`;
      });
    const meta = {
      session: row.name,
      agent: row.agent,
      workspace: row.workspace,
      cwd: row.cwd,
      ...(row.owner && { owner: row.owner }),
      ...(row.model && { model: row.model }),
      title: row.title,
      state: row.state,
      created: row.createdAt,
      updated: row.updatedAt,
      archived: this.now().toISOString(),
      turns: usage?.turns ?? 0,
      cost_usd: usage?.costUsd ?? 0,
      ...(row.agentSessionId && { agent_session_id: row.agentSessionId }),
    };
    const file = this.freeFile(
      `${row.createdAt.slice(0, 4)}/${row.createdAt.slice(5, 7)}`,
      `${row.createdAt.slice(0, 10)}-${row.name}-${row.agent}`,
    );
    const path = join(dir, file);
    atomicWrite(
      path,
      `${frontMatter(meta)}\n# ${row.title}\n\n${abstract ? `${abstract}\n\n` : ""}${body}\n\n## Outline\n\n${outline.join("\n") || "None."}\n`,
    );
    try {
      appendIndex(dir, { ...meta, file, abstract });
    } catch (err) {
      rmSync(path, { force: true });
      throw err;
    }
    this.finish(row);
    return file;
  }

  private freeFile(folder: string, base: string): string {
    let file = `${folder}/${base}.md`;
    for (let n = 2; existsSync(join(this.dir, file)); n++) file = `${folder}/${base}-${n}.md`;
    return file;
  }

  private finish(row: SessionRow): void {
    this.store.remove(row.name);
    if (!this.archive.delete_agent_transcripts) return;
    const path = this.nativeTranscriptPath(row);
    if (!path) return;
    try {
      unlinkSync(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(`archive: could not delete ${path}: ${messageOf(err)}`);
      }
    }
  }

  private async summarize(prompt: string): Promise<string> {
    const { agent, model } = this.archive.summarizer;
    const driver = this.deps.drivers[agent];
    if (!driver) throw new Error(`summarizer agent ${agent} is not available`);
    const cwd = mkdtempSync(join(tmpdir(), "switchboard-archive-"));
    chmodSync(cwd, 0o755);
    let session: AgentSession | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        const texts: string[] = [];
        timer = setTimeout(() => reject(new Error("the summarizer timed out")), SUMMARIZER_TIMEOUT_MS);
        timer.unref?.();
        driver
          .start({
            cwd,
            ...(model && { model }),
            onEvent: (e) => {
              if (e.type === "text") texts.push(e.text);
              else if (e.type === "request") reject(new Error("the summarizer asked for input"));
              else if (e.type === "error" && e.fatal)
                reject(new Error(`the summarizer failed: ${e.message}`));
              else if (e.type === "turn_end") {
                if (e.stopReason === "end_turn" || e.stopReason === "max_tokens") {
                  resolve(e.result ?? texts.join("\n\n"));
                } else reject(new Error(`the summarizer stopped: ${e.stopReason}`));
              }
            },
          })
          .then((s) => {
            session = s;
            return s.prompt(prompt);
          })
          .catch(reject);
      });
    } finally {
      clearTimeout(timer);
      await session?.close().catch(() => {});
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}
