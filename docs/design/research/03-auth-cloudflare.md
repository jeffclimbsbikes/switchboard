# 03 - Auth + Cloudflare for switchboard (researched 2026-11-14)

Legend: [D] = Anthropic/Cloudflare official doc, [I] = GitHub issue / third party, [?] = inference, unverified.

## 1. claude.ai custom connector requirements

Primary sources: https://claude.com/docs/connectors/building , https://claude.com/docs/connectors/building/authentication.md , https://claude.com/docs/connectors/building/troubleshooting.md , https://claude.com/docs/connectors/building/testing.md , legacy help article https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers

- Transport [D]: Streamable HTTP. Legacy HTTP+SSE still works but is being deprecated. Same client backs claude.ai web, Desktop, mobile, Cowork, Claude Code.
- Spec versions [D]: follows authorization specs 2025-03-26, 2025-06-18, 2025-11-25.
- Flow [D]: unauthenticated request must get **HTTP 401** with `WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"`. A `WWW-Authenticate` on a 200 is ignored. Optional `scope=` param in the header; otherwise uses `scopes_supported` from PRM. Fallback if no pointer: probes `/.well-known/oauth-protected-resource/<mcp-path>` then `/.well-known/oauth-protected-resource`.
- PRM (RFC 9728) [D]: `resource` must equal the URL the user typed exactly (incl. path). `authorization_servers`: Claude uses ONLY the first entry. AS may be on another host (that host must also be reachable from Anthropic egress).
- AS metadata [D]: tries `/.well-known/oauth-authorization-server` (RFC 8414), then `/.well-known/openid-configuration`. Must advertise `code_challenge_methods_supported: ["S256"]`. PKCE S256 always sent.
- Client identity [D]: auth types `oauth_dcr` and `oauth_cimd` supported by default. CIMD chosen only if AS metadata has BOTH `"client_id_metadata_document_supported": true` AND `"none"` in `token_endpoint_auth_methods_supported`; otherwise falls back to DCR (`registration_endpoint`). DCR makes a new client per fresh connection (Anthropic prefers CIMD for high traffic). Manual client_id/secret: custom connector "Advanced settings" lets owner enter OAuth client ID (+ optional secret; blank secret = public client) [D: authentication.md "Custom connectors"]. Other: static request headers (beta, limited orgs).
- Redirect URI [D]: `https://claude.ai/api/mcp/auth_callback` (web/Desktop/mobile/Cowork). Docs do not mention a claude.com callback in the current page (older help article warned it "may change to claude.com" [I: third-party quote]; allowlist `https://claude.com/api/mcp/auth_callback` too, cheap). Claude Code: loopback `http://localhost/callback` and `http://127.0.0.1/callback`, port-agnostic match; its CIMD is https://claude.ai/oauth/claude-code-client-metadata.
- RFC 8707 `resource` param sent on authorize and token requests, canonical form (lowercase host, no trailing slash, no default port). AS should bind `aud` to it; MCP server should compare canonical value [D].
- Token endpoint [D]: must accept `application/x-www-form-urlencoded`; discovery/registration/token must answer within 10 s, refresh within 30 s. Refresh: reactive on 401 and proactive 5 min before expiry; return `invalid_grant` for dead refresh tokens; rotate refresh tokens for public clients; Claude appends `offline_access` if AS lists it in `scopes_supported`. `client_credentials` not supported.
- Network [D]: outbound from `160.79.104.0/21` (https://platform.claude.com/docs/en/api/ip-addresses). Connectors are IPv4-only: host needs a public A record; private/CGNAT/loopback or mixed answers rejected (tunnel hostname is fine). No redirects to another host (Authorization dropped). Discovery to the AS comes from the same IP range, so a WAF in front of the IdP breaks the flow.
- Not supported [D]: resource subscriptions, sampling, draft capabilities. Limits: tool result ~150,000 chars; **240 s per tool call** on claude.ai/Desktop.
- Plans: free = one custom connector [I]. Add via Customize > Connectors; Team/Enterprise owner adds.

## 2. Elicitation, Tasks, progress, long calls, voice

- Elicitation: not documented anywhere in Anthropic docs (docs index search: "None found") [D-absence]. [I] https://github.com/infranodus/mcp-server-infranodus/pull/29: claude.ai connectors open no standalone GET notification stream, so server-initiated requests not tied to a tool call vanish (60 s timeout); author fixed by sending elicitation on the tool call's own response stream; whether the proxy forwards it to the user was unverified. Verdict: do not depend on elicitation; if used, only in-band during a tools/call.
- MCP Tasks (async): no documentation of support [D-absence]. Assume unsupported; design own job pattern (start_job returns id, poll tool).
- Progress: no doc for claude.ai. Claude Code docs say progress does not extend the hard wall-clock limit [I: https://code.claude.com/docs/en/mcp]. Treat as cosmetic.
- Timeouts: 240 s/tool call documented. Reports of 30 s and 60 s timeouts via claude.ai connectors exist (https://github.com/anthropics/claude-code/issues/86502; https://automatelab.tech/blog/ai-agents/mcp-remote-tool-60s-timeout/) [I, unverified]. Keep tools under ~30 s; use poll pattern for anything longer.
- Voice mobile: Help center says voice mode can use connected tools (https://support.claude.com/en/articles/11101966-using-voice-mode-on-claude-mobile-apps) but not every result renders on screen. Custom connectors are added on web/desktop and sync to mobile. Known bug (July 2026, user-filed): custom remote MCP tools fail "tool is not registered" in voice mode only, text works (https://claudeissues.com/issue/77312-bug-claude-ai-voice-mode-custom-mcp-connector-tools-fail-with-tool-is-not-regist) [I]. Voice with custom connectors: unconfirmed, test early.

## 3. Cloudflare options

### (a) Access Managed OAuth / MCP server portals
Docs: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/ . Portal at `/mcp`, 401 + discovery, Access login via IdP. Docs list Claude custom connectors as supported, requiring `https://claude.ai/api/mcp/auth_callback` as allowed redirect. Limits: upstream tool calls time out at 60 s; SSE not supported through Gateway; no device posture; docs do not say portal supports DCR/CIMD for end clients.
Known failure: https://github.com/anthropics/claude-ai-mcp/issues/410 (closed "not planned" 2026-06-07; still referenced Oct 2026): claude.ai web/mobile/desktop show "Authorization with the MCP server failed" against Access Managed OAuth, no Cloudflare login appears, Claude Code works. Hypotheses, none confirmed: 401 lacks `WWW-Authenticate resource_metadata`; Cloudflare `/authorize` returns `invalid_target` unless `resource` exactly equals MCP URL; PRM lists `cloudflared` before `oauth` in `authentication_methods`. Bot Fight/Managed Challenge ruled out (160.79.104.0/21 never challenged). Verdict: do not rely on it. Also requires WARP-free path anyway.

### (b) Access for SaaS (OIDC) as upstream IdP for our own AS
Docs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/ . Endpoints under `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>/{authorization,token,jwks,userinfo,.well-known/openid-configuration}`; scopes openid/email/profile/groups; PKCE optional; client secret; redirect URL configured per app; policies evaluated (email allowlist; could drop WARP requirement). No DCR/CIMD, which is fine since our AS faces claude.ai, not Access. Cost: switchboard implements an OIDC client (code exchange, JWKS verify). Clean separation, works on any host path (no path-scoped bypass needed for the Access endpoints; they are on the team domain).

### (c) workers-oauth-provider
https://github.com/cloudflare/workers-oauth-provider : Workers library implementing OAuth 2.1 AS with DCR, PKCE, RFC 8414/9728 metadata, token storage in KV, delegating login to an upstream. Good if switchboard ran on Workers; ours is a Pi service behind a tunnel, so it would need a Worker front plus proxying to the Pi: extra hop, KV state, a second deploy surface. Not recommended; borrow its endpoint shape.

### (d) Own AS on the Pi; /authorize behind path-scoped Access app
- Precedence [D]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/ : for apps sharing a root path, more specific path rule wins and nothing is inherited; no inheritance from parent. Hostname: most specific hostname wins (`test.example.com` over `*.example.com`) per https://blog.cloudflare.com/access-wildcard-and-multi-hostname . Docs say nothing explicit about a Bypass app overriding an Allow app or about wildcard-host vs exact-host+path combos [?]. Expect: an app with exact host `build.rutang.cloud` (and path destinations) outranks `*.rutang.cloud`. VERIFY after apply with `curl -i` from non-WARP host on /mcp, /.well-known/*, /token, /register, /authorize.
- Safest layout: exact-host apps on `build.rutang.cloud`, never trying to carve exceptions out of the wildcard app:
  1. host app `build.rutang.cloud` with a Bypass policy (everyone) = all paths public; switchboard enforces its own bearer tokens on /mcp.
  2. path app `build.rutang.cloud/authorize` (and `/login/*`) with Allow policy: email allowlist only (no WARP posture, since the human is in an arbitrary browser, possibly phone). Cloudflare pattern: more specific path wins over the host app.
  Alternative narrower: host app Allow-all-paths-blocked default, and a bypass app per public path set (/mcp, /token, /register, /.well-known/*). More resources, deny-by-default.
- Switchboard must validate `Cf-Access-Jwt-Assertion` on /authorize (JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, check `aud` = app AUD tag, `iss`, `email`), not trust the plain header. Bypass paths carry no JWT, so also bind consent to the authenticated email.
- Also serve discovery on host: `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`; Access wildcard 302-to-login on these would break claude.ai discovery (symptom: "Couldn't reach").
- WAF/Bot [D]: https://claude.com/docs/connectors/building/troubleshooting.md : check for 403/429 not from the app; allowlist 160.79.104.0/21 or exempt MCP+OAuth paths. Add a WAF custom rule (skip: remaining custom rules, rate limiting, managed rules, SBFM where plan allows) for `ip.src in {160.79.104.0/21}` and for the OAuth paths; Bot Fight Mode on Free plan cannot be skipped by custom rules [?], though #410 reports Anthropic IPs not challenged. Any managed challenge on /authorize in a phone browser is fine; on /token or /mcp it is fatal. Disable "Browser Integrity Check" on those paths if it bites [?].
- Streaming via Tunnel: Cloudflare proxy read timeout is 100 s without bytes (524) on non-Enterprise [I: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524]. Measured by silence, not duration. cloudflared passes SSE through; no cloudflared-specific buffering evidence found. Mitigate: tool calls capped well under 100 s (claude.ai caps at 240 s anyway), send SSE comment keepalive `: ping` every 15-20 s, disable gzip for `text/event-stream`, prefer stateless JSON responses (no standing GET stream; claude.ai does not open one).

## 4. Recommendation

Architecture: switchboard is its own OAuth 2.1 AS + resource server (CIMD and DCR both advertised), with human login delegated to Cloudflare Access on `/authorize` only. Start with (d) JWT-in-header. If you later want no Access-JWT coupling (e.g. different host for AS), swap to (b) without changing claude.ai-facing surface.

Flow:
1. User adds connector `https://build.rutang.cloud/mcp` in claude.ai (blank Advanced settings).
2. claude.ai backend (160.79.104.0/21) POST /mcp unauthenticated. Switchboard returns 401 + `WWW-Authenticate: Bearer resource_metadata="https://build.rutang.cloud/.well-known/oauth-protected-resource/mcp"` (host app = Bypass, so Access does not interfere).
3. Claude GETs PRM: `{resource:"https://build.rutang.cloud/mcp", authorization_servers:["https://build.rutang.cloud"], scopes_supported:[...,"offline_access"]}`.
4. Claude GETs `/.well-known/oauth-authorization-server`: issuer, authorization_endpoint, token_endpoint, registration_endpoint, `code_challenge_methods_supported:["S256"]`, `client_id_metadata_document_supported:true`, `token_endpoint_auth_methods_supported:["none"]`, grant types authorization_code + refresh_token.
5. Claude identifies (CIMD fetch of Anthropic-hosted doc, or POST /register). Redirect URIs allowed: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, loopback port-agnostic.
6. Claude opens user's browser to `/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&S256&resource=https://build.rutang.cloud/mcp&state=...`.
7. Cloudflare Access (path app) intercepts: login (email allowlist, OTP/IdP), sets `CF_Authorization`, forwards to origin with `Cf-Access-Jwt-Assertion`.
8. Switchboard verifies JWT, checks email in its own allowlist, shows consent (display redirect host), issues one-time code bound to client, PKCE challenge, resource, email; 302 to claude.ai callback.
9. Claude POST /token (form-encoded, <10 s): returns short-lived access token (aud=resource, ~1 h) + rotating refresh token. /mcp now requires `Authorization: Bearer`; refresh returns `invalid_grant` on revoke.

Terraform (cloudflare provider v5):
- `cloudflare_zero_trust_access_policy` x2 (account-level, reusable): `bypass_everyone` (decision "bypass", include everyone); `allow_owner_email` (decision "allow", include email list; no device_posture).
- `cloudflare_zero_trust_access_application` "switchboard_public": type "self_hosted", `destinations=[{type="public", uri="build.rutang.cloud"}]`, policies referencing bypass_everyone.
- `cloudflare_zero_trust_access_application` "switchboard_authorize": type "self_hosted", `destinations=[{type="public", uri="build.rutang.cloud/authorize"}, {... uri="build.rutang.cloud/login/*"}]`, policies referencing allow_owner_email, `session_duration` ~24h, `app_launcher_visible=false`. Capture its `aud` for the server.
- Existing wildcard app untouched. Existing tunnel ingress already routes the hostname (`cloudflare_zero_trust_tunnel_cloudflared_config` + `cloudflare_dns_record` CNAME if build.* not yet present). DNS must be proxied A/AAAA-resolving (orange cloud) so claude.ai gets public IPv4.
- `cloudflare_ruleset` (phase `http_request_firewall_custom`, action "skip") for `ip.src in {160.79.104.0/21} and http.host eq "build.rutang.cloud"`; optional skip for /mcp,/token,/register,/.well-known/*.
- Option (b) additionally: `cloudflare_zero_trust_access_application` type "saas" with `saas_app = {auth_type="oidc", redirect_uris=[...], grant_types=["authorization_code"], scopes=["openid","email"], ...}` + allow policy.

Open verification items: precedence of exact-host app over `*.rutang.cloud` (test), whether WARP posture can be dropped on the allow policy (yes by policy design), voice mode behavior, claude.com callback.
