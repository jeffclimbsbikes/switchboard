from dg import D

d = D("5-oauth", 1560, 1180)

X = {"you": 140, "claude": 520, "cf": 900, "sb": 1300}
heads = [("you", "Your browser", "Mac or phone", "🧑‍💻", "user"),
         ("claude", "claude.ai", "backend, 160.79.104.0/21", "✨", "claude"),
         ("cf", "Cloudflare", "Access + tunnel", "🛡️", "cf"),
         ("sb", "switchboard", "OAuth server + /mcp", "🎛️", "sb")]

bands = [(110, 200, "add it", "#fff7ed"), (200, 520, "discover", "#fdf2ec"),
         (520, 860, "sign in (Access)", "#fff4e5"), (860, 1150, "tokens", "#eef2ff")]
for y0, y1, name, col in bands:
    d.shape(20, y0, 1520, y1 - y0, f"rounded=0;html=1;fillColor={col};strokeColor=none;")
    d.text(28, y0 + 6, 200, 20, name.upper(), size=10, color="#64748b", bold=True)

for k, t, sub, icon, kind in heads:
    d.box(X[k] - 110, 16, 220, 84, t, kind, sub, icon=icon)
    d.line(X[k], 100, X[k], 1150, color="#cbd5e1", w=1.5, dashed=True)

# Cloudflare state pills on its lifeline
d.pill(X["cf"] - 70, 434, 140, 26, "bypass", "cf", size=12)
d.pill(X["cf"] - 95, 620, 190, 44, "Access: you only<br><span style='font-weight:normal'>your allowed emails sign in here</span>", "cf", size=11)
d.pill(X["cf"] - 70, 1000, 140, 28, "bypass", "cf", size=12)


def msg(a, b, y, label, color, dashed=False, mono=True):
    lab = f'<span style="font-family:JetBrains Mono,Menlo,monospace">{label}</span>' if mono else label
    d.line(X[a], y, X[b], y, color=color, w=2, dashed=dashed, end="blockThin", label=lab, size=11.5)


def self_note(k, y, s, color, w=300):
    d.box(X[k] - w // 2, y, w, 50, s, "sb", fill="#ffffff", bold=False, size=11, shadow=False)


C, S, U = "#d97757", "#4f46e5", "#ea580c"
msg("you", "claude", 150, "Settings → Connectors → add https://switchboard.example.com/mcp", U, mono=False)

msg("claude", "sb", 240, "POST /mcp   (no token)", C)
msg("sb", "claude", 275, "401  WWW-Authenticate: Bearer resource_metadata=…", S, dashed=True)
msg("claude", "sb", 315, "GET /.well-known/oauth-protected-resource/mcp", C)
msg("sb", "claude", 350, "{ resource, authorization_servers: [switchboard.example.com] }", S, dashed=True)
msg("claude", "sb", 390, "GET /.well-known/oauth-authorization-server", C)
msg("sb", "claude", 425, "S256 · CIMD supported · token auth “none” · endpoints", S, dashed=True)
msg("claude", "sb", 470, "client_id = Anthropic's metadata URL (CIMD) — or POST /register", C)

msg("claude", "you", 565, "open /authorize?…&code_challenge=…", C, dashed=True)
msg("you", "cf", 605, "GET switchboard.example.com/authorize", U)
msg("cf", "sb", 690, "forward + Cf-Access-Jwt-Assertion", "#f38020")
self_note("sb", 710, "verify JWT (jose, Access JWKS, aud) · email ∈ allowlist", S, 320)
msg("sb", "you", 780, "consent: “Let Claude use switchboard on your server?”  [Allow]", S, dashed=True, mono=False)
msg("you", "sb", 815, "Allow", U, mono=False)
msg("sb", "you", 845, "302 → claude.ai/api/mcp/auth_callback?code=…", S, dashed=True)

msg("you", "claude", 895, "callback with code", U, mono=False)
msg("claude", "sb", 940, "POST /token  code + code_verifier + resource", C)
msg("sb", "claude", 975, "access token (1 h, aud=/mcp) + rotating refresh token", S, dashed=True)
msg("claude", "sb", 1045, "POST /mcp   Authorization: Bearer …   tools/list ✓", C)
d.text(X["claude"] - 200, 1080, 520, 60,
       "From here on: every call carries the bearer; Claude refreshes 5 min before expiry. "
       "Revoke from switchboard any time → refresh fails → reconnect.", size=11.5, color="#334155")

d.save()
