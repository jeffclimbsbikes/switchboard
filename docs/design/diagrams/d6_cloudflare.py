from dg import D

d = D("6-cloudflare", 1640, 980)


def diamond(x, y, w, h, s):
    st = ("rhombus;whiteSpace=wrap;html=1;fillColor=#fff4e5;strokeColor=#f38020;strokeWidth=2;"
          "fontFamily=Inter,Helvetica;fontSize=12;fontColor=#7a3d00;fontStyle=1;shadow=1;")
    return d.shape(x, y, w, h, st, s)


# requests
d.text(20, 20, 300, 20, "WHO KNOCKS", size=11, color="#64748b", bold=True)
r1 = d.box(20, 60, 270, 80, "claude.ai backend", "claude", "POST build.rutang.cloud/mcp", icon="✨", mono_sub=True)
r2 = d.box(20, 200, 270, 80, "your browser (once)", "user", "GET build.rutang.cloud/authorize", icon="🧑‍💻", mono_sub=True)
r3 = d.box(20, 340, 270, 80, "your phone on WARP", "user", "GET packing.rutang.cloud", icon="📱", mono_sub=True)

# edge
d.zone(330, 20, 760, 560, "Cloudflare edge", "cf", "evaluated top to bottom; most specific Access app wins")
waf = d.box(360, 80, 220, 70, "WAF custom rule", "cf", "skip for 160.79.104.0/21 on build.*")
q1 = diamond(380, 190, 180, 110, "host is<br>build.rutang.cloud?")
q2 = diamond(640, 190, 180, 110, "path is<br>/authorize?")
a1 = d.box(870, 160, 200, 90, "Access: Jeff + WARP", "cf", "WARP session = no login page · JWT added", icon="🔐")
a2 = d.box(870, 290, 200, 90, "Access: bypass", "cf", "/mcp /token /register /.well-known/*", icon="🚪")
a3 = d.box(380, 380, 200, 100, "Access: allowlist + WARP", "cf", "*.rutang.cloud, as today", icon="🛡️")
d.text(610, 365, 240, 110, "<b>Why bypass is safe:</b> switchboard rejects anything without a valid bearer it issued itself. "
       "Only the human step (/authorize) needs Access.", size=11, color="#7a3d00")
tun = d.box(600, 490, 470, 70, "Tunnel “family-default” ingress (first match wins)", "cf",
            "stickerprinter → :8111 · rutang.cloud → :8080 · <b>build → :8787 (new)</b> · *.rutang.cloud → :8090", icon="")

# pi
d.zone(1120, 20, 500, 560, "pidev", "pi", "")
sb = d.box(1150, 80, 440, 150, "switchboard  127.0.0.1:8787", "sb",
           "<div style='text-align:left;font-family:JetBrains Mono,Menlo,monospace;font-size:11px;line-height:1.6'>"
           "systemd --user: switchboard.service (jeff)<br>config ~/.config/switchboard/config.toml<br>"
           "state  ~/.local/state/switchboard/sb.db<br>secret Telegram bot token (env file, 600)</div>", icon="🎛️")
rt = d.box(1150, 260, 440, 80, "Traefik :8090 → app containers", "work", "packing.rutang.cloud etc.", icon="🚦")
d.box(1150, 370, 440, 80, "homepage :8080 · sticker-printer :8111", "muted", "unchanged", shadow=False)
d.text(1150, 470, 440, 90, "Nothing listens on a public port. cloudflared dials out; the bypass only opens the "
       "path to switchboard's own token check.", size=11, color="#065f46")

E = dict(w=2.2, size=11)
d.edge(r1, waf, "", color="#d97757", **E)
d.edge(waf, q1, "", color="#f38020", **E)
d.edge(r2, q1, "", color="#ea580c", exit=(1, 0.5), entry=(0, 0.5), **E)
d.edge(r3, q1, "", color="#16a34a", exit=(1, 0.5), entry=(0.25, 0.75), pts=[(330, 380), (330, 272)], **E)
d.edge(q1, q2, "yes", color="#f38020", **E)
d.edge(q1, a3, "no", color="#f38020", **E)
d.edge(q2, a1, "yes", color="#f38020", exit=(1, 0.5), entry=(0, 0.6), **E)
d.edge(q2, a2, "no", color="#f38020", exit=(0.5, 1), entry=(0, 0.5), pts=[(730, 335)], **E)
d.edge(a1, tun, "", color="#f38020", exit=(1, 0.5), entry=(1, 0.3), pts=[(1085, 205), (1085, 511)], **E)
d.edge(a2, tun, "", color="#f38020", exit=(0.5, 1), entry=(0.8, 0), **E)
d.edge(a3, tun, "", color="#16a34a", exit=(0.5, 1), entry=(0, 0.5), pts=[(480, 525)], **E)
d.edge(tun, sb, ":8787", color="#4f46e5", exit=(1, 0.7), entry=(0, 0.5), pts=[(1100, 539), (1100, 155)], **E)
d.edge(tun, rt, ":8090", color="#16a34a", exit=(1, 0.9), entry=(0, 0.5), pts=[(1110, 553), (1110, 300)], **E)

# terraform
d.zone(20, 610, 1600, 350, "terraform/switchboard.tf", "muted", "what we add; applied from the Pi like everything else · nothing existing changes")
tf = [
    ("cloudflare_zero_trust_tunnel_cloudflared_config", "+ ingress build.rutang.cloud → http://localhost:8787 (before the wildcard)"),
    ("cloudflare_zero_trust_access_policy  “switchboard_bypass”", "decision = bypass · include everyone"),
    ("cloudflare_zero_trust_access_policy  “jeff_on_warp”", "allow · your email · require WARP posture"),
    ("cloudflare_zero_trust_access_application  “switchboard”", "self_hosted · build.rutang.cloud · policies = [bypass]"),
    ("cloudflare_zero_trust_access_application  “switchboard_authorize”", "self_hosted · build.rutang.cloud/authorize · policies = [jeff_on_warp] · aud → switchboard config"),
    ("cloudflare_ruleset  (http_request_firewall_custom)", "skip WAF + rate limits for ip.src in 160.79.104.0/21 and host = build.rutang.cloud"),
]
for i, (r, s) in enumerate(tf):
    col, row = i % 2, i // 2
    d.box(40 + col * 790, 670 + row * 92, 770, 76,
          f"<span style='font-family:JetBrains Mono,Menlo,monospace;font-size:12px'>{r}</span>", "cf", s,
          fill="#ffffff", size=12, align="left", shadow=False)

d.save()
