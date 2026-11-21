import { readFile } from "node:fs/promises";
import { archiveDir, type Config } from "../config.js";
import type { Db } from "../db.js";
import type { DashboardArchive, HistoryEntry, HistoryQuery, HistoryResult, SessionState } from "../types.js";
import { SwitchboardError } from "./api.js";
import { type ArchiveEntry, entryId, readIndex, summaryPath } from "./archive-index.js";
import { type Access, canSee } from "./policy.js";
import { type SessionRow, SessionStore } from "./store.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
export const DASHBOARD_ARCHIVE_SHOWN = 20;

const byNewest = (a: HistoryEntry, b: HistoryEntry) =>
  a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0;

function words(query: string | undefined): string[] {
  return (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

const matches = (text: string, terms: string[]) => {
  const t = text.toLowerCase();
  return terms.every((w) => t.includes(w));
};

export class HistoryService {
  private readonly store: SessionStore;

  constructor(
    private readonly config: Config,
    db: Db,
  ) {
    this.store = new SessionStore(db);
  }

  private dir(): string | undefined {
    return this.config.archive ? archiveDir(this.config) : undefined;
  }

  private archived(access: Access): ArchiveEntry[] {
    const dir = this.dir();
    return dir ? readIndex(dir).filter((e) => canSee(access, e.owner)) : [];
  }

  private liveEntry(row: SessionRow): HistoryEntry {
    return {
      id: row.name,
      session: row.name,
      agent: row.agent,
      title: row.title,
      created: row.createdAt,
      updated: row.updatedAt,
      state: "live",
      sessionState: row.state as SessionState,
      ...(row.lastActivity && { abstract: row.lastActivity }),
    };
  }

  private archivedEntry(e: ArchiveEntry, access: Access): HistoryEntry {
    const dir = this.dir() as string;
    const path = access.restricted ? undefined : summaryPath(dir, e);
    return {
      id: entryId(e),
      session: e.session,
      agent: e.agent,
      title: e.title,
      created: e.created,
      updated: e.updated,
      state: "archived",
      ...(e.abstract && { abstract: e.abstract }),
      ...(path && { path }),
    };
  }

  async find(input: HistoryQuery, access: Access): Promise<HistoryResult> {
    if (input.session) return this.lookup(input.session, access);
    const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
    const terms = words(input.query);
    const entries: HistoryEntry[] = [];
    for (const row of this.store.list().filter((r) => canSee(access, r.owner))) {
      const hay = `${row.name} ${row.agent} ${row.title} ${row.lastActivity ?? ""}`;
      if (matches(hay, terms)) entries.push(this.liveEntry(row));
    }
    const dir = this.dir();
    const archived = this.archived(access).sort((a, b) => (a.updated < b.updated ? 1 : -1));
    for (const e of archived) {
      if (terms.length === 0 || matches(`${e.session} ${e.agent} ${e.title} ${e.abstract}`, terms)) {
        entries.push(this.archivedEntry(e, access));
        continue;
      }
      const path = dir && summaryPath(dir, e);
      const text = path ? await readFile(path, "utf8").catch(() => undefined) : undefined;
      if (text && matches(text, terms)) entries.push(this.archivedEntry(e, access));
    }
    return { entries: entries.sort(byNewest).slice(0, limit) };
  }

  private async lookup(session: string, access: Access): Promise<HistoryResult> {
    const row = this.store.get(session);
    if (row && canSee(access, row.owner)) {
      const entry = this.liveEntry(row);
      const summary = [
        `${row.name} is still a live session (${row.state}): ${row.title}`,
        row.lastActivity ? `Latest activity: ${row.lastActivity}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      return { entries: [entry], summary };
    }
    const dir = this.dir();
    const found = this.archived(access)
      .filter((e) => e.session === session || entryId(e) === session)
      .sort((a, b) => (a.archived < b.archived ? 1 : -1))[0];
    const path = dir && found && summaryPath(dir, found);
    const text = path ? await readFile(path, "utf8").catch(() => undefined) : undefined;
    if (!found || text === undefined) {
      throw new SwitchboardError(`There is no past session called ${session}.`, "not_found");
    }
    return { entries: [this.archivedEntry(found, access)], summary: text };
  }

  archiveSummary(access: Access): DashboardArchive | undefined {
    if (!this.config.archive) return undefined;
    const all = this.archived(access);
    const recent = all
      .map((e) => this.archivedEntry(e, access))
      .sort(byNewest)
      .slice(0, DASHBOARD_ARCHIVE_SHOWN);
    return { count: all.length, recent };
  }
}
