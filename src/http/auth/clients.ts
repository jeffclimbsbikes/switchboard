import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Db } from "../../db.js";
import {
  type ClientRecord,
  countClients,
  findClient,
  MAX_CLIENTS,
  pruneUnusedClients,
  randomToken,
  saveClient,
  sweep,
} from "./store.js";

const CIMD_TIMEOUT_MS = 5_000;
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_CACHE_MS = 3_600_000;
const CIMD_MAX_REDIRECTS = 3;

const FIXED_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export class ClientError extends Error {
  constructor(
    readonly code:
      | "invalid_client"
      | "invalid_redirect_uri"
      | "invalid_client_metadata"
      | "temporarily_unavailable",
    message: string,
  ) {
    super(message);
  }
}

export function isCimdId(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function redirectUriAllowed(uri: string): boolean {
  if (FIXED_CALLBACKS.has(uri)) return true;
  const u = parseUrl(uri);
  return !!u && u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname) && !u.hash && !u.username;
}

function sameRedirect(a: string, b: string): boolean {
  if (a === b) return true;
  const x = parseUrl(a);
  const y = parseUrl(b);
  if (!x || !y) return false;
  const loopback = x.protocol === "http:" && y.protocol === "http:" && LOOPBACK_HOSTS.has(x.hostname);
  return loopback && x.hostname === y.hostname && x.pathname === y.pathname && x.search === y.search;
}

export function redirectUriRegistered(client: ClientRecord, uri: string): boolean {
  return redirectUriAllowed(uri) && client.redirectUris.some((r) => sameRedirect(r, uri));
}

export function registerClient(db: Db, body: unknown, nowMs: number): ClientRecord {
  const b = (body ?? {}) as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string")) {
    throw new ClientError("invalid_redirect_uri", "redirect_uris must be a non-empty array of strings");
  }
  const bad = (uris as string[]).find((u) => !redirectUriAllowed(u));
  if (bad) throw new ClientError("invalid_redirect_uri", `redirect_uri not allowed: ${bad}`);
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    throw new ClientError("invalid_client_metadata", "only public clients (token_endpoint_auth_method none)");
  }
  const name =
    typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : "";
  sweep(db, nowMs);
  pruneUnusedClients(db, nowMs);
  if (countClients(db) >= MAX_CLIENTS) {
    throw new ClientError("temporarily_unavailable", "too many registered clients; try again later");
  }
  const client = { clientId: randomToken(16), name, redirectUris: [...new Set(uris as string[])] };
  saveClient(db, client, nowMs);
  return client;
}

function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a.includes(":")) {
    return (
      a === "::1" ||
      a === "::" ||
      a.startsWith("fc") ||
      a.startsWith("fd") ||
      a.startsWith("fe80") ||
      a.startsWith("::ffff:")
    );
  }
  const [p, q] = a.split(".").map(Number) as [number, number];
  return (
    p === 10 ||
    p === 127 ||
    p === 0 ||
    (p === 172 && q >= 16 && q <= 31) ||
    (p === 192 && q === 168) ||
    (p === 169 && q === 254) ||
    (p === 100 && q >= 64 && q <= 127)
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new ClientError("invalid_client", "client metadata host is not public");
  }
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
    throw new ClientError("invalid_client", "client metadata host is not public");
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CIMD_MAX_BYTES) {
      await reader.cancel();
      throw new ClientError("invalid_client", "client metadata document too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class ClientResolver {
  private cache = new Map<string, { client: ClientRecord; expires: number }>();

  constructor(
    private db: Db,
    private now: () => Date,
    private fetchImpl: typeof fetch | undefined,
  ) {}

  async resolve(clientId: string): Promise<ClientRecord> {
    if (!isCimdId(clientId)) {
      const stored = findClient(this.db, clientId);
      if (!stored) throw new ClientError("invalid_client", "unknown client_id");
      return stored;
    }
    const nowMs = this.now().getTime();
    const hit = this.cache.get(clientId);
    if (hit && hit.expires > nowMs) return hit.client;
    const client = await this.fetchDocument(clientId);
    this.cache.set(clientId, { client, expires: nowMs + CIMD_CACHE_MS });
    return client;
  }

  private async fetchDocument(clientId: string): Promise<ClientRecord> {
    const origin = new URL(clientId);
    let url = origin;
    let res: Response | undefined;
    for (let hops = 0; hops <= CIMD_MAX_REDIRECTS; hops++) {
      if (!this.fetchImpl) await assertPublicHost(url.hostname);
      try {
        res = await (this.fetchImpl ?? fetch)(url.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
          headers: { accept: "application/json" },
        });
      } catch {
        throw new ClientError("invalid_client", "could not fetch client metadata document");
      }
      if (res.status < 300 || res.status >= 400) break;
      const next = parseUrl(new URL(res.headers.get("location") ?? "", url).href);
      if (next?.protocol !== "https:" || next.host !== origin.host) {
        throw new ClientError("invalid_client", "client metadata redirected to another host");
      }
      url = next;
      res = undefined;
    }
    if (!res?.ok) throw new ClientError("invalid_client", "client metadata document unavailable");
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(await readCapped(res)) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ClientError) throw e;
      throw new ClientError("invalid_client", "client metadata document is not JSON");
    }
    if (doc.client_id !== clientId) {
      throw new ClientError("invalid_client", "client_id in metadata document does not match its URL");
    }
    const uris = doc.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string")) {
      throw new ClientError("invalid_client", "client metadata has no redirect_uris");
    }
    const method = doc.token_endpoint_auth_method;
    if (method !== undefined && method !== "none") {
      throw new ClientError("invalid_client", "client metadata must declare a public client");
    }
    const name = typeof doc.client_name === "string" ? doc.client_name.trim().slice(0, 100) : "";
    return { clientId, name, redirectUris: uris as string[] };
  }
}
