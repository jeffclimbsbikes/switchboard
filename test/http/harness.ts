import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { type Config, parseConfig } from "../../src/config.js";
import { openDb } from "../../src/db.js";
import { createHttpApp } from "../../src/http/server.js";

export const PUBLIC_URL = "https://switchboard.test";
export const RESOURCE = `${PUBLIC_URL}/mcp`;
export const TEAM = "acme";
export const AUD = "aud-tag-123";
export const OWNER = "owner@example.com";
export const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export const baseConfig = (over: Record<string, unknown> = {}): Config =>
  parseConfig({
    listen: "127.0.0.1:8787",
    public_url: PUBLIC_URL,
    agents: { fake: { driver: "fake" } },
    workspaces: { w: "/tmp" },
    auth: { login: "cloudflare-access", team: TEAM, aud: AUD, allow: [OWNER, "Other@Example.com"] },
    ...over,
  });

export function trivialServer(): McpServer {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool("ping", { description: "pong" }, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  return server;
}

export async function startApp(over: Record<string, unknown> = {}, extra: { fetch?: typeof fetch } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const clock = { ms: Date.now() };
  const db = openDb(":memory:");
  const app = createHttpApp({
    config: baseConfig(over),
    db,
    createMcpServer: trivialServer,
    now: () => new Date(clock.ms),
    accessKeys: createLocalJWKSet({ keys: [jwk] }),
    ...extra,
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  const jwt = async (o: { email?: string; aud?: string; iss?: string; exp?: number } = {}) =>
    new SignJWT({ email: o.email ?? OWNER })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? `https://${TEAM}.cloudflareaccess.com`)
      .setAudience(o.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 3600)
      .sign(privateKey);

  return {
    base,
    db,
    clock,
    jwt,
    close: () => new Promise<void>((r) => listener.close(() => r())),
  };
}

export type Harness = Awaited<ReturnType<typeof startApp>>;

export async function register(h: Harness, redirectUris = [CALLBACK]) {
  const res = await fetch(`${h.base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    }),
  });
  return { res, body: (await res.json()) as Record<string, string> };
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri?: string;
  challenge: string;
  resource?: string | null;
  state?: string;
}

export async function authorize(h: Harness, p: AuthorizeParams, jwt?: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri ?? CALLBACK,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state ?? "st",
  });
  if (p.resource !== null) q.set("resource", p.resource ?? RESOURCE);
  return fetch(`${h.base}/authorize?${q}`, {
    redirect: "manual",
    headers: jwt ? { "cf-access-jwt-assertion": jwt } : {},
  });
}

export function parseConsent(html: string) {
  const pending = /name="pending" value="([^"]+)"/.exec(html)?.[1];
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  return { pending: pending as string, csrf: csrf as string };
}

export async function decide(
  h: Harness,
  c: { pending: string; csrf: string },
  decision: "allow" | "deny",
  jwt?: string,
) {
  return fetch(`${h.base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
    },
    body: new URLSearchParams({ ...c, decision }),
  });
}

export async function getCode(
  h: Harness,
  clientId: string,
  challenge: string,
  over: Partial<AuthorizeParams> = {},
) {
  const jwt = await h.jwt();
  const page = await authorize(h, { clientId, challenge, ...over }, jwt);
  const consent = parseConsent(await page.text());
  const res = await decide(h, consent, "allow", jwt);
  const location = new URL(res.headers.get("location") as string);
  return location.searchParams.get("code") as string;
}

export function token(h: Harness, params: Record<string, string>, json = false) {
  return fetch(`${h.base}/token`, {
    method: "POST",
    headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
    body: json ? JSON.stringify(params) : new URLSearchParams(params),
  });
}

export async function exchange(
  h: Harness,
  clientId: string,
  code: string,
  verifier: string,
  over: Record<string, string> = {},
) {
  return token(h, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    resource: RESOURCE,
    ...over,
  });
}

export function mcp(h: Harness, accessToken?: string, method = "tools/list") {
  return fetch(`${h.base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
}

export async function fullLogin(h: Harness) {
  const { body: client } = await register(h);
  const { verifier, challenge } = pkce();
  const code = await getCode(h, client.client_id as string, challenge);
  const res = await exchange(h, client.client_id as string, code, verifier);
  return { clientId: client.client_id as string, tokens: (await res.json()) as Record<string, string> };
}
