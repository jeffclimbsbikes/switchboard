import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../../db.js";

export const ACCESS_TTL_MS = 3_600_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;
export const CODE_TTL_MS = 60_000;
export const PENDING_TTL_MS = 600_000;
export const UNUSED_CLIENT_TTL_MS = 86_400_000;
export const MAX_CLIENTS = 1_000;

export interface ClientRecord {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export interface PendingAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  challenge: string;
  resource: string;
  scope: string;
  email: string;
  csrf: string;
  expiresAt: number;
}

export interface CodeGrant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  scope: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface TokenInfo {
  email: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

export interface Grant {
  family: string;
  clientId: string;
  clientName: string | null;
  email: string;
  createdAt: Date;
  expiresAt: Date;
}

type Row = Record<string, string | number | null>;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_pending (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, state TEXT, challenge TEXT NOT NULL,
      resource TEXT NOT NULL, scope TEXT NOT NULL, email TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
      resource TEXT NOT NULL, scope TEXT NOT NULL, email TEXT NOT NULL, family TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      hash TEXT PRIMARY KEY, kind TEXT NOT NULL, family TEXT NOT NULL, client_id TEXT NOT NULL, email TEXT NOT NULL,
      resource TEXT NOT NULL, scope TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens (family);
  `);
}

export function sweep(db: Db, nowMs: number): void {
  db.prepare("DELETE FROM oauth_pending WHERE expires_at < ?").run(nowMs);
  db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(nowMs);
  db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(nowMs);
}

export function pruneUnusedClients(db: Db, nowMs: number): void {
  db.prepare(
    `DELETE FROM oauth_clients WHERE created_at < ?
       AND client_id NOT IN (SELECT client_id FROM oauth_tokens)
       AND client_id NOT IN (SELECT client_id FROM oauth_pending)
       AND client_id NOT IN (SELECT client_id FROM oauth_codes)`,
  ).run(nowMs - UNUSED_CLIENT_TTL_MS);
}

export function countClients(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number }).n;
}

export function saveClient(db: Db, c: ClientRecord, nowMs: number): void {
  db.prepare("INSERT OR REPLACE INTO oauth_clients VALUES (?, ?, ?, ?)").run(
    c.clientId,
    c.name,
    JSON.stringify(c.redirectUris),
    nowMs,
  );
}

export function findClient(db: Db, clientId: string): ClientRecord | undefined {
  const row = db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as Row | undefined;
  if (!row) return undefined;
  return {
    clientId,
    name: row.name as string,
    redirectUris: JSON.parse(row.redirect_uris as string) as string[],
  };
}

export function createPending(
  db: Db,
  p: Omit<PendingAuthorization, "id" | "csrf" | "expiresAt">,
  nowMs: number,
) {
  const full: PendingAuthorization = {
    ...p,
    id: randomToken(16),
    csrf: randomToken(16),
    expiresAt: nowMs + PENDING_TTL_MS,
  };
  db.prepare("INSERT INTO oauth_pending VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    full.id,
    full.clientId,
    full.redirectUri,
    full.state,
    full.challenge,
    full.resource,
    full.scope,
    full.email,
    full.csrf,
    full.expiresAt,
  );
  return full;
}

export function takePending(db: Db, id: string, nowMs: number): PendingAuthorization | undefined {
  const row = db.prepare("SELECT * FROM oauth_pending WHERE id = ?").get(id) as Row | undefined;
  if (!row || (row.expires_at as number) < nowMs) return undefined;
  return {
    id,
    clientId: row.client_id as string,
    redirectUri: row.redirect_uri as string,
    state: row.state as string | null,
    challenge: row.challenge as string,
    resource: row.resource as string,
    scope: row.scope as string,
    email: row.email as string,
    csrf: row.csrf as string,
    expiresAt: row.expires_at as number,
  };
}

export function deletePending(db: Db, id: string): boolean {
  return Number(db.prepare("DELETE FROM oauth_pending WHERE id = ?").run(id).changes) === 1;
}

export function issueCode(db: Db, g: CodeGrant, nowMs: number): string {
  const code = randomToken();
  db.prepare("INSERT INTO oauth_codes VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)").run(
    sha256(code),
    g.clientId,
    g.redirectUri,
    g.challenge,
    g.resource,
    g.scope,
    g.email,
    randomToken(12),
    nowMs + CODE_TTL_MS,
  );
  return code;
}

export type CodeRedemption = { ok: true; grant: CodeGrant; family: string } | { ok: false };

export function redeemCode(db: Db, code: string, nowMs: number): CodeRedemption {
  const hash = sha256(code);
  const row = db.prepare("SELECT * FROM oauth_codes WHERE hash = ?").get(hash) as Row | undefined;
  if (!row) return { ok: false };
  if (row.used) {
    revokeFamily(db, row.family as string);
    return { ok: false };
  }
  if ((row.expires_at as number) < nowMs) return { ok: false };
  db.prepare("UPDATE oauth_codes SET used = 1 WHERE hash = ?").run(hash);
  return {
    ok: true,
    family: row.family as string,
    grant: {
      clientId: row.client_id as string,
      redirectUri: row.redirect_uri as string,
      challenge: row.challenge as string,
      resource: row.resource as string,
      scope: row.scope as string,
      email: row.email as string,
    },
  };
}

export function issueTokens(
  db: Db,
  g: { family: string; clientId: string; email: string; resource: string; scope: string },
  nowMs: number,
): TokenPair {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const insert = db.prepare("INSERT INTO oauth_tokens VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)");
  const args = [g.family, g.clientId, g.email, g.resource, g.scope, nowMs] as const;
  insert.run(sha256(accessToken), "access", ...args, nowMs + ACCESS_TTL_MS);
  insert.run(sha256(refreshToken), "refresh", ...args, nowMs + REFRESH_TTL_MS);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000, scope: g.scope };
}

export type RefreshRedemption =
  | { ok: true; family: string; clientId: string; email: string; resource: string; scope: string }
  | { ok: false };

export function redeemRefresh(db: Db, token: string, clientId: string, nowMs: number): RefreshRedemption {
  const hash = sha256(token);
  const row = db.prepare("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'").get(hash) as
    | Row
    | undefined;
  if (!row || row.client_id !== clientId) return { ok: false };
  if (row.used || row.revoked) {
    revokeFamily(db, row.family as string);
    return { ok: false };
  }
  if ((row.expires_at as number) < nowMs) return { ok: false };
  db.prepare("UPDATE oauth_tokens SET used = 1 WHERE hash = ?").run(hash);
  return {
    ok: true,
    family: row.family as string,
    clientId,
    email: row.email as string,
    resource: row.resource as string,
    scope: row.scope as string,
  };
}

export function verifyAccess(db: Db, token: string, nowMs: number): TokenInfo | undefined {
  const row = db
    .prepare("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = 'access' AND revoked = 0")
    .get(sha256(token)) as Row | undefined;
  if (!row || (row.expires_at as number) < nowMs) return undefined;
  return {
    email: row.email as string,
    clientId: row.client_id as string,
    resource: row.resource as string,
    scope: row.scope as string,
    expiresAt: row.expires_at as number,
  };
}

export function revokeFamily(db: Db, family: string): void {
  db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family = ?").run(family);
}

export function revokeAll(db: Db): number {
  migrate(db);
  return Number(db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE revoked = 0").run().changes);
}

export function listGrants(db: Db, nowMs = Date.now()): Grant[] {
  migrate(db);
  const rows = db
    .prepare(
      `SELECT t.family, t.client_id, t.email, MIN(t.created_at) AS created_at, MAX(t.expires_at) AS expires_at, c.name
       FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.revoked = 0 AND t.expires_at >= ?
       GROUP BY t.family ORDER BY created_at DESC`,
    )
    .all(nowMs) as Row[];
  return rows.map((r) => ({
    family: r.family as string,
    clientId: r.client_id as string,
    clientName: r.name as string | null,
    email: r.email as string,
    createdAt: new Date(r.created_at as number),
    expiresAt: new Date(r.expires_at as number),
  }));
}
