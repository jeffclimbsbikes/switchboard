from dg import D, P

d = D("2-conversation", 1560, 1240)

X = {"you": 130, "claude": 450, "sb": 820, "cc": 1180, "tg": 1440}
heads = [
    ("you", "You", "voice, on the phone", "🎙️", "user"),
    ("claude", "Claude", "claude.ai voice chat", "✨", "claude"),
    ("sb", "switchboard", "on the Pi", "🎛️", "sb"),
    ("cc", "Claude Code", "session “otter”", "🤖", "agent"),
    ("tg", "Telegram", "", "📨", "user"),
]

# phase bands
bands = [
    (120, 300, "start", "#fff7ed"),
    (300, 560, "a question", "#f5f3ff"),
    (560, 760, "building", "#f0f9ff"),
    (760, 930, "done", "#ecfdf5"),
    (930, 1200, "later: follow-up", "#fdf2ec"),
]
for y0, y1, name, col in bands:
    d.shape(20, y0, 1520, y1 - y0, f"rounded=0;html=1;fillColor={col};strokeColor=none;")
    d.text(28, y0 + 6, 160, 20, name.upper(), size=10, color="#64748b", bold=True)

for k, t, sub, icon, kind in heads:
    d.box(X[k] - 100, 20, 200, 84, t, kind, sub, icon=icon)
    d.line(X[k], 104, X[k], 1200, color="#cbd5e1", w=1.5, dashed=True)

# activation bar for Claude Code
d.shape(X["cc"] - 8, 210, 16, 120, "rounded=0;html=1;fillColor=#8b5cf6;strokeColor=none;opacity=70;")
d.shape(X["cc"] - 8, 470, 16, 330, "rounded=0;html=1;fillColor=#8b5cf6;strokeColor=none;opacity=70;")
d.shape(X["cc"] - 8, 1090, 16, 90, "rounded=0;html=1;fillColor=#8b5cf6;strokeColor=none;opacity=70;")
# waiting bar
d.shape(X["cc"] - 8, 330, 16, 140, "rounded=0;html=1;fillColor=#fbbf24;strokeColor=none;opacity=80;")
d.text(X["cc"] + 14, 380, 140, 40, "<i>waiting on you<br>(not timing out)</i>", size=11, color="#92400e")


def msg(a, b, y, label, color="#334155", dashed=False, mono=False):
    x1, x2 = X[a], X[b]
    lab = f'<span style="font-family:JetBrains Mono,Menlo,monospace">{label}</span>' if mono else label
    d.line(x1, y, x2, y, color=color, w=2, dashed=dashed, end="blockThin", label=lab, size=12)


def note(k, y, s, w=260, color="#334155"):
    d.text(X[k] - w // 2, y, w, 40, s, size=11, color=color, align="center")


msg("you", "claude", 150, "“Build us a packing list app for the trip”", "#ea580c")
msg("claude", "sb", 195, "start(agent: claude, workspace: pidev, prompt: …)", "#6366f1", mono=True)
msg("sb", "cc", 215, "new session · Opus 5.5", "#8b5cf6")
msg("sb", "claude", 255, "otter · working · “reading the pidev-apps guide”", "#6366f1", dashed=True, mono=True)
msg("claude", "you", 285, "“On it. It's planning; I'll check in.”", "#d97757", dashed=True)

msg("cc", "sb", 335, "AskUserQuestion: shared with Diana, or just you?", "#7c3aed")
msg("claude", "sb", 380, "wait(otter)", "#6366f1", mono=True)
msg("sb", "claude", 410, "waiting · question q1 · options [just Jeff, both]", "#6366f1", dashed=True, mono=True)
msg("claude", "you", 440, "“Quick one from the Pi: just you, or Diana too?”", "#d97757", dashed=True)
msg("you", "claude", 480, "“Both of us”", "#ea580c")
msg("claude", "sb", 510, "respond(otter, q1, “both”)", "#6366f1", mono=True)
msg("sb", "cc", 530, "answer → agent continues", "#8b5cf6")

d.text(X["cc"] - 330, 585, 300, 40, "pidev-app new packing → build → up<br>tests it through the router", size=11, color="#0c4a6e", align="right")
msg("claude", "sb", 640, "wait(otter)  · returns every ≤ 25 s", "#6366f1", mono=True)
msg("sb", "claude", 670, "working · “deploying, 2 of 3 checks pass”", "#6366f1", dashed=True, mono=True)
note("claude", 700, "or you hang up — nothing is lost", 260, "#7a2e14")

msg("cc", "sb", 800, "turn ended · “Live at packing.rutang.cloud”", "#7c3aed")
msg("sb", "tg", 840, "✅ otter: packing.rutang.cloud", "#ea580c")
d.line(X["tg"], 870, X["you"], 870, color="#ea580c", w=2, dashed=True, end="blockThin",
       label="push on your phone (if nobody was waiting)", size=12)

msg("you", "claude", 980, "“Add a luggage-weight column”", "#ea580c")
msg("claude", "sb", 1020, "sessions() → otter · idle", "#6366f1", mono=True)
msg("claude", "sb", 1060, "send(otter, “add a luggage-weight column”)", "#6366f1", mono=True)
msg("sb", "cc", 1090, "resume same session (context kept)", "#8b5cf6")
msg("sb", "claude", 1130, "working …", "#6366f1", dashed=True, mono=True)

d.save()
