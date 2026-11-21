from dg import D

d = D("7-testing", 1640, 900)

# left: real -> fake mapping
d.zone(20, 20, 860, 860, "every real dependency has a stand-in", "muted", "so CI needs no API keys, no Cloudflare, no claude.ai")
rows = [
    ("Claude Code CLI", "🤖", "agent", "fake-claude", "a 150-line script speaking the same stream-json control protocol; "
     "the SDK runs it via pathToClaudeCodeExecutable. Replays recorded turns, asks questions, crashes on cue."),
    ("OpenCode / any ACP agent", "🧩", "agent", "fake-acp-agent", "built with the ACP SDK's agent side: replies, request_permission, "
     "elicitation, slow turns, session/resume"),
    ("claude.ai connector", "✨", "claude", "MCP SDK client", "the official TypeScript client, in-memory and over real Streamable HTTP"),
    ("Cloudflare Access", "🛡️", "cf", "test JWKS signer", "keypair made per run; mints Cf-Access-Jwt-Assertion with right and wrong aud / email / expiry"),
    ("Telegram", "📨", "user", "capture server", "local HTTP endpoint that records notifications"),
    ("the clock", "⏱️", "muted", "fake timers", "25 s waits, 30 min parking, 10 min nag run in milliseconds"),
]
for i, (real, icon, kind, fake, how) in enumerate(rows):
    y = 90 + i * 130
    a = d.box(40, y, 240, 100, real, kind, "", icon=icon)
    b = d.box(380, y, 480, 100, fake, "reuse" if i in (2,) else "build", how, fill="#ffffff", align="left", size=13)
    d.edge(a, b, "stands in", color="#94a3b8", w=1.8, dashed=True, size=10)

# right: what CI runs
d.zone(910, 20, 710, 620, "what CI runs on every push", "sb", "GitHub Actions · Node 22 + 24 · ~2 min")
layers = [
    ("unit", "state machine · broker policy · cursors · config · token store", "#eef2ff", 630),
    ("driver contract", "one suite, run against FakeDriver, ClaudeDriver+fake-claude, AcpDriver+fake-acp-agent", "#e0e7ff", 560),
    ("MCP end to end", "start → wait → question → respond → idle → send (resume) → stop, in-memory and HTTP", "#c7d2fe", 490),
    ("OAuth end to end", "401 → metadata → CIMD + DCR → /authorize (fake Access JWT) → PKCE → token → refresh → revoke; every bad case", "#a5b4fc", 420),
    ("conformance", "MCP Inspector CLI lists tools; metadata checked against RFC 8414 / 9728", "#818cf8", 350),
]
for i, (name, s, col, w) in enumerate(layers):
    x = 935 + (660 - w) // 2
    y = 80 + (len(layers) - 1 - i) * 108
    d.shape(x, y, w, 92, f"rounded=1;arcSize=12;html=1;whiteSpace=wrap;fillColor={col};strokeColor=#4f46e5;strokeWidth=1.5;"
            "fontFamily=Inter,Helvetica;shadow=1;",
            f"<b style='font-size:14px;color:#1e1b4b'>{name}</b><br><span style='font-size:11px;color:#312e81'>{s}</span>")

# manual
d.zone(910, 660, 710, 220, "on demand, not in CI", "muted", "needs real logins; run by hand on a real server")
d.box(935, 720, 320, 130, "live smoke", "agent", "real Claude Code (haiku) + real opencode: start, question, resume. Also refreshes the recorded fixtures fake-claude replays.", icon="🔥")
d.box(1275, 720, 320, 130, "connector check", "claude", "add switchboard.example.com/mcp in claude.ai, run one task by text and one by voice", icon="📱")

d.save()
