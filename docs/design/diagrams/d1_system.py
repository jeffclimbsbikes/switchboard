from dg import D, P

d = D("1-system", 1820, 1000)

# ---- zones
d.zone(20, 20, 240, 960, "You (phone / laptop)", "user", "anywhere")
d.zone(290, 20, 300, 560, "Claude", "claude", "claude.ai · desktop · Claude Code")
d.zone(620, 20, 310, 960, "Cloudflare", "cf", "DNS · Access · Tunnel (optional)")
d.zone(960, 20, 840, 960, "Your server", "pi", "any Linux or macOS machine you control")

# ---- you
phone = d.box(40, 80, 200, 120, "Voice or text chat", "user", "“build me a packing list app”", icon="🎙️📱")
mac = d.box(40, 250, 200, 110, "Browser", "user", "adds the connector once · opens /dashboard", icon="💻")
tg = d.box(40, 560, 200, 110, "Notifications", "user", "“done: packing.example.com”", icon="📨")
d.text(40, 730, 200, 150,
       "<b>Local only?</b> <code>switchboard stdio</code> plugs straight into Claude Code or Claude Desktop: no network, no auth, no Cloudflare.",
       size=12, color="#7c2d12")

# ---- claude
chat = d.box(310, 80, 260, 120, "Claude", "claude", "talks with you · decides what to delegate · relays questions", icon="✨")
conn = d.box(310, 250, 260, 110, "switchboard connector", "claude", "custom connector · MCP over HTTPS · OAuth bearer token", icon="🔌")
d.pill(330, 380, 220, 28, "egress 160.79.104.0/21", "claude")
d.text(310, 425, 265, 150,
       "Claude never touches your server directly. Every step is a tool call that returns in ≤ 25 s; "
       "long work is polled with <b>wait</b>.<br><br>❓ When the agent asks something, it comes back as a tool result: Claude answers from what you already said, or asks you out loud.", size=12, color="#7a2e14")

# ---- cloudflare
dns = d.box(640, 80, 270, 64, "DNS", "cf", "switchboard.example.com → tunnel", icon="", align="center")
waf = d.box(640, 170, 270, 64, "WAF", "cf", "skip rules for Anthropic's range")
acc = d.box(640, 260, 270, 200, "Access", "cf",
            "<div style='text-align:left;font-size:11.5px;line-height:1.7;padding-left:6px'>"
            "<code>/mcp</code> · token · register<br>&nbsp;&nbsp;→ <b>bypass</b>, switchboard checks the token<br>"
            "<code>/authorize</code> · <code>/dashboard</code><br>&nbsp;&nbsp;→ <b>you and allowed guests</b></div>", icon="🛡️")
tun = d.box(640, 490, 270, 90, "Tunnel", "cf", "your server dials out · no open ports", icon="🚇")
d.text(640, 620, 270, 120,
       "Optional: any HTTPS reverse proxy works. switchboard only needs a public URL and a way to sign the owner in.",
       size=12, color="#7a3d00")

# ---- your server
cfd = d.box(985, 490, 160, 90, "cloudflared", "pi", "host service", icon="☁️")
cfg = d.box(985, 820, 160, 120, "config.toml", "muted", "agents · workspaces · users · auth · usage · notify", icon="⚙️", dashed=True)

sbz = d.zone(1170, 70, 610, 380, "switchboard", "sb", "one process · 127.0.0.1:8787 · its MCP instructions tell Claude it is pairing with a real coding agent")
d.pill(1190, 120, 570, 28, "tools:  agents · start · send · wait · respond · sessions · stop", "sb", size=12)
mcp = d.box(1190, 162, 183, 70, "/mcp", "sb", "Streamable HTTP", mono_sub=True)
oauth = d.box(1383, 162, 183, 70, "OAuth 2.1", "sb", "own AS · PKCE · CIMD/DCR")
dash = d.box(1576, 162, 184, 70, "/dashboard", "sb", "read-only · mobile-friendly")
sm = d.box(1190, 246, 183, 70, "Session manager", "sb", "states · turns · bounded waits")
log = d.box(1383, 246, 183, 70, "Event log", "sb", "node:sqlite · cursors · resume")
pol = d.box(1576, 246, 184, 70, "Per-user access", "sb", "users · agents · workspaces")
use = d.box(1190, 330, 183, 70, "Models & usage", "sb", "catalogs · cost · plan windows")
drv = d.box(1383, 330, 183, 70, "Drivers", "sb", "Claude Agent SDK · ACP")
ntf = d.box(1576, 330, 184, 70, "Notifier", "sb", "turn done / needs you")

agz = d.zone(1170, 470, 610, 200, "coding agents", "agent", "child processes · optionally run_as another Unix user")
cc = d.box(1190, 520, 180, 130, "Claude Code", "agent", "Agent SDK · one per session", icon="🤖")
oc = d.box(1390, 520, 180, 130, "OpenCode", "agent", "opencode acp", icon="🧩")
anyac = d.box(1590, 520, 170, 130, "any ACP agent", "agent", "codex-acp · gemini · goose", icon="➕", dashed=True)

wz = d.zone(1170, 690, 610, 270, "what they work on", "work", "edit · test · deploy · share — whatever you point them at")
repo = d.box(1190, 740, 180, 96, "Your repositories", "work", "git → GitHub / GitLab", icon="📁")
tools = d.box(1390, 740, 180, 96, "Shell & toolchain", "work", "build · test · run", icon="🛠️")
svcs = d.box(1590, 740, 170, 96, "Your services", "work", "containers · deploys", icon="📦")
guest = d.box(1190, 852, 380, 94, "Guest workspaces (run_as)", "work", "another Unix user's files, credentials and permissions", icon="👥")
data = d.box(1590, 852, 170, 94, "Docs & data", "work", "anything the agent user can read", icon="🗃️")

# ---- main flow
d.edge(phone, chat, "", color="#d97757", w=2.5, start="blockThin")
d.edge(chat, conn, "tool calls ⇅ results", color="#d97757", w=2.5, start="blockThin")
d.edge(conn, waf, "HTTPS + bearer", color="#f38020", w=2.5, exit=(1, 0.3), entry=(0, 0.5), start="blockThin")
d.edge(waf, acc, "", color="#f38020", w=2.5, start="blockThin")
d.edge(acc, tun, "", color="#f38020", w=2.5, start="blockThin")
d.edge(tun, cfd, "", color="#10b981", w=2.5, start="blockThin")
d.edge(cfd, mcp, "", color="#6366f1", w=2.5, exit=(0.5, 0), entry=(0, 0.5), pts=[(1065, 197)])
d.edge(drv, agz, "spawn · stream · resume", color="#8b5cf6", w=2.5, exit=(0.5, 1), entry=(0.5, 0))
d.edge(agz, wz, "", color="#0ea5e9", w=2.5, exit=(0.55, 1), entry=(0.55, 0))

# notify
d.edge(ntf, tg, "done / needs you", color="#ea580c", w=1.8, dashed=True, exit=(1, 0.5), entry=(0, 0.5),
       pts=[(1812, 365), (1812, 992), (30, 992), (30, 615)])

# one-time oauth + dashboard
d.edge(mac, acc, "OAuth once · /dashboard", color="#ea580c", w=1.6, dashed=True, exit=(1, 0.5), entry=(0, 0.9),
       pts=[(272, 305), (272, 605), (605, 605), (605, 440)])

# badges
for x, y, n, c in [(18, 70, 1, "#ea580c"), (288, 70, 2, "#d97757"), (618, 160, 3, "#f38020"),
                   (983, 480, 4, "#10b981"), (1168, 150, 5, "#6366f1"), (1168, 518, 6, "#8b5cf6"),
                   (1168, 738, 7, "#0ea5e9"), (18, 550, 8, "#ea580c")]:
    d.badge(x, y, n, c)

d.save()
