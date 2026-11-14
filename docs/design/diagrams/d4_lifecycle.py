from dg import D

d = D("4-lifecycle", 1520, 900)


def state(x, y, name, sub, icon, fill, stroke, w=210, h=96):
    st = (f"rounded=1;arcSize=40;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth=2.5;"
          "fontFamily=Inter,Helvetica,Arial;shadow=1;")
    lab = (f"<div style='line-height:1.3'><span style='font-size:20px'>{icon}</span><br><b style='font-size:15px'>{name}</b>"
           f"<br><span style='font-size:11px;color:#475569'>{sub}</span></div>")
    return d.shape(x, y, w, h, st, lab)


start = d.shape(40, 222, 28, 28, "ellipse;html=1;fillColor=#0f172a;strokeColor=none;")
starting = state(110, 190, "starting", "spawning the agent", "🚀", "#f8fafc", "#64748b", w=170)
working = state(370, 190, "working", "a turn is running", "⚙️", "#eef2ff", "#4f46e5")
waiting = state(370, 450, "waiting", "question or approval · holds forever", "🙋", "#fffbeb", "#d97706")
idle = state(770, 190, "idle", "turn done · process warm", "💤", "#ecfdf5", "#10b981")
parked = state(1090, 190, "parked", "process gone · context on disk", "🅿️", "#f0f9ff", "#0ea5e9")
failed = state(770, 450, "failed", "agent crashed or errored", "💥", "#fef2f2", "#ef4444")
closed = state(1320, 450, "closed", "archived", "📦", "#f1f5f9", "#475569", w=170)
end = d.shape(1391, 600, 28, 28, "ellipse;html=1;fillColor=#ffffff;strokeColor=#0f172a;strokeWidth=6;")

E = dict(w=2.2, size=12)
d.edge(start, starting, "start()", color="#0f172a", **E)
d.edge(starting, working, "", color="#4f46e5", **E)
d.edge(working, waiting, "agent asks", color="#d97706", exit=(0.3, 1), entry=(0.3, 0), **E)
d.edge(waiting, working, "respond()", color="#d97706", exit=(0.7, 0), entry=(0.7, 1), **E)
d.edge(working, idle, "turn ends · stop(interrupt)", color="#10b981", exit=(1, 0.65), entry=(0, 0.65), **E)
d.edge(idle, working, "send()", color="#4f46e5", exit=(0.3, 0), entry=(0.7, 0), pts=[(833, 140), (517, 140)], **E)
d.edge(idle, parked, "idle 30 min → process exits", color="#0ea5e9", exit=(1, 0.65), entry=(0, 0.65), **E)
d.edge(parked, working, "send() → resume, same context", color="#4f46e5", exit=(0.5, 0), entry=(0.5, 0),
       pts=[(1195, 90), (475, 90)], **E)
d.edge(working, failed, "crash", color="#ef4444", exit=(1, 0.9), entry=(0, 0.3), **E)
d.edge(failed, parked, "kept · resumable", color="#ef4444", exit=(1, 0.3), entry=(0.3, 1), pts=[(1153, 479)], **E)
d.edge(parked, closed, "stop(close) · from any state", color="#475569", exit=(0.8, 1), entry=(0.5, 0), pts=[(1258, 400), (1405, 400)], **E)
d.edge(closed, end, "", color="#475569", **E)

d.text(110, 330, 230, 80, "Questions never time out silently: if nobody answers for 10 min, the notifier pings you.",
       size=11, color="#92400e")

# ---- bounded-wait timeline
d.zone(20, 660, 1480, 220, "every call returns in ≤ 25 s", "muted", "Claude keeps the conversation going; the agent keeps working in between")
y = 760
d.line(60, y + 70, 1460, y + 70, color="#94a3b8", w=1.5, dashed=False, end="blockThin")
for i, t in enumerate(range(0, 141, 20)):
    x = 60 + t * 9.5
    d.line(x, y + 64, x, y + 76, color="#94a3b8", w=1.5, dashed=False)
    d.text(x - 20, y + 78, 40, 16, f"{t}s", size=10, color="#64748b", align="center")


def call(t0, t1, name, ret, color, fill):
    x0, x1 = 60 + t0 * 9.5, 60 + t1 * 9.5
    d.shape(x0, y, x1 - x0, 50, f"rounded=1;arcSize=20;html=1;whiteSpace=wrap;fillColor={fill};strokeColor={color};strokeWidth=1.5;fontFamily=Inter,Helvetica;fontSize=11;",
            f"<b style='font-family:JetBrains Mono,Menlo,monospace'>{name}</b><br><span style='color:#475569'>{ret}</span>")


call(0, 25, "start", "working", "#4f46e5", "#eef2ff")
call(26, 37, "wait", "waiting · q1", "#d97706", "#fffbeb")
call(45, 53, "respond", "ok", "#d97706", "#fffbeb")
call(55, 80, "wait", "working", "#4f46e5", "#eef2ff")
call(81, 106, "wait", "working", "#4f46e5", "#eef2ff")
call(107, 118, "wait", "idle · reply", "#10b981", "#ecfdf5")
d.text(26 * 9.5 + 60, y - 30, 250, 24, "↓ you answer out loud, then respond", size=11, color="#92400e")

d.save()
