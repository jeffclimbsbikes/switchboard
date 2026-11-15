import { afterEach, describe, expect, it } from "vitest";
import { listGrants, revokeAll } from "../../src/http/server.js";
import {
  authorize,
  CALLBACK,
  decide,
  exchange,
  fullLogin,
  getCode,
  type Harness,
  mcp,
  OWNER,
  PUBLIC_URL,
  parseConsent,
  pkce,
  RESOURCE,
  register,
  startApp,
  token,
} from "./harness.js";

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const PRM_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`;

describe("happy path as claude.ai does it", () => {
  it("401 -> PRM -> AS metadata -> DCR -> authorize -> consent -> token -> mcp -> refresh -> reuse revokes", async () => {
    h = await startApp();

    const unauth = await mcp(h);
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PRM_URL}"`);

    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const prm = (await (await fetch(h.base + path)).json()) as Record<string, unknown>;
      expect(prm).toMatchObject({
        resource: RESOURCE,
        authorization_servers: [PUBLIC_URL],
        bearer_methods_supported: ["header"],
      });
      expect(prm.scopes_supported).toContain("offline_access");
    }

    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const as = (await (await fetch(h.base + path)).json()) as Record<string, unknown>;
      expect(as).toMatchObject({
        issuer: PUBLIC_URL,
        authorization_endpoint: `${PUBLIC_URL}/authorize`,
        token_endpoint: `${PUBLIC_URL}/token`,
        registration_endpoint: `${PUBLIC_URL}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: true,
      });
      expect(as.scopes_supported).toContain("offline_access");
    }

    const { res: regRes, body: client } = await register(h);
    expect(regRes.status).toBe(201);

    const { verifier, challenge } = pkce();
    const jwt = await h.jwt();
    const page = await authorize(h, { clientId: client.client_id as string, challenge, state: "xyz" }, jwt);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Allow Claude to use switchboard on switchboard.test?");
    expect(html).toContain(OWNER);

    const decision = await decide(h, parseConsent(html), "allow", jwt);
    expect(decision.status).toBe(302);
    const location = new URL(decision.headers.get("location") as string);
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code") as string;

    const tokenRes = await exchange(h, client.client_id as string, code, verifier);
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as Record<string, string | number>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });

    const list = await mcp(h, tokens.access_token as string);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((t) => t.name)).toEqual(["ping"]);

    const refreshed = await token(h, {
      grant_type: "refresh_token",
      client_id: client.client_id as string,
      refresh_token: tokens.refresh_token as string as string,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as Record<string, string>;
    expect(second.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(h, second.access_token)).status).toBe(200);
    expect(listGrants(h.db, h.clock.ms)).toHaveLength(1);

    const reuse = await token(h, {
      grant_type: "refresh_token",
      client_id: client.client_id as string,
      refresh_token: tokens.refresh_token as string as string,
    });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");

    expect((await mcp(h, second.access_token)).status).toBe(401);
    const afterReuse = await token(h, {
      grant_type: "refresh_token",
      client_id: client.client_id as string,
      refresh_token: second.refresh_token as string,
    });
    expect(afterReuse.status).toBe(400);
    expect(listGrants(h.db, h.clock.ms)).toHaveLength(0);
  });

  it("accepts a JSON token request", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const { verifier, challenge } = pkce();
    const code = await getCode(h, client.client_id as string, challenge);
    const res = await token(
      h,
      {
        grant_type: "authorization_code",
        client_id: client.client_id as string,
        code,
        code_verifier: verifier,
        redirect_uri: CALLBACK,
      },
      true,
    );
    expect(res.status).toBe(200);
  });

  it("revokeAll kills every token", async () => {
    h = await startApp();
    const { tokens } = await fullLogin(h);
    expect((await mcp(h, tokens.access_token)).status).toBe(200);
    expect(revokeAll(h.db)).toBeGreaterThan(0);
    expect((await mcp(h, tokens.access_token)).status).toBe(401);
  });

  it("GET and DELETE /mcp are 405", async () => {
    h = await startApp();
    const { tokens } = await fullLogin(h);
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${h.base}/mcp`, {
        method,
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      expect(res.status).toBe(405);
    }
  });
});

describe("CIMD", () => {
  const clientId = "https://claude.ai/oauth/claude-code-client-metadata";
  const doc = (over: Record<string, unknown> = {}) => ({
    client_id: clientId,
    client_name: "Claude Code",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    token_endpoint_auth_method: "none",
    ...over,
  });
  const fakeFetch = (body: unknown, init: ResponseInit = {}) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("fetches the metadata document, honours loopback with any port, and caches", async () => {
    const f = fakeFetch(doc());
    h = await startApp({}, { fetch: f.fetchImpl });
    const { verifier, challenge } = pkce();
    const redirectUri = "http://localhost:54321/callback";
    const code = await getCode(h, clientId, challenge, { redirectUri });
    const res = await exchange(h, clientId, code, verifier, { redirect_uri: redirectUri });
    expect(res.status).toBe(200);
    expect(f.calls).toEqual([clientId]);
  });

  it("rejects a document whose client_id differs from its URL", async () => {
    const f = fakeFetch(doc({ client_id: "https://evil.example/x" }));
    h = await startApp({}, { fetch: f.fetchImpl });
    const res = await authorize(
      h,
      { clientId, challenge: pkce().challenge, redirectUri: "http://localhost:1/callback" },
      await h.jwt(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an oversized document", async () => {
    const f = fakeFetch(JSON.stringify(doc({ pad: "x".repeat(70_000) })));
    h = await startApp({}, { fetch: f.fetchImpl });
    const res = await authorize(
      h,
      { clientId, challenge: pkce().challenge, redirectUri: "http://localhost:1/callback" },
      await h.jwt(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects cross-host redirects", async () => {
    const f = fakeFetch("", { status: 302, headers: { location: "https://other.example/doc" } });
    h = await startApp({}, { fetch: f.fetchImpl });
    const res = await authorize(
      h,
      { clientId, challenge: pkce().challenge, redirectUri: "http://localhost:1/callback" },
      await h.jwt(),
    );
    expect(res.status).toBe(400);
    expect(f.calls).toHaveLength(1);
  });

  it("rejects a redirect_uri the document does not list", async () => {
    const f = fakeFetch(doc());
    h = await startApp({}, { fetch: f.fetchImpl });
    const res = await authorize(
      h,
      { clientId, challenge: pkce().challenge, redirectUri: CALLBACK },
      await h.jwt(),
    );
    expect(res.status).toBe(400);
  });
});

describe("identity", () => {
  it("requires a JWT on /authorize and on the decision POST", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const { challenge } = pkce();
    const id = client.client_id as string;

    expect((await authorize(h, { clientId: id, challenge })).status).toBe(403);
    expect((await authorize(h, { clientId: id, challenge }, "garbage")).status).toBe(403);

    const jwt = await h.jwt();
    const consent = parseConsent(await (await authorize(h, { clientId: id, challenge }, jwt)).text());
    expect((await decide(h, consent, "allow")).status).toBe(403);
    const other = await h.jwt({ email: "other@example.com" });
    expect((await decide(h, consent, "allow", other)).status).toBe(403);
  });

  it("rejects expired, wrong audience, wrong issuer and non-allowed email", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const { challenge } = pkce();
    const id = client.client_id as string;
    const bad = [
      await h.jwt({ exp: Math.floor(Date.now() / 1000) - 600 }),
      await h.jwt({ aud: "someone-else" }),
      await h.jwt({ iss: "https://evil.cloudflareaccess.com" }),
      await h.jwt({ email: "stranger@example.com" }),
    ];
    for (const jwt of bad) {
      const res = await authorize(h, { clientId: id, challenge }, jwt);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Cloudflare Access");
    }
  });

  it("matches the allow list case-insensitively", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const jwt = await h.jwt({ email: "OTHER@example.com" });
    const res = await authorize(
      h,
      { clientId: client.client_id as string, challenge: pkce().challenge },
      jwt,
    );
    expect(res.status).toBe(200);
  });

  it("consent deny redirects with access_denied", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const jwt = await h.jwt();
    const page = await authorize(
      h,
      { clientId: client.client_id as string, challenge: pkce().challenge, state: "s9" },
      jwt,
    );
    const res = await decide(h, parseConsent(await page.text()), "deny", jwt);
    const location = new URL(res.headers.get("location") as string);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("s9");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("rejects a bad CSRF token and a replayed decision", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const jwt = await h.jwt();
    const page = await authorize(
      h,
      { clientId: client.client_id as string, challenge: pkce().challenge },
      jwt,
    );
    const consent = parseConsent(await page.text());
    expect((await decide(h, { ...consent, csrf: "nope" }, "allow", jwt)).status).toBe(400);
    expect((await decide(h, consent, "allow", jwt)).status).toBe(302);
    expect((await decide(h, consent, "allow", jwt)).status).toBe(400);
  });
});

describe("authorize validation", () => {
  it("rejects unregistered and non-allowlisted redirect URIs", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const jwt = await h.jwt();
    const { challenge } = pkce();
    const other = await authorize(
      h,
      { clientId: id, challenge, redirectUri: "https://claude.com/api/mcp/auth_callback" },
      jwt,
    );
    expect(other.status).toBe(400);
    const evil = await authorize(h, { clientId: id, challenge, redirectUri: "https://evil.example/cb" }, jwt);
    expect(evil.status).toBe(400);
    const dcr = await register(h, ["https://evil.example/cb"]);
    expect(dcr.res.status).toBe(400);
    expect(dcr.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects a wrong resource and missing PKCE via redirect errors", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const jwt = await h.jwt();
    const wrong = await authorize(
      h,
      { clientId: id, challenge: pkce().challenge, resource: "https://elsewhere.test/mcp" },
      jwt,
    );
    expect(wrong.status).toBe(302);
    expect(new URL(wrong.headers.get("location") as string).searchParams.get("error")).toBe("invalid_target");

    const q = new URLSearchParams({
      response_type: "code",
      client_id: id,
      redirect_uri: CALLBACK,
      state: "a",
    });
    const noPkce = await fetch(`${h.base}/authorize?${q}`, {
      redirect: "manual",
      headers: { "cf-access-jwt-assertion": jwt },
    });
    expect(new URL(noPkce.headers.get("location") as string).searchParams.get("error")).toBe(
      "invalid_request",
    );
  });

  it("accepts a trailing-slash, upper-case-host resource and omitted resource", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const jwt = await h.jwt();
    const a = await authorize(
      h,
      { clientId: id, challenge: pkce().challenge, resource: "https://SWITCHBOARD.test/mcp/" },
      jwt,
    );
    expect(a.status).toBe(200);
    const b = await authorize(h, { clientId: id, challenge: pkce().challenge, resource: null }, jwt);
    expect(b.status).toBe(200);
  });
});

describe("token endpoint", () => {
  it("rejects a bad PKCE verifier and then the burned code", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const { verifier, challenge } = pkce();
    const code = await getCode(h, id, challenge);
    const bad = await exchange(h, id, code, pkce().verifier);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await exchange(h, id, code, verifier)).status).toBe(400);
  });

  it("reusing a code revokes the tokens it produced", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const { verifier, challenge } = pkce();
    const code = await getCode(h, id, challenge);
    const ok = (await (await exchange(h, id, code, verifier)).json()) as Record<string, string>;
    expect((await mcp(h, ok.access_token)).status).toBe(200);
    expect((await exchange(h, id, code, verifier)).status).toBe(400);
    expect((await mcp(h, ok.access_token)).status).toBe(401);
  });

  it("rejects wrong redirect_uri, wrong resource, wrong client, expired code", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const { body: other } = await register(h);
    const id = client.client_id as string;
    const { verifier, challenge } = pkce();

    const c1 = await getCode(h, id, challenge);
    const r1 = await exchange(h, id, c1, verifier, { redirect_uri: "http://localhost/callback" });
    expect(((await r1.json()) as { error: string }).error).toBe("invalid_grant");

    const c2 = await getCode(h, id, challenge);
    const r2 = await exchange(h, id, c2, verifier, { resource: "https://elsewhere.test/mcp" });
    expect(((await r2.json()) as { error: string }).error).toBe("invalid_target");

    const c3 = await getCode(h, id, challenge);
    const r3 = await exchange(h, other.client_id as string, c3, verifier);
    expect(((await r3.json()) as { error: string }).error).toBe("invalid_grant");

    const c4 = await getCode(h, id, challenge);
    h.clock.ms += 61_000;
    const r4 = await exchange(h, id, c4, verifier);
    expect(((await r4.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("returns RFC 6749 errors for bad requests", async () => {
    h = await startApp();
    const { body: client } = await register(h);
    const id = client.client_id as string;
    const err = async (params: Record<string, string>) =>
      (await (await token(h, params)).json()) as { error: string };
    expect((await err({})).error).toBe("invalid_request");
    expect((await err({ grant_type: "client_credentials", client_id: id })).error).toBe(
      "unsupported_grant_type",
    );
    expect((await err({ grant_type: "refresh_token", client_id: "nobody" })).error).toBe("invalid_client");
    expect((await err({ grant_type: "refresh_token", client_id: id })).error).toBe("invalid_request");
    expect((await err({ grant_type: "refresh_token", client_id: id, refresh_token: "bogus" })).error).toBe(
      "invalid_grant",
    );
  });

  it("expires access tokens and refresh tokens", async () => {
    h = await startApp();
    const { clientId, tokens } = await fullLogin(h);
    h.clock.ms += 3_600_001;
    const res = await mcp(h, tokens.access_token);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);

    const refreshed = await token(h, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token as string,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as Record<string, string>;
    expect((await mcp(h, next.access_token)).status).toBe(200);

    h.clock.ms += 31 * 86_400_000;
    const dead = await token(h, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: next.refresh_token as string,
    });
    expect(dead.status).toBe(400);
  });

  it("rejects a token issued for a different client on the refresh grant", async () => {
    h = await startApp();
    const { tokens } = await fullLogin(h);
    const { body: other } = await register(h);
    const res = await token(h, {
      grant_type: "refresh_token",
      client_id: other.client_id as string,
      refresh_token: tokens.refresh_token as string,
    });
    expect(res.status).toBe(400);
  });
});

describe("/mcp bearer", () => {
  it("rejects garbage tokens with invalid_token", async () => {
    h = await startApp();
    const res = await mcp(h, "not-a-token");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

describe("login modes", () => {
  it("refuses none off loopback, dev off loopback, and missing public_url", async () => {
    await expect(startApp({ listen: "0.0.0.0:8787", auth: { login: "none" } })).rejects.toThrow(/loopback/);
    await expect(startApp({ listen: "0.0.0.0:8787", auth: { login: "dev", email: OWNER } })).rejects.toThrow(
      /loopback/,
    );
    await expect(startApp({ listen: "[::]:8787", auth: { login: "none" } })).rejects.toThrow(/loopback/);
    await expect(startApp({ public_url: undefined })).rejects.toThrow(/public_url/);
  });

  it("none on loopback serves /mcp unauthenticated with no OAuth routes", async () => {
    h = await startApp({ auth: { login: "none" } });
    expect((await mcp(h)).status).toBe(200);
    expect((await fetch(`${h.base}/.well-known/oauth-authorization-server`)).status).toBe(404);
    expect((await fetch(`${h.base}/token`, { method: "POST" })).status).toBe(404);
  });

  it("dev identifies as the configured email and still shows consent", async () => {
    h = await startApp({ auth: { login: "dev", email: "dev@example.com" } });
    const { body: client } = await register(h);
    const { verifier, challenge } = pkce();
    const page = await authorize(h, { clientId: client.client_id as string, challenge });
    const html = await page.text();
    expect(html).toContain("dev@example.com");
    const res = await decide(h, parseConsent(html), "allow");
    const code = new URL(res.headers.get("location") as string).searchParams.get("code") as string;
    const tokens = (await (await exchange(h, client.client_id as string, code, verifier)).json()) as Record<
      string,
      string
    >;
    expect((await mcp(h, tokens.access_token)).status).toBe(200);
  });
});

describe("client registration hygiene", () => {
  it("prunes registrations that never got used", async () => {
    const { startApp, register } = await import("./harness.js");
    const { countClients } = await import("../../src/http/auth/store.js");
    const h = await startApp();
    try {
      await register(h);
      expect(countClients(h.db)).toBe(1);
      h.clock.ms += 2 * 86_400_000;
      await register(h);
      expect(countClients(h.db)).toBe(1);
    } finally {
      await h.close();
    }
  });
});
