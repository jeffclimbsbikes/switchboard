from dg import D, P

d = D("1-system", 1820, 1000)

# ---- zones
d.zone(20, 20, 240, 960, "You", "user", "Jeff, anywhere")
d.zone(290, 20, 300, 560, "Anthropic", "claude", "claude.ai, web + app")
d.zone(620, 20, 310, 960, "Cloudflare edge", "cf", "rutang.cloud")
d.zone(960, 20, 840, 960, "pidev", "pi", "Raspberry Pi 5 at home · 8 GB · arm64")

# ---- you
phone = d.box(40, 80, 200, 120, "Voice chat", "user", "“build me a packing list app”", icon="🎙️📱")
mac = d.box(40, 250, 200, 96, "Mac or phone browser", "user", "adds the connector once", icon="💻")
tg = d.box(40, 560, 200, 110, "Telegram", "user", "“done: packing.rutang.cloud”", icon="📨")
use = d.box(40, 760, 200, 110, "Open the result", "user", "on WARP, like every app", icon="✅")

# ---- anthropic
chat = d.box(310, 80, 260, 120, "Claude", "claude", "talks with you · decides what to delegate · relays questions", icon="✨")
conn = d.box(310, 250, 260, 110, "switchboard connector", "claude", "custom connector · MCP over HTTPS · OAuth bearer token", icon="🔌")
d.pill(330, 380, 220, 28, "egress 160.79.104.0/21", "claude")
d.text(310, 425, 265, 150,
       "Claude never touches the Pi directly. Every step is a tool call that returns in ≤ 25 s; "
       "long work is polled with <b>wait</b>.<br><br>❓ When the agent asks something, it comes back as a tool result: Claude answers from what you already said, or asks you out loud.", size=12, color="#7a2e14")

# ---- cloudflare
dns = d.box(640, 80, 270, 64, "DNS", "cf", "build.rutang.cloud → tunnel", icon="", align="center")
waf = d.box(640, 170, 270, 64, "WAF", "cf", "skip rules for Anthropic's range")
acc = d.box(640, 260, 270, 200, "Access", "cf",
            "<div style='text-align:left;font-size:11.5px;line-height:1.7;padding-left:6px'>"
            "<code>build…/mcp</code> · token · register<br>&nbsp;&nbsp;→ <b>bypass</b>, switchboard checks the token<br>"
            "<code>build…/authorize</code><br>&nbsp;&nbsp;→ <b>Jeff only + WARP</b><br>"
            "<code>*.rutang.cloud</code><br>&nbsp;&nbsp;→ allowlist + WARP, as today</div>", icon="🛡️")
tun = d.box(640, 490, 270, 90, "Tunnel “family-default”", "cf", "the Pi dials out · no open ports", icon="🚇")
warp = d.box(640, 760, 270, 110, "WARP", "cf", "your phone + Mac on the rutang VPN", icon="🔒")

# ---- pidev
cfd = d.box(985, 490, 160, 90, "cloudflared", "pi", "host service", icon="☁️")
rc = d.box(985, 820, 160, 120, "Remote Control", "muted", "still there: Claude app → Code tab → pidev", icon="📡", dashed=True)

sbz = d.zone(1170, 70, 610, 330, "switchboard", "sb", "new · this project · systemd user service as jeff · 127.0.0.1:8787")
d.pill(1190, 120, 570, 28, "tools:  agents · start · send · wait · respond · sessions · stop", "sb", size=12)
mcp = d.box(1190, 162, 140, 70, "/mcp", "sb", "Streamable HTTP", mono_sub=True)
oauth = d.box(1190, 246, 140, 70, "OAuth 2.1", "sb", "own AS · PKCE · CIMD/DCR")
sm = d.box(1350, 162, 210, 70, "Session manager", "sb", "states · turns · bounded waits")
log = d.box(1350, 246, 210, 70, "Event log", "sb", "node:sqlite · cursors · resume")
ntf = d.box(1580, 162, 180, 70, "Notifier", "sb", "turn done / needs you")
drv = d.box(1580, 246, 180, 70, "Drivers", "sb", "Claude Agent SDK · ACP")
d.text(1190, 330, 440, 50, "its MCP instructions tell Claude it's talking to a real coding agent, not a form", size=11, color="#4338ca")

agz = d.zone(1170, 420, 610, 210, "coding agents", "agent", "child processes · full sudo (jeff) · bypass permissions")
cc = d.box(1190, 478, 180, 130, "Claude Code", "agent", "Agent SDK · Opus 5.5 · one per session", icon="🤖")
oc = d.box(1390, 478, 180, 130, "OpenCode", "agent", "opencode acp", icon="🧩")
anyac = d.box(1590, 478, 170, 130, "any ACP agent", "agent", "codex-acp · gemini · goose", icon="➕", dashed=True)

wz = d.zone(1170, 650, 610, 310, "what they work on", "work", "edit · test · deploy · share — the rest of pidev, unchanged")
repo = d.box(1190, 706, 180, 96, "~/src/pidev", "work", "git → GitHub", icon="📁")
papp = d.box(1390, 706, 180, 96, "pidev-app", "work", "sandboxed app containers", icon="📦")
rtr = d.box(1590, 706, 170, 96, "Traefik :8090", "work", "&lt;name&gt;.rutang.cloud", icon="🚦")
pod = d.box(1190, 826, 380, 110, "podman (svc + agent users)", "work", "homepage · sticker-printer · Trove · apps", icon="🐳")
trove = d.box(1590, 826, 170, 110, "Trove", "work", "share files + pages", icon="🗃️")

# ---- main flow
d.edge(phone, chat, "", color="#d97757", w=2.5, start="blockThin")
d.edge(chat, conn, "tool calls ⇅ results", color="#d97757", w=2.5, start="blockThin")
d.edge(conn, waf, "HTTPS + bearer", color="#f38020", w=2.5, exit=(1, 0.3), entry=(0, 0.5), start="blockThin")
d.edge(waf, acc, "", color="#f38020", w=2.5, start="blockThin")
d.edge(acc, tun, "", color="#f38020", w=2.5, start="blockThin")
d.edge(tun, cfd, "", color="#10b981", w=2.5, start="blockThin")
d.edge(cfd, mcp, "", color="#6366f1", w=2.5, exit=(0.5, 0), entry=(0, 0.5), pts=[(1065, 197)])
d.edge(drv, agz, "spawn · stream · resume", color="#8b5cf6", w=2.5, exit=(0.5, 1), entry=(0.82, 0))
d.edge(agz, wz, "", color="#0ea5e9", w=2.5, exit=(0.55, 1), entry=(0.55, 0))

# questions come back on the same path
d.text(310, 590, 270, 0, "", size=1)
# notify
d.edge(ntf, tg, "done / needs you", color="#ea580c", w=1.8, dashed=True, exit=(1, 0.5), entry=(0, 0.5),
       pts=[(1812, 197), (1812, 992), (30, 992), (30, 615)])

# one-time oauth
d.edge(mac, acc, "OAuth once: /authorize", color="#ea580c", w=1.6, dashed=True, exit=(1, 0.5), entry=(0, 0.9),
       pts=[(272, 298), (272, 605), (605, 605), (605, 440)])

# use the result
d.edge(use, warp, "", color="#16a34a", w=2, dashed=True)
d.edge(warp, tun, "packing.rutang.cloud", color="#16a34a", w=2, dashed=True, exit=(0.5, 0), entry=(0.5, 1))
d.edge(cfd, rtr, "", color="#16a34a", w=2, dashed=True, exit=(0.5, 1), entry=(0.9, 0), pts=[(1065, 640), (1743, 640)])

# badges
for x, y, n, c in [(18, 70, 1, "#ea580c"), (288, 70, 2, "#d97757"), (618, 160, 3, "#f38020"),
                   (983, 480, 4, "#10b981"), (1168, 150, 5, "#6366f1"), (1168, 468, 6, "#8b5cf6"),
                   (1168, 696, 7, "#0ea5e9"), (18, 550, 8, "#ea580c"), (18, 750, 9, "#16a34a")]:
    d.badge(x, y, n, c)

d.save()
