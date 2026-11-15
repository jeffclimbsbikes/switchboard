import type { Db } from "../db.js";
import type { DriverEvent } from "../drivers/driver.js";
import type { PendingRequest, SessionState } from "../types.js";

export type StoredEventData = DriverEvent | { type: "prompt"; text: string } | { type: "note"; text: string };

export interface SessionRow {
  name: string;
  agent: string;
  workspace: string;
  cwd: string;
  model?: string;
  title: string;
  owner?: string;
  state: SessionState;
  agentSessionId?: string;
  pending?: PendingRequest;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
}

export interface SessionPatch {
  title?: string;
  state?: SessionState;
  agentSessionId?: string;
  pending?: PendingRequest | null;
  updatedAt?: string;
  lastActivity?: string;
}

export interface StoredEvent {
  session: string;
  seq: number;
  at: string;
  data: StoredEventData;
}

type Raw = Record<string, unknown>;

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      name TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      workspace TEXT NOT NULL,
      cwd TEXT NOT NULL,
      model TEXT,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      agent_session_id TEXT,
      pending TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity TEXT,
      owner TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      session TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (session, seq)
    );
  `);
  const columns = db.prepare("PRAGMA table_info(sessions)").all();
  if (!columns.some((c) => c.name === "owner")) db.exec("ALTER TABLE sessions ADD COLUMN owner TEXT");
}

function toRow(r: Raw): SessionRow {
  return {
    name: r.name as string,
    agent: r.agent as string,
    workspace: r.workspace as string,
    cwd: r.cwd as string,
    ...(r.model != null && { model: r.model as string }),
    title: r.title as string,
    ...(r.owner != null && { owner: r.owner as string }),
    state: r.state as SessionState,
    ...(r.agent_session_id != null && { agentSessionId: r.agent_session_id as string }),
    ...(r.pending != null && { pending: JSON.parse(r.pending as string) as PendingRequest }),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    ...(r.last_activity != null && { lastActivity: r.last_activity as string }),
  };
}

const COLUMNS = {
  title: "title",
  state: "state",
  agentSessionId: "agent_session_id",
  pending: "pending",
  updatedAt: "updated_at",
  lastActivity: "last_activity",
} as const;

function toEvent(session: string, r: Raw): StoredEvent {
  return {
    session,
    seq: r.seq as number,
    at: r.at as string,
    data: JSON.parse(r.data as string) as StoredEventData,
  };
}

export class SessionStore {
  constructor(private readonly db: Db) {
    migrate(db);
  }

  create(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (name, agent, workspace, cwd, model, title, state, agent_session_id, pending, created_at, updated_at, last_activity, owner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.name,
        row.agent,
        row.workspace,
        row.cwd,
        row.model ?? null,
        row.title,
        row.state,
        row.agentSessionId ?? null,
        row.pending ? JSON.stringify(row.pending) : null,
        row.createdAt,
        row.updatedAt,
        row.lastActivity ?? null,
        row.owner ?? null,
      );
  }

  get(name: string): SessionRow | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE name = ?").get(name);
    return r ? toRow(r) : undefined;
  }

  list(state?: SessionState): SessionRow[] {
    const rows = state
      ? this.db.prepare("SELECT * FROM sessions WHERE state = ? ORDER BY created_at, name").all(state)
      : this.db.prepare("SELECT * FROM sessions ORDER BY created_at, name").all();
    return rows.map(toRow);
  }

  names(): string[] {
    return this.db
      .prepare("SELECT name FROM sessions")
      .all()
      .map((r) => r.name as string);
  }

  update(name: string, patch: SessionPatch): SessionRow {
    const sets: string[] = [];
    const values: (string | null)[] = [];
    for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      sets.push(`${COLUMNS[key]} = ?`);
      values.push(key === "pending" ? (value ? JSON.stringify(value) : null) : (value as string));
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE name = ?`).run(...values, name);
    }
    const row = this.get(name);
    if (!row) throw new Error(`no such session: ${name}`);
    return row;
  }

  appendEvent(session: string, at: string, data: StoredEventData): number {
    const seq = this.lastSeq(session) + 1;
    this.db
      .prepare("INSERT INTO events (session, seq, at, kind, data) VALUES (?, ?, ?, ?, ?)")
      .run(session, seq, at, data.type, JSON.stringify(data));
    return seq;
  }

  lastSeq(session: string): number {
    const r = this.db.prepare("SELECT MAX(seq) AS seq FROM events WHERE session = ?").get(session);
    return (r?.seq as number | null) ?? 0;
  }

  lastSeqOfKind(session: string, kind: StoredEventData["type"]): number | undefined {
    const r = this.db
      .prepare("SELECT MAX(seq) AS seq FROM events WHERE session = ? AND kind = ?")
      .get(session, kind);
    return (r?.seq as number | null) ?? undefined;
  }

  eventsAfter(session: string, seq: number): StoredEvent[] {
    return this.db
      .prepare("SELECT seq, at, data FROM events WHERE session = ? AND seq > ? ORDER BY seq")
      .all(session, seq)
      .map((r) => toEvent(session, r));
  }

  eventsPage(session: string, since: number, limit: number): StoredEvent[] {
    return this.db
      .prepare("SELECT seq, at, data FROM events WHERE session = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(session, since, limit)
      .map((r) => toEvent(session, r));
  }

  lastEvents(session: string, limit: number): StoredEvent[] {
    return this.db
      .prepare("SELECT seq, at, data FROM events WHERE session = ? ORDER BY seq DESC LIMIT ?")
      .all(session, limit)
      .map((r) => toEvent(session, r))
      .reverse();
  }
}
