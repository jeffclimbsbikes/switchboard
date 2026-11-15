import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type { Db } from "../../db.js";
import { ClientError, type ClientResolver, redirectUriRegistered, registerClient } from "./clients.js";
import type { Identify } from "./identity.js";
import { accessRequiredPage, consentPage, errorPage } from "./pages.js";
import {
  createPending,
  deletePending,
  issueCode,
  issueTokens,
  redeemCode,
  redeemRefresh,
  safeEqual,
  sweep,
  takePending,
} from "./store.js";

export const SCOPES = ["mcp", "offline_access"];

export interface OAuthDeps {
  db: Db;
  now: () => Date;
  issuer: string;
  resource: string;
  identify: Identify;
  clients: ClientResolver;
  loginMode: "cloudflare-access" | "dev";
}

export function canonicalResource(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (u.hash || u.search || (u.protocol !== "https:" && u.protocol !== "http:")) return undefined;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

const PKCE_CHARS = /^[A-Za-z0-9_-]{43,128}$/;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function tokenError(res: Response, status: number, error: string, description: string): void {
  res
    .status(status)
    .set({ "Cache-Control": "no-store", Pragma: "no-cache" })
    .json({ error, error_description: description });
}

function redirectWith(res: Response, redirectUri: string, params: Record<string, string | null>): void {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  res.set("Cache-Control", "no-store").redirect(302, url.href);
}

export function metadataRouter(issuer: string, resource: string): Router {
  const router = express.Router();
  const prm = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
  };
  const as = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    scopes_supported: SCOPES,
  };
  const serve = (body: object) => (_req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300").json(body);
  };
  router.get("/.well-known/oauth-protected-resource", serve(prm));
  router.get("/.well-known/oauth-protected-resource/mcp", serve(prm));
  router.get("/.well-known/oauth-authorization-server", serve(as));
  router.get("/.well-known/openid-configuration", serve(as));
  return router;
}

export function oauthRouter(deps: OAuthDeps): Router {
  const { db, now, resource } = deps;
  const router = express.Router();
  const serverHost = new URL(deps.issuer).host;
  const body = express.urlencoded({ extended: false, limit: "32kb" });
  const json = express.json({ limit: "32kb" });
  let lastSweep = 0;
  const tick = () => {
    const t = now().getTime();
    if (t - lastSweep > 60_000) {
      lastSweep = t;
      sweep(db, t);
    }
  };

  router.post("/register", json, (req, res) => {
    tick();
    try {
      const client = registerClient(db, req.body, now().getTime());
      res
        .status(201)
        .set("Cache-Control", "no-store")
        .json({
          client_id: client.clientId,
          client_name: client.name || undefined,
          redirect_uris: client.redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          client_id_issued_at: Math.floor(now().getTime() / 1000),
        });
    } catch (e) {
      if (!(e instanceof ClientError)) throw e;
      res
        .status(e.code === "temporarily_unavailable" ? 503 : 400)
        .json({ error: e.code, error_description: e.message });
    }
  });

  router.get("/authorize", async (req, res) => {
    tick();
    const email = await deps.identify(req);
    if (!email) return accessRequiredPage(res);

    const q = req.query;
    const clientId = str(q.client_id);
    const redirectUri = str(q.redirect_uri);
    if (!clientId || !redirectUri) return errorPage(res, 400, "Missing client_id or redirect_uri.");
    let client: Awaited<ReturnType<ClientResolver["resolve"]>>;
    try {
      client = await deps.clients.resolve(clientId);
    } catch (e) {
      if (!(e instanceof ClientError)) throw e;
      return errorPage(res, 400, `Unknown or invalid client: ${e.message}.`);
    }
    if (!redirectUriRegistered(client, redirectUri)) {
      return errorPage(res, 400, "This redirect URI is not registered for the client or not permitted.");
    }

    const state = str(q.state) ?? null;
    const fail = (error: string, description: string) =>
      redirectWith(res, redirectUri, { error, error_description: description, state });

    if (q.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challenge = str(q.code_challenge);
    if (!challenge || !PKCE_CHARS.test(challenge) || q.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    const requested = str(q.resource);
    if (requested !== undefined && canonicalResource(requested) !== resource) {
      return fail("invalid_target", "resource does not match this server");
    }
    const asked = (str(q.scope) ?? "").split(/\s+/).filter((s) => SCOPES.includes(s));
    const scope = (asked.length > 0 ? asked : ["mcp"]).join(" ");

    const pending = createPending(
      db,
      { clientId, redirectUri, state, challenge, resource, scope, email },
      now().getTime(),
    );
    consentPage(res, {
      clientName: client.name,
      redirectHost: new URL(redirectUri).host,
      serverHost,
      email,
      pendingId: pending.id,
      csrf: pending.csrf,
    });
  });

  router.post("/authorize", body, async (req: Request, res: Response) => {
    tick();
    const email = await deps.identify(req);
    if (!email) return accessRequiredPage(res);
    const pendingId = str(req.body?.pending);
    const csrf = str(req.body?.csrf);
    const pending = pendingId ? takePending(db, pendingId, now().getTime()) : undefined;
    if (!pending || !csrf || !safeEqual(pending.csrf, csrf)) {
      return errorPage(
        res,
        400,
        "This authorization request expired or is invalid. Start again from your client.",
      );
    }
    if (pending.email !== email) {
      return errorPage(res, 403, "You are not signed in as the account that started this request.");
    }
    if (!deletePending(db, pending.id)) {
      return errorPage(res, 400, "This authorization request was already used.");
    }
    if (req.body?.decision !== "allow") {
      return redirectWith(res, pending.redirectUri, { error: "access_denied", state: pending.state });
    }
    const code = issueCode(db, pending, now().getTime());
    redirectWith(res, pending.redirectUri, { code, state: pending.state });
  });

  router.post("/token", body, json, async (req: Request, res: Response) => {
    tick();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const grantType = str(b.grant_type);
    const clientId = str(b.client_id);
    if (!grantType) return tokenError(res, 400, "invalid_request", "grant_type is required");
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      return tokenError(res, 400, "unsupported_grant_type", "unsupported grant_type");
    }
    if (!clientId) return tokenError(res, 400, "invalid_request", "client_id is required");
    try {
      await deps.clients.resolve(clientId);
    } catch (e) {
      if (!(e instanceof ClientError)) throw e;
      return tokenError(res, 401, "invalid_client", e.message);
    }
    const requestedResource = str(b.resource);
    if (requestedResource !== undefined && canonicalResource(requestedResource) !== resource) {
      return tokenError(res, 400, "invalid_target", "resource does not match this server");
    }
    const nowMs = now().getTime();

    if (grantType === "authorization_code") {
      const code = str(b.code);
      const verifier = str(b.code_verifier);
      const redirectUri = str(b.redirect_uri);
      if (!code || !verifier || !redirectUri) {
        return tokenError(res, 400, "invalid_request", "code, code_verifier and redirect_uri are required");
      }
      const redeemed = redeemCode(db, code, nowMs);
      const g = redeemed.ok ? redeemed.grant : undefined;
      const computed = createHash("sha256").update(verifier).digest("base64url");
      if (
        !redeemed.ok ||
        !g ||
        g.clientId !== clientId ||
        g.redirectUri !== redirectUri ||
        !PKCE_CHARS.test(verifier) ||
        !safeEqual(computed, g.challenge)
      ) {
        return tokenError(res, 400, "invalid_grant", "invalid, expired or already-used authorization code");
      }
      const tokens = issueTokens(db, { ...g, family: redeemed.family }, nowMs);
      return sendTokens(res, tokens);
    }

    const refresh = str(b.refresh_token);
    if (!refresh) return tokenError(res, 400, "invalid_request", "refresh_token is required");
    const r = redeemRefresh(db, refresh, clientId, nowMs);
    if (!r.ok) return tokenError(res, 400, "invalid_grant", "invalid, expired or revoked refresh token");
    sendTokens(res, issueTokens(db, r, nowMs));
  });

  return router;
}

function sendTokens(res: Response, t: ReturnType<typeof issueTokens>): void {
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache" }).json({
    access_token: t.accessToken,
    token_type: "Bearer",
    expires_in: t.expiresIn,
    refresh_token: t.refreshToken,
    scope: t.scope,
  });
}
