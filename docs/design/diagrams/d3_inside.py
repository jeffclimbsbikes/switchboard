from dg import D

d = D("3-inside", 1640, 1180)

R, B = "reuse", "build"
GREEN, INDIGO = "#f0fdf4", "#eef2ff"
TURN, ASK, NOTE = "#4f46e5", "#d97706", "#ea580c"

# legend
d.box(1000, 20, 150, 36, "reused library", R, fill=GREEN, size=12, shadow=False)
d.box(1160, 20, 120, 36, "we build", B, fill=INDIGO, size=12, shadow=False)
d.line(1300, 38, 1360, 38, color=TURN, w=2.5, dashed=False, end="blockThin")
d.text(1365, 28, 90, 20, "a turn", size=12, color=TURN, bold=True)
d.line(1440, 38, 1500, 38, color=ASK, w=2.5, dashed=False, end="blockThin")
d.text(1505, 28, 120, 20, "a question", size=12, color=ASK, bold=True)

# clients
c1 = d.box(20, 20, 250, 64, "claude.ai connector", "claude", "web · desktop · mobile · voice")
c2 = d.box(290, 20, 250, 64, "Claude Code / Desktop", "claude", "stdio or HTTP")
c3 = d.box(560, 20, 250, 64, "MCP Inspector · tests", "muted", "in-memory transport in CI")

# edge layer
d.zone(20, 110, 1600, 170, "edge", "muted", "one node:http server · 127.0.0.1:8787 behind cloudflared")
e1 = d.box(40, 160, 230, 96, "Streamable HTTP + stdio", R, "@modelcontextprotocol/sdk", fill=GREEN, mono_sub=True, icon="🔌")
e2 = d.box(290, 160, 230, 96, "Bearer check on /mcp", R, "sdk requireBearerAuth · aud = resource", fill=GREEN, icon="🎫")
e3 = d.box(540, 160, 300, 96, "OAuth 2.1 endpoints", R, "sdk mcpAuthRouter · PKCE S256 · CIMD + DCR", fill=GREEN, icon="🔐")
e4 = d.box(860, 160, 250, 96, "Token store", B, "provider impl · hashed · rotating refresh", fill=INDIGO, icon="🗝️")
e5 = d.box(1130, 160, 230, 96, "Who's allowed in", B, "Access JWT checked with jose · email allowlist", fill=INDIGO, icon="🛂")
e6 = d.box(1380, 160, 220, 96, "Consent page", B, "“let Claude use pidev?”", fill=INDIGO, icon="✋")

# tools
d.zone(20, 310, 1600, 170, "tools", "sb", "voice-friendly · every call returns in ≤ max_wait (25 s)")
tools = [("agents", "what can run, where", "🧭"), ("start", "new session + first turn", "▶️"),
         ("send", "next turn · auto-resume", "💬"), ("wait", "long-poll from a cursor", "⏳"),
         ("respond", "answer question / approval", "🙋"), ("sessions", "one line per session", "📋"),
         ("stop", "interrupt · close", "⏹️")]
T = {}
for i, (t, s, ic) in enumerate(tools):
    T[t] = d.box(40 + i * 225, 360, 210, 96, t, B, s, fill=INDIGO, size=14, icon=ic)

# core
d.zone(20, 510, 1600, 220, "core", "sb", "the part that makes it a control plane")
k1 = d.box(40, 560, 300, 140, "Session manager", B, "registry · one turn at a time · queues follow-ups · parks idle sessions · spawn ceiling", fill=INDIGO, icon="🗂️")
k2 = d.box(360, 560, 280, 140, "Request broker", B, "pending questions + approvals by id · policy auto / ask / rules", fill=INDIGO, icon="🚦")
k3 = d.box(660, 560, 280, 140, "Waiters", B, "long-poll on a cursor · return early on question or turn end", fill=INDIGO, icon="⏱️")
k4 = d.box(960, 560, 300, 140, "Event log", R, "node:sqlite (in Node 22+) · sessions · events · tokens · survives restarts", fill=GREEN, icon="🧾")
k5 = d.box(1280, 560, 320, 140, "Notifier", B, "turn end / needs-you with nobody waiting → Telegram · ntfy · any command", fill=INDIGO, icon="📣")

# driver interface
d.zone(20, 760, 1600, 120, "driver interface", "sb", "")
di = d.box(40, 800, 1560, 60,
           "<span style='font-family:JetBrains Mono,Menlo,monospace;font-size:13px'>start(cwd, opts) · prompt(text) · respond(id, answer) · interrupt() · resume(agentSessionId) · close()"
           " &nbsp;→&nbsp; events: text · tool · plan · request · turn_end · error</span>", B, fill=INDIGO, bold=False, shadow=False)

# drivers
d.zone(20, 910, 1600, 250, "drivers", "agent", "one class each · adding another ACP agent is a config line")
dr1 = d.box(40, 960, 500, 130, "ClaudeDriver", R,
            "@anthropic-ai/claude-agent-sdk · streaming query() · canUseTool (approvals + AskUserQuestion) · resume · interrupt",
            fill=GREEN, icon="🤖")
dr2 = d.box(560, 960, 500, 130, "AcpDriver", R,
            "@agentclientprotocol/sdk · session/new · prompt · request_permission + elicitation · resume/load · cancel",
            fill=GREEN, icon="🧩")
dr3 = d.box(1080, 960, 250, 130, "FakeDriver", B, "scripted: reply · ask · approve · slow · crash", fill=INDIGO, icon="🧪")
pr = d.box(1350, 960, 250, 130, "processes", "muted",
           "<span style='font-family:JetBrains Mono,Menlo,monospace;font-size:11px'>claude (path from config)<br>opencode acp<br>claude-agent-acp<br>codex-acp · gemini</span>",
           fill="#f8fafc", shadow=False, icon="⚙️")
d.text(40, 1110, 1000, 50, "Claude is driven through its own SDK (the most direct way to answer questions and approvals); "
       "every other agent through ACP. Both turn into the same events.", size=12, color="#4c1d95")

# client edge
d.edge(c2, e1, "", color="#94a3b8", w=1.5, exit=(0.5, 1), entry=(0.5, 0), pts=[(415, 100), (155, 100)])

# --- a turn
d.edge(e2, T["start"], "", color=TURN, w=2.5, exit=(0.5, 1), entry=(0.5, 0))
d.edge(T["start"], k1, "", color=TURN, w=2.5, exit=(0.5, 1), entry=(0.75, 0))
d.edge(k1, dr1, "", color=TURN, w=2.5, exit=(0.5, 1), entry=(0.38, 0))
d.edge(dr1, k4, "events", color=TURN, w=2, dashed=True, exit=(0.9, 0), entry=(0.3, 1), pts=[(490, 920), (1050, 920)])
d.edge(k4, k3, "", color=TURN, w=2, dashed=True, exit=(0, 0.3), entry=(1, 0.3))
d.edge(k3, T["wait"], "", color=TURN, w=2, dashed=True, exit=(0.55, 0), entry=(0.5, 1))
d.edge(k4, k5, "", color=NOTE, w=2, dashed=True, exit=(1, 0.5), entry=(0, 0.5))

# --- a question
d.edge(dr1, k2, "canUseTool → pending", color=ASK, w=2.5, exit=(0.7, 0), entry=(0.5, 1), pts=[(390, 900), (500, 900)])
d.edge(k2, k3, "", color=ASK, w=2.5, exit=(1, 0.75), entry=(0, 0.75))
d.edge(T["respond"], k2, "", color=ASK, w=2.5, exit=(0.5, 1), entry=(0.8, 0), pts=[(1045, 495), (584, 495)])

for x, y, n, c in [(276, 296, 1, TURN), (110, 750, 2, TURN), (1060, 905, 3, TURN), (800, 495, 4, TURN),
                   (430, 887, "?", ASK), (1050, 470, "!", ASK)]:
    d.badge(x, y, n, c)

d.save()
