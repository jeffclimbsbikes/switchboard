import { ICON_DATA_URI } from "./icon.js";

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>switchboard</title>
<meta name="theme-color" content="#0b0f1a">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="switchboard">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="robots" content="noindex,nofollow">
<link rel="apple-touch-icon" href="__ICON__">
<link rel="icon" type="image/png" href="__ICON__">
<style>
:root{color-scheme:dark;--bg:#0b0f1a;--panel:#131a2a;--panel2:#18213a;--line:#25304a;--fg:#e6eaf5;--muted:#8d98b3;--dim:#5d6885;
--waiting:#f5a524;--working:#7c8bff;--idle:#3ecf8e;--failed:#ff5d6c;--parked:#8b97ab;--closed:#5d6885;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--r:12px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden;
padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
body.locked{overflow:hidden}
code,.mono{font-family:var(--mono)}
button{font:inherit;color:inherit}
.wrap{max-width:1200px;margin:0 auto;padding:0 16px 48px}
header.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:16px 0 12px}
header.top h1{font-size:1.15rem;margin:0;letter-spacing:.02em}
header.top h1 span{color:var(--muted);font-weight:400;font-family:var(--mono);font-size:.8rem;margin-left:6px}
.meta-row{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:.82rem;margin-left:auto;align-items:center}
.meta-row b{color:var(--fg);font-weight:500}
.refresh{display:inline-flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);display:inline-block;flex:none}
.refresh.live .dot{background:var(--idle);animation:pulse 3s ease-in-out infinite}
.refresh.offline .dot,.refresh.denied .dot{background:var(--failed)}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(62,207,142,.6)}50%{box-shadow:0 0 0 5px rgba(62,207,142,0)}}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;min-width:0}
.kpi .n{font-size:1.7rem;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .n small{font-size:.9rem;color:var(--muted);font-weight:400}
.kpi .l{color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.07em;margin-top:2px}
.kpi.k-waiting.hot{background:rgba(245,165,36,.14);border-color:var(--waiting)}
.kpi.k-waiting.hot .n{color:var(--waiting)}
.kpi.k-working .n{color:var(--working)}
.kpi.k-idle .n{color:var(--idle)}
.kpi.k-failed .n{color:var(--failed)}
.kpi.k-parked .n{color:var(--parked)}
.banner{margin:12px 0 0;padding:10px 12px;border-radius:var(--r);background:rgba(255,93,108,.12);border:1px solid var(--failed);color:#ffc7cc;font-size:.9rem}
nav.tabs{position:sticky;top:env(safe-area-inset-top);z-index:5;display:flex;gap:4px;margin:14px -16px 0;padding:8px 16px;background:rgba(11,15,26,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
nav.tabs button{background:none;border:1px solid transparent;border-radius:999px;padding:6px 14px;color:var(--muted);cursor:pointer}
nav.tabs button[aria-selected=true]{background:var(--panel2);border-color:var(--line);color:var(--fg)}
h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:22px 0 10px;font-weight:600;display:flex;align-items:center;gap:8px}
h2 .count{background:var(--panel2);border-radius:999px;padding:0 8px;font-size:.72rem;color:var(--fg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px;min-width:0;overflow-wrap:anywhere}
.card.click{cursor:pointer;text-align:left;width:100%;display:block}
.card.click:hover,.card.click:focus-visible{border-color:var(--dim);outline:none}
.card.click:focus-visible{box-shadow:0 0 0 2px var(--working)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sp{flex:1}
.name{font-family:var(--mono);font-weight:650;font-size:1rem}
.age{color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums}
.title{margin:6px 0 2px}
.sub{color:var(--muted);font-size:.8rem}
.act{font-family:var(--mono);font-size:.78rem;color:var(--muted);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.badge{display:inline-block;border-radius:6px;padding:1px 7px;font-size:.72rem;font-weight:600;letter-spacing:.03em;border:1px solid var(--line);background:var(--panel2);color:var(--muted)}
.drv-claude{color:#f0a37a;border-color:rgba(240,163,122,.4)}
.drv-acp{color:#6cc6d9;border-color:rgba(108,198,217,.4)}
.drv-fake{color:var(--muted)}
.b-default{color:var(--idle);border-color:rgba(62,207,142,.4)}
.b-ro{color:var(--idle);border-color:rgba(62,207,142,.4)}
.b-destr{color:var(--failed);border-color:rgba(255,93,108,.5)}
.b-req{color:var(--waiting);border-color:rgba(245,165,36,.4)}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:1px 9px 1px 7px;font-size:.74rem;font-weight:600;border:1px solid currentColor;text-transform:lowercase}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.s-waiting{color:var(--waiting)}.s-working,.s-starting{color:var(--working)}.s-idle{color:var(--idle)}.s-failed{color:var(--failed)}.s-parked{color:var(--parked)}.s-closed{color:var(--closed)}
.s-working .pill::before,.pill.s-working::before,.pill.s-starting::before{animation:pulse2 1.6s ease-in-out infinite}
@keyframes pulse2{0%,100%{opacity:1}50%{opacity:.35}}
.livedot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.livedot.on{background:var(--idle)}
.board-group.g-waiting .card{border-color:rgba(245,165,36,.55)}
.pending{margin-top:8px;border:1px solid rgba(245,165,36,.55);background:rgba(245,165,36,.1);border-radius:10px;padding:8px 10px}
.pending-h{color:var(--waiting);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
.pending-q{margin-top:3px;white-space:pre-wrap}
.card .pending-q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.opt{border:1px solid rgba(245,165,36,.5);border-radius:999px;padding:1px 9px;font-size:.78rem;color:#ffd58a}
.optlist{margin:6px 0 0;padding:0;list-style:none}
.optlist li{padding:5px 0;border-top:1px solid rgba(245,165,36,.2)}
.optlist li small{display:block;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-family:var(--mono);font-size:.78rem;cursor:pointer}
.chip.s-waiting{border-color:var(--waiting)}.chip.s-working,.chip.s-starting{border-color:var(--working)}.chip.s-idle{border-color:var(--idle)}
.chip .cs{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:6px}
.chip span.t{color:var(--fg)}
.desc{margin:6px 0 0;color:var(--muted);font-size:.88rem}
details.closed>summary,details.fold>summary{cursor:pointer;color:var(--muted);margin:22px 0 10px;font-size:.78rem;text-transform:uppercase;letter-spacing:.09em;font-weight:600}
.empty{color:var(--muted);padding:18px;border:1px dashed var(--line);border-radius:var(--r);text-align:center}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
.kv dt{color:var(--muted)}.kv dd{margin:0;font-family:var(--mono);font-size:.85rem;overflow-wrap:anywhere}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:.8rem}
pre.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px;max-height:60vh;overflow:auto}
.tool-h{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:baseline}
.tool-h .tt{color:var(--muted)}
.tbtn{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer;color:var(--muted)}
.tbtn[aria-pressed=true]{color:var(--fg);border-color:var(--working)}
table.schema{width:100%;border-collapse:collapse;margin-top:10px;font-size:.85rem}
table.schema th{text-align:left;color:var(--muted);font-weight:500;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px;border-bottom:1px solid var(--line)}
table.schema td{padding:6px 8px;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
table.schema td.p{font-family:var(--mono);color:var(--fg)}
.cons{display:flex;flex-wrap:wrap;gap:4px}
.cons span{font-family:var(--mono);font-size:.74rem;background:var(--panel2);border-radius:5px;padding:0 6px}
@media (max-width:719px){
table.schema thead{display:none}
table.schema,table.schema tbody,table.schema tr,table.schema td{display:block;width:100%}
table.schema tr{padding:8px 0;border-bottom:1px solid var(--line)}
table.schema td{border:0;padding:2px 0}
table.schema td[data-l]::before{content:attr(data-l) " ";color:var(--dim);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;margin-right:6px}
table.schema td.p::before{content:none}
}
table.plain{width:100%;border-collapse:collapse;font-size:.88rem}
table.plain th{text-align:left;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid var(--line)}
table.plain td{padding:8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere;vertical-align:top}
@media (max-width:719px){
table.plain thead{display:none}
table.plain,table.plain tbody,table.plain tr,table.plain td{display:block;width:100%}
table.plain tr{padding:8px 0;border-bottom:1px solid var(--line)}
table.plain td{border:0;padding:2px 0}
table.plain td[data-l]::before{content:attr(data-l) " ";color:var(--dim);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;margin-right:6px}
}
#scrim{position:fixed;inset:0;background:rgba(3,5,10,.6);z-index:20;opacity:0;pointer-events:none;transition:opacity .2s}
#scrim.open{opacity:1;pointer-events:auto}
#drawer{position:fixed;z-index:21;background:var(--bg);border:1px solid var(--line);display:flex;flex-direction:column;transition:transform .22s ease;
left:0;right:0;bottom:0;height:90vh;height:90dvh;border-radius:16px 16px 0 0;transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom)}
#drawer.open{transform:none}
@media (min-width:900px){#drawer{left:auto;top:0;height:100vh;width:min(580px,100vw);border-radius:0;transform:translateX(105%);padding-right:env(safe-area-inset-right)}}
.dh{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
.dh .x{background:var(--panel2);border:1px solid var(--line);border-radius:999px;width:36px;height:36px;cursor:pointer;font-size:1.1rem;line-height:1}
.db{overflow-y:auto;overflow-x:hidden;padding:12px 16px 24px;flex:1;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.tl{margin:12px 0 0;padding:0 0 0 14px;border-left:2px solid var(--line);list-style:none}
.ev{position:relative;margin:0 0 10px;padding:0 0 0 4px;min-width:0}
.ev::before{content:"";position:absolute;left:-20px;top:7px;width:8px;height:8px;border-radius:50%;background:var(--line)}
.ev .eh{display:flex;gap:8px;align-items:baseline;font-size:.72rem;color:var(--dim);font-family:var(--mono)}
.ev .eh .k{color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ev .eb{margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere}
.ev.e-prompt::before{background:var(--working)}
.ev.e-prompt .eb{background:rgba(124,139,255,.12);border:1px solid rgba(124,139,255,.35);border-radius:10px;padding:8px 10px}
.ev.e-text::before{background:var(--muted)}
.ev.e-tool .eb{font-family:var(--mono);font-size:.8rem}
.ev.e-tool.t-done::before{background:var(--idle)}.ev.e-tool.t-failed::before{background:var(--failed)}.ev.e-tool.t-running::before{background:var(--working)}
.ev.e-request::before{background:var(--waiting)}
.ev.e-error::before{background:var(--failed)}.ev.e-error .eb{color:#ffc7cc}
.ev.e-turn_end::before{background:var(--idle)}
.ev.e-note .eb,.ev.e-session .eb{color:var(--muted);font-style:italic}
.more{background:none;border:0;color:var(--working);cursor:pointer;padding:2px 0}
.plan{margin:2px 0 0;padding:0;list-style:none;font-size:.88rem}
.plan li::before{content:"○ ";color:var(--dim)}.plan li.completed::before{content:"● ";color:var(--idle)}.plan li.in_progress::before{content:"◐ ";color:var(--working)}
.note{color:var(--muted);font-size:.82rem;margin:8px 0}
.gauge{margin:10px 0 0}
.gauge .gh{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.gauge .gl{font-weight:600}
.gauge .gp{font-family:var(--mono);font-variant-numeric:tabular-nums}
.gauge .gs{font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.gauge .gs.allowed{color:var(--idle)}.gauge .gs.warning{color:var(--waiting)}.gauge .gs.rejected{color:var(--failed)}
.track{height:10px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);overflow:hidden;margin-top:6px}
.track i{display:block;height:100%;background:var(--idle);border-radius:999px}
.track i.warning{background:var(--waiting)}.track i.rejected{background:var(--failed)}
.bars{display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:12px}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.bar i{display:block;width:100%;background:var(--working);border-radius:4px 4px 0 0;min-height:2px}
.bar b{font-size:.72rem;font-weight:500;font-family:var(--mono);margin-bottom:2px}
.bar span{font-size:.68rem;color:var(--muted);margin-top:4px;font-family:var(--mono)}
.b-exp{color:var(--waiting);border-color:rgba(245,165,36,.4)}
.mdl{padding:10px 0;border-top:1px solid var(--line)}
a.ext{color:var(--working)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
<h1>switchboard<span id="ver"></span></h1>
<div class="meta-row">
<span>up <b id="uptime">–</b></span>
<span>auth <b id="auth">–</b></span>
<span class="refresh" id="refresh"><i class="dot"></i><span id="refreshText">connecting</span></span>
</div>
</header>
<div id="banner" class="banner" hidden></div>
<section class="kpis" id="kpis" aria-label="Summary"></section>
<nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
<main id="main"><div class="empty" style="margin-top:16px">Loading…</div></main>
</div>
<div id="scrim"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-label="Session detail">
<div class="dh" id="dhead"></div>
<div class="db" id="dbody">
<div id="dmeta"></div>
<div id="dpending"></div>
<h2>Timeline</h2>
<div class="note" id="dnote"></div>
<ol class="tl" id="timeline"></ol>
</div>
</aside>
<script>
(function () {
  "use strict";
  var POLL_MS = 3000;
  var CLOSED_NOTE = "Showing the 100 most recent closed sessions.";
  var GROUPS = [
    { id: "waiting", label: "Waiting on you", states: ["waiting"] },
    { id: "working", label: "Working", states: ["working", "starting"] },
    { id: "idle", label: "Idle", states: ["idle"] },
    { id: "parked", label: "Parked", states: ["parked"] },
    { id: "failed", label: "Failed", states: ["failed"] },
    { id: "closed", label: "Closed", states: ["closed"] }
  ];
  var TABS = [["overview", "Overview"], ["usage", "Usage"], ["models", "Models"], ["tools", "Tools"], ["connections", "Connections"]];

  var state = null;
  var mcp = null;
  var mcpError = null;
  var skew = 0;
  var tab = "overview";
  var rawTools = false;
  var closedOpen = false;
  var lastKey = "";
  var timer = null;
  var busy = false;
  var drawer = { name: null, lastSeq: 0, seen: {}, tools: {}, loaded: false, truncated: false, missing: false };

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function nowMs() { return Date.now() + skew; }
  function dur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var hh = Math.floor(m / 60);
    if (hh < 48) return hh + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
    return Math.floor(hh / 24) + "d " + (hh % 24) + "h";
  }
  function ago(iso) { return dur(nowMs() - Date.parse(iso)) + " ago"; }
  function until(iso) {
    var d = Date.parse(iso) - nowMs();
    return d <= 0 ? "expired" : "in " + dur(d);
  }
  function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour12: false }); }
  function fullTime(iso) { return new Date(iso).toLocaleString(); }
  function hostOf(id) {
    try { return new URL(id).host; } catch (e) { return id; }
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function driverOf(agentId) {
    var a = state && state.agents.filter(function (x) { return x.id === agentId; })[0];
    return a ? a.driver : "";
  }
  function agentBadge(id) {
    var d = driverOf(id);
    return h("span", { class: "badge drv-" + d, title: d ? "driver: " + d : "" }, id);
  }
  function pill(st) { return h("span", { class: "pill s-" + st }, st); }

  function pendingBlock(p, compact) {
    var box = h("div", { class: "pending" });
    if (p.kind === "approval") {
      box.appendChild(h("div", { class: "pending-h" }, "Approval needed · ", h("code", null, p.tool)));
      box.appendChild(h("div", { class: "pending-q", text: p.summary }));
      var labels = p.options.map(function (o) { return o.label; });
      if (compact) {
        box.appendChild(h("div", { class: "opts" }, labels.slice(0, 4).map(function (l) { return h("span", { class: "opt" }, l); })));
      } else {
        box.appendChild(h("ul", { class: "optlist" }, p.options.map(function (o) {
          return h("li", null, o.label, h("small", null, o.kind + " · id " + o.id));
        })));
        if (p.input !== undefined) {
          box.appendChild(h("details", { class: "fold" }, h("summary", null, "tool input"), h("pre", { class: "box", text: JSON.stringify(p.input, null, 2) })));
        }
      }
      return box;
    }
    var qs = compact ? p.questions.slice(0, 1) : p.questions;
    box.appendChild(h("div", { class: "pending-h" }, "Question" + (p.questions.length > 1 ? "s" : "") + " for you"));
    qs.forEach(function (q) {
      box.appendChild(h("div", { class: "pending-q" }, q.header ? h("b", null, q.header + " — ") : null, q.question));
      if (compact) {
        var shown = q.options.slice(0, 4);
        box.appendChild(h("div", { class: "opts" }, shown.map(function (o) { return h("span", { class: "opt" }, o.label); }),
          q.options.length > shown.length ? h("span", { class: "opt" }, "+" + (q.options.length - shown.length)) : null));
      } else {
        if (q.multiSelect) box.appendChild(h("div", { class: "sub" }, "more than one allowed"));
        box.appendChild(h("ul", { class: "optlist" }, q.options.map(function (o, i) {
          return h("li", null, (i + 1) + ". " + o.label, o.description ? h("small", null, o.description) : null);
        })));
      }
    });
    return box;
  }

  function sessionByName(name) {
    return state && state.sessions.filter(function (s) { return s.name === name; })[0];
  }

  function sessionCard(s) {
    var last = s.activity.length ? s.activity[s.activity.length - 1] : s.lastActivity;
    var card = h("div", {
      class: "card click", role: "button", tabindex: "0",
      "aria-label": "Open session " + s.name,
      onclick: function () { location.hash = "#session/" + encodeURIComponent(s.name); },
      onkeydown: function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = "#session/" + encodeURIComponent(s.name); }
      }
    },
      h("div", { class: "row" },
        h("span", { class: "livedot" + (s.live ? " on" : ""), title: s.live ? "process running" : "no process" }),
        h("span", { class: "name" }, s.name),
        agentBadge(s.agent),
        pill(s.state),
        h("span", { class: "sp" }),
        h("span", { class: "age", title: "updated " + fullTime(s.updatedAt) }, dur(nowMs() - Date.parse(s.updatedAt)))),
      h("div", { class: "title" }, s.title),
      h("div", { class: "sub" }, s.workspace + (s.model ? " · " + s.model : "") + (s.owner ? " · " + s.owner : "")),
      last ? h("div", { class: "act" }, last) : null,
      s.pending ? pendingBlock(s.pending, true) : null);
    return card;
  }

  function renderHeader() {
    $("ver").textContent = "v" + state.version;
    $("uptime").textContent = dur(state.uptimeSeconds * 1000);
    $("auth").textContent = state.config.auth.login + (state.viewer.email ? " · " + state.viewer.email : "");
  }

  function kpi(cls, n, label, extra) {
    return h("div", { class: "kpi " + cls }, h("div", { class: "n" }, n, extra || null), h("div", { class: "l" }, label));
  }

  function renderKpis() {
    var c = state.counts, b = c.byState;
    var waiting = b.waiting;
    var tiles = [
      kpi("k-live", c.live, "live agents", h("small", null, " / " + c.maxLive)),
      kpi("k-working", b.working + b.starting, "working"),
      kpi("k-waiting" + (waiting > 0 ? " hot" : ""), waiting, "waiting on you"),
      kpi("k-idle", b.idle, "idle"),
      kpi("k-parked", b.parked, "parked"),
      b.failed > 0 ? kpi("k-failed", b.failed, "failed") : null,
      kpi("k-total", c.total, "total sessions")
    ];
    clear($("kpis"));
    add($("kpis"), tiles);
    document.title = (waiting > 0 ? "(" + waiting + ") " : "") + "switchboard";
  }

  function renderOverview(root) {
    root.appendChild(h("h2", null, "Agents", h("span", { class: "count" }, state.agents.length)));
    var agents = h("div", { class: "grid" });
    state.agents.forEach(function (a) {
      var chips = a.liveSessions.map(function (n) {
        var s = sessionByName(n);
        return h("button", {
          class: "chip s-" + (s ? s.state : "idle"), type: "button",
          onclick: function () { location.hash = "#session/" + encodeURIComponent(n); }
        }, h("span", { class: "cs" }), h("span", { class: "t" }, n));
      });
      agents.appendChild(h("div", { class: "card" },
        h("div", { class: "row" },
          h("span", { class: "name" }, a.id),
          h("span", { class: "badge drv-" + a.driver }, a.driver),
          a.default ? h("span", { class: "badge b-default" }, "default") : null,
          h("span", { class: "sp" }),
          h("span", { class: "age" }, plural(a.live, "live session"))),
        h("div", { class: "sub mono", style: "margin-top:6px" }, (a.model || "model: agent default") + (a.runAs ? " · run_as " + a.runAs : "")),
        a.description ? h("p", { class: "desc" }, a.description) : null,
        chips.length ? h("div", { class: "chips" }, chips) : null));
    });
    root.appendChild(agents);

    root.appendChild(h("h2", null, "Workspaces", h("span", { class: "count" }, state.workspaces.length)));
    var ws = h("div", { class: "grid" });
    state.workspaces.forEach(function (w) {
      ws.appendChild(h("div", { class: "card" },
        h("div", { class: "row" }, h("span", { class: "name" }, w.id), w.default ? h("span", { class: "badge b-default" }, "default") : null),
        h("div", { class: "sub mono", style: "margin-top:6px" }, w.path),
        w.description ? h("p", { class: "desc" }, w.description) : null));
    });
    root.appendChild(ws);

    var sessions = state.sessions.slice().sort(function (a, b) { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); });
    var any = false;
    GROUPS.forEach(function (g) {
      var list = sessions.filter(function (s) { return g.states.indexOf(s.state) >= 0; });
      if (!list.length) return;
      any = true;
      var grid = h("div", { class: "grid" }, list.map(sessionCard));
      var total = state.counts.byState;
      var count = g.states.reduce(function (n, st) { return n + total[st]; }, 0);
      if (g.id === "closed") {
        var det = h("details", { class: "closed", ontoggle: function (e) { closedOpen = e.target.open; } },
          h("summary", null, "Closed (" + count + ")"), grid);
        if (closedOpen) det.open = true;
        if (count > list.length) det.appendChild(h("p", { class: "note" }, CLOSED_NOTE));
        root.appendChild(det);
      } else {
        root.appendChild(h("div", { class: "board-group g-" + g.id },
          h("h2", { class: "s-" + g.states[0] }, g.label, h("span", { class: "count" }, count)), grid));
      }
    });
    if (!any) {
      root.appendChild(h("h2", null, "Sessions"));
      root.appendChild(h("div", { class: "empty" }, "No sessions yet. They appear here when a client calls start."));
    }
  }

  function typeOf(s) {
    if (!s || typeof s !== "object") return "any";
    if (s.enum) return "enum";
    if (s.const !== undefined) return "const";
    if (Array.isArray(s.type)) return s.type.join(" | ");
    if (s.type === "array") return "array<" + typeOf(s.items) + ">";
    var alt = s.anyOf || s.oneOf;
    if (alt) return alt.map(typeOf).join(" | ");
    return s.type || "any";
  }
  function constraintsOf(s) {
    var c = [];
    if (!s || typeof s !== "object") return c;
    if (s.enum) s.enum.forEach(function (v) { c.push(String(v)); });
    if (s.const !== undefined) c.push("= " + JSON.stringify(s.const));
    if (s.minimum !== undefined) c.push("min " + s.minimum);
    if (s.exclusiveMinimum !== undefined) c.push("> " + s.exclusiveMinimum);
    if (s.maximum !== undefined) c.push("max " + s.maximum);
    if (s.exclusiveMaximum !== undefined) c.push("< " + s.exclusiveMaximum);
    if (s.minLength !== undefined) c.push("minLength " + s.minLength);
    if (s.maxLength !== undefined) c.push("maxLength " + s.maxLength);
    if (s.minItems !== undefined) c.push("minItems " + s.minItems);
    if (s.maxItems !== undefined) c.push("maxItems " + s.maxItems);
    if (s.pattern) c.push("pattern " + s.pattern);
    if (s.format) c.push("format " + s.format);
    if (s.default !== undefined) c.push("default " + JSON.stringify(s.default));
    return c;
  }

  function schemaTable(schema) {
    var props = schema && schema.properties ? Object.keys(schema.properties) : [];
    if (!props.length) return h("p", { class: "sub" }, "No parameters.");
    var required = (schema && schema.required) || [];
    var body = h("tbody");
    props.forEach(function (name) {
      var p = schema.properties[name];
      var req = required.indexOf(name) >= 0;
      body.appendChild(h("tr", null,
        h("td", { class: "p" }, name),
        h("td", { "data-l": "type", class: "mono" }, typeOf(p)),
        h("td", { "data-l": "required" }, h("span", { class: "badge " + (req ? "b-req" : "") }, req ? "required" : "optional")),
        h("td", { "data-l": "constraints" }, h("div", { class: "cons" }, constraintsOf(p).map(function (x) { return h("span", null, x); }))),
        h("td", { "data-l": "about" }, p.description || "")));
    });
    return h("table", { class: "schema" },
      h("thead", null, h("tr", null, ["Param", "Type", "Required", "Constraints", "Description"].map(function (x) { return h("th", null, x); }))), body);
  }

  function money(n) {
    if (!n) return "$0";
    return "$" + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));
  }
  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function pct(u) { return Math.round(u * 100) + "%"; }
  function tokenLine(t) {
    return t.input || t.output ? compact(t.input) + " in / " + compact(t.output) + " out" : "";
  }
  function totalsCell(label, t) {
    var tokens = tokenLine(t);
    return h("td", { "data-l": label },
      t.costUsd > 0 ? h("b", null, money(t.costUsd)) : (t.turns > 0 || tokens ? "—" : "·"),
      tokens ? h("div", { class: "sub mono" }, tokens) : null);
  }

  function gauge(w) {
    var u = w.utilization;
    return h("div", { class: "gauge" },
      h("div", { class: "gh" },
        h("span", { class: "gl" }, w.label),
        h("span", { class: "gp" }, u === undefined ? "—" : pct(u)),
        h("span", { class: "gs " + w.status }, w.status),
        h("span", { class: "sp" }),
        w.resetsAt ? h("span", { class: "sub", title: fullTime(w.resetsAt) }, "resets " + until(w.resetsAt)) : null),
      h("div", { class: "track", role: "img", "aria-label": w.label + " " + (u === undefined ? "unknown" : pct(u)) },
        h("i", { class: w.status, style: "width:" + Math.min(100, Math.round((u || 0) * 100)) + "%" })));
  }

  function renderClaudePlan(root, c) {
    root.appendChild(h("h2", null, "Claude plan",
      c.source === "probe" || c.probe ? h("span", { class: "badge b-exp", title: "uses an experimental SDK call" }, "experimental") : null));
    var card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "row" },
      c.subscriptionType ? h("span", { class: "badge drv-claude" }, c.subscriptionType) : h("span", { class: "sub" }, "plan type unknown"),
      h("span", { class: "sp" }),
      c.lastSeenAt ? h("span", { class: "sub", title: fullTime(c.lastSeenAt) },
        "last seen " + ago(c.lastSeenAt) + " · " + (c.source === "probe" ? "probe (experimental)" : "live session")) : null));
    if (c.windows.length) c.windows.forEach(function (w) { card.appendChild(gauge(w)); });
    else {
      card.appendChild(h("p", { class: "desc" }, c.unavailable
        ? "Plan limits do not apply to this account (API key or third-party provider)."
        : "No plan data yet. It appears once a Claude session reports its limits" +
          (c.probe ? ", or when the experimental probe next runs." : "; set [usage.claude] probe = true to fetch it on demand (experimental).")));
    }
    root.appendChild(card);
  }

  function renderCost(root, u) {
    root.appendChild(h("h2", null, "Cost"));
    var hasClaude = u.agents.some(function (a) { return a.driver === "claude"; });
    if (hasClaude) root.appendChild(h("p", { class: "note" }, "API-equivalent cost (subscription usage, not a bill). Other agents show the cost they report, if any."));
    var head = function (cols) { return h("thead", null, h("tr", null, cols.map(function (x) { return h("th", null, x); }))); };
    var body = h("tbody");
    u.agents.forEach(function (a) {
      body.appendChild(h("tr", null,
        h("td", { "data-l": "agent" }, agentBadge(a.agent)),
        totalsCell("today", a.today), totalsCell("7 days", a.week), totalsCell("all time", a.total)));
    });
    root.appendChild(h("div", { class: "card" }, h("table", { class: "plain" }, head(["Agent", "Today", "7 days", "All time"]), body)));
    if (!u.sessions.length) return;
    root.appendChild(h("h2", null, "Sessions", h("span", { class: "count" }, u.sessions.length)));
    var sb = h("tbody");
    u.sessions.forEach(function (s) {
      sb.appendChild(h("tr", null,
        h("td", { "data-l": "session" },
          h("a", { class: "name ext", href: "#session/" + encodeURIComponent(s.name) }, s.name),
          h("div", { class: "sub" }, s.title)),
        h("td", { "data-l": "agent" }, agentBadge(s.agent)),
        totalsCell("today", s.today), totalsCell("7 days", s.week), totalsCell("all time", s.total)));
    });
    root.appendChild(h("div", { class: "card" }, h("table", { class: "plain" }, head(["Session", "Agent", "Today", "7 days", "All time"]), sb)));
  }

  function renderOllama(root, o) {
    root.appendChild(h("h2", null, "Ollama",
      h("span", { class: "badge b-exp", title: "ollama.com/api/me and /api/usage are undocumented and may change" }, "undocumented API")));
    var card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "row" },
      o.plan ? h("span", { class: "badge drv-acp" }, o.plan) : h("span", { class: "sub" }, "plan unknown"),
      o.totalRequests !== undefined ? h("span", null, h("b", null, o.totalRequests), " requests in 7 days") : null,
      h("span", { class: "sp" }),
      o.fetchedAt ? h("span", { class: "sub", title: fullTime(o.fetchedAt) }, "fetched " + ago(o.fetchedAt)) : h("span", { class: "sub" }, "not fetched yet")));
    if (o.days.length) {
      var max = Math.max.apply(null, o.days.map(function (d) { return d.requests; }).concat([1]));
      card.appendChild(h("div", { class: "bars" }, o.days.map(function (d) {
        return h("div", { class: "bar", title: d.date + ": " + d.requests + " requests" },
          h("b", null, d.requests), h("i", { style: "height:" + Math.max(2, Math.round(d.requests / max * 70)) + "px" }), h("span", null, d.date.slice(5)));
      })));
    }
    if (o.error) card.appendChild(h("p", { class: "note" }, "Could not refresh: " + o.error));
    card.appendChild(h("p", { class: "note" }, "Quota percentage is not available via the API. ",
      h("a", { class: "ext", href: "https://ollama.com/settings", target: "_blank", rel: "noopener noreferrer" }, "Open ollama.com/settings")));
    root.appendChild(card);
  }

  function renderUsage(root) {
    var u = state.usage;
    if (u.claude) renderClaudePlan(root, u.claude);
    renderCost(root, u);
    if (u.ollama) renderOllama(root, u.ollama);
  }

  function priceText(m) {
    if (m.inputPrice === undefined && m.outputPrice === undefined) return "price not published";
    var f = function (n) { return n === undefined ? "?" : "$" + Number(n.toFixed(4)); };
    return f(m.inputPrice) + " in / " + f(m.outputPrice) + " out per M tokens";
  }

  function renderModels(root) {
    var ids = Object.keys(state.catalog);
    root.appendChild(h("p", { class: "note" }, "Prices are list prices per million tokens, for comparison only."));
    if (!ids.length) {
      root.appendChild(h("div", { class: "empty" }, "No model catalogs configured. Add [[agents.<id>.models]] entries to choose models per agent."));
      return;
    }
    state.agents.forEach(function (a) {
      var list = state.catalog[a.id];
      if (!list) return;
      var card = h("div", { class: "card", style: "margin-bottom:10px" },
        h("div", { class: "row" }, h("span", { class: "name" }, a.id), h("span", { class: "badge drv-" + a.driver }, a.driver),
          h("span", { class: "sp" }), h("span", { class: "sub" }, plural(list.length, "model"))));
      list.forEach(function (m) {
        card.appendChild(h("div", { class: "mdl" },
          h("div", { class: "row" },
            h("code", null, m.id),
            m.label ? h("span", null, m.label) : null,
            m.default ? h("span", { class: "badge b-default" }, "default") : null,
            h("span", { class: "sp" }),
            h("span", { class: "sub mono" }, priceText(m))),
          m.description ? h("p", { class: "desc" }, m.description) : null,
          m.notes ? h("p", { class: "note", style: "margin:4px 0 0" }, m.notes) : null));
      });
      root.appendChild(card);
    });
  }

  function renderTools(root) {
    if (!mcp) {
      root.appendChild(h("div", { class: "empty" }, mcpError ? "Could not read the tool contract: " + mcpError : "Loading the tool contract…"));
      return;
    }
    root.appendChild(h("div", { class: "row", style: "margin-top:16px" },
      h("span", { class: "sub" }, plural(mcp.tools.length, "tool") + " exactly as an MCP client lists them"),
      h("span", { class: "sp" }),
      h("button", {
        class: "tbtn", type: "button", "aria-pressed": rawTools ? "true" : "false",
        onclick: function () { rawTools = !rawTools; lastKey = ""; render(); }
      }, "Raw JSON")));
    root.appendChild(h("h2", null, "Server instructions", h("span", { class: "count" }, mcp.instructions.length + " chars")));
    root.appendChild(h("pre", { class: "box", text: mcp.instructions }));
    root.appendChild(h("h2", null, "Tools", h("span", { class: "count" }, mcp.tools.length)));
    var list = h("div", { class: "grid", style: "grid-template-columns:1fr" });
    mcp.tools.forEach(function (t) {
      var a = t.annotations || {};
      var head = h("div", { class: "tool-h" },
        h("span", { class: "name" }, t.name),
        t.title ? h("span", { class: "tt" }, t.title) : null,
        a.readOnlyHint ? h("span", { class: "badge b-ro" }, "read-only") : null,
        a.destructiveHint ? h("span", { class: "badge b-destr" }, "destructive") : null,
        a.idempotentHint ? h("span", { class: "badge" }, "idempotent") : null,
        a.openWorldHint ? h("span", { class: "badge" }, "open-world") : null);
      var body = rawTools
        ? h("pre", { class: "box", style: "margin-top:10px", text: JSON.stringify(t, null, 2) })
        : h("div", null, t.description ? h("p", { class: "desc", style: "color:var(--fg)" }, t.description) : null,
          h("h2", { style: "margin:14px 0 0" }, "Input"), schemaTable(t.inputSchema));
      list.appendChild(h("div", { class: "card" }, head, body));
    });
    root.appendChild(list);
  }

  function renderConnections(root) {
    root.appendChild(h("h2", null, "Connected clients", h("span", { class: "count" }, state.grants.length)));
    if (!state.grants.length) {
      var why = state.viewer.restricted ? "Not shown for restricted users."
        : state.config.auth.login === "none" ? "Auth is off, so there are no OAuth clients." : "No active grants.";
      root.appendChild(h("div", { class: "empty" }, why));
    } else {
      var body = h("tbody");
      state.grants.forEach(function (g) {
        body.appendChild(h("tr", null,
          h("td", { "data-l": "client" }, h("b", null, g.clientName || hostOf(g.clientId)), h("div", { class: "sub mono" }, hostOf(g.clientId))),
          h("td", { "data-l": "user", class: "mono" }, g.email),
          h("td", { "data-l": "connected", title: fullTime(g.createdAt) }, ago(g.createdAt)),
          h("td", { "data-l": "expires", title: fullTime(g.expiresAt) }, until(g.expiresAt))));
      });
      root.appendChild(h("div", { class: "card" }, h("table", { class: "plain" },
        h("thead", null, h("tr", null, ["Client", "Signed in as", "Connected", "Expires"].map(function (x) { return h("th", null, x); }))), body)));
    }
    var c = state.config;
    root.appendChild(h("h2", null, "Configuration"));
    var rows = [
      ["listen", c.listen],
      ["public_url", c.publicUrl || "—"],
      ["max_wait", dur(c.maxWaitMs)],
      ["idle_park_after", dur(c.idleParkAfterMs)],
      ["max_live_sessions", String(c.maxLiveSessions)],
      ["auth", c.auth.login + (c.auth.team ? " · team " + c.auth.team : "") + (c.auth.allowed ? " · " + plural(c.auth.allowed, "allowed email") : "") + (c.auth.email ? " · " + c.auth.email : "")],
      ["notify", (c.notify.channels.length ? c.notify.channels.join(", ") : "none") + " · nag after " + dur(c.notify.nagAfterMs)]
    ];
    var kv = h("dl", { class: "kv" });
    rows.forEach(function (r) { kv.appendChild(h("dt", null, r[0])); kv.appendChild(h("dd", null, r[1])); });
    root.appendChild(h("div", { class: "card" }, kv));
  }

  function renderTabs() {
    var nav = clear($("tabs"));
    TABS.forEach(function (t) {
      nav.appendChild(h("button", {
        type: "button", role: "tab", "aria-selected": tab === t[0] ? "true" : "false",
        onclick: function () { tab = t[0]; lastKey = ""; render(); }
      }, t[1]));
    });
  }

  function render() {
    if (!state) return;
    var key = JSON.stringify([state.sessions, state.agents, state.workspaces, state.counts, state.grants, state.config, state.version, state.usage, state.catalog, tab, rawTools, !!mcp, mcpError]) + Math.floor(nowMs() / 30000);
    renderHeader();
    if (key === lastKey) return;
    lastKey = key;
    renderTabs();
    renderKpis();
    var main = clear($("main"));
    if (tab === "overview") renderOverview(main);
    else if (tab === "usage") renderUsage(main);
    else if (tab === "models") renderModels(main);
    else if (tab === "tools") renderTools(main);
    else renderConnections(main);
  }

  function tl(el, name) { return el.querySelector(name); }

  function setStatus(kind, detail) {
    var r = $("refresh");
    r.className = "refresh " + kind;
    $("refreshText").textContent = kind === "live" ? "live · 3s" : kind === "paused" ? "paused" : kind === "denied" ? "access denied" : "offline";
    var b = $("banner");
    if (kind === "denied") { b.hidden = false; b.textContent = "Access denied. Open this page through Cloudflare Access and reload."; }
    else if (kind === "offline") { b.hidden = false; b.textContent = "Cannot reach switchboard" + (detail ? " (" + detail + ")" : "") + ". Retrying every 3 s."; }
    else b.hidden = true;
  }

  function getJson(url) {
    return fetch(url, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } }).then(function (res) {
      if (!res.ok) {
        var e = new Error("HTTP " + res.status);
        e.status = res.status;
        throw e;
      }
      return res.json();
    });
  }

  function fetchState() {
    return getJson("/dashboard/api/state" + (mcp ? "?tools=0" : "")).then(function (s) {
      skew = Date.parse(s.now) - Date.now();
      if (s.mcp) { mcp = s.mcp; mcpError = null; }
      else if (s.mcpError) mcpError = s.mcpError;
      state = s;
      render();
      if (drawer.name) updateDrawerHead();
    });
  }

  function evRow(e) {
    var ev = e.event;
    var kind = ev.type;
    if (kind === "tool" && drawer.tools[ev.id]) {
      var row = drawer.tools[ev.id];
      row.className = "ev e-tool t-" + ev.status;
      tl(row, ".st").textContent = ev.status;
      tl(row, ".tm").textContent = clock(e.at);
      return null;
    }
    var head = h("div", { class: "eh" }, h("span", { class: "k" }, kind === "turn_end" ? "turn end" : kind),
      h("span", { class: "tm", title: fullTime(e.at) }, clock(e.at)), h("span", null, "#" + e.seq),
      kind === "tool" ? h("span", { class: "st" }, ev.status) : null);
    var body;
    switch (kind) {
      case "prompt": body = textBody(ev.text); break;
      case "text": body = textBody(ev.text); break;
      case "tool": body = h("div", { class: "eb" }, ev.title); break;
      case "plan":
        body = h("ul", { class: "plan eb" }, ev.entries.map(function (p) { return h("li", { class: p.status }, p.content); }));
        break;
      case "request": body = h("div", { class: "eb" }, pendingBlock(ev.request, false)); break;
      case "turn_end":
        body = h("div", { class: "eb" }, ev.stopReason +
          (ev.costUsd !== undefined ? " · " + money(ev.costUsd) : "") +
          (ev.tokens ? " · " + tokenLine(ev.tokens) : ""));
        break;
      case "error": body = h("div", { class: "eb" }, (ev.fatal ? "fatal: " : "") + ev.message); break;
      case "session": body = h("div", { class: "eb mono" }, "agent session " + ev.agentSessionId); break;
      default: body = h("div", { class: "eb" }, ev.text || JSON.stringify(ev));
    }
    var li = h("li", { class: "ev e-" + kind + (kind === "tool" ? " t-" + ev.status : "") }, head, body);
    if (kind === "tool") drawer.tools[ev.id] = li;
    return li;
  }

  function textBody(text) {
    var LIMIT = 700;
    var body = h("div", { class: "eb" });
    if (text.length <= LIMIT) { body.textContent = text; return body; }
    var short = true;
    body.textContent = text.slice(0, LIMIT) + "…";
    var btn = h("button", { class: "more", type: "button" }, "Show more (" + text.length + " chars)");
    var wrap = h("div", null, body, btn);
    btn.addEventListener("click", function () {
      short = !short;
      body.textContent = short ? text.slice(0, LIMIT) + "…" : text;
      btn.textContent = short ? "Show more (" + text.length + " chars)" : "Show less";
    });
    var holder = h("div", { class: "eb", style: "white-space:normal" }, wrap);
    return holder;
  }

  function updateDrawerHead() {
    var s = sessionByName(drawer.name);
    if (!s || !drawer.detail) return;
    drawerMeta(drawer.detail);
  }

  function drawerMeta(s) {
    var head = clear($("dhead"));
    head.appendChild(h("span", { class: "livedot" + (s.live ? " on" : ""), title: s.live ? "process running" : "no process" }));
    head.appendChild(h("span", { class: "name", style: "font-size:1.15rem" }, s.name));
    head.appendChild(pill(s.state));
    head.appendChild(h("span", { class: "sp" }));
    head.appendChild(h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeDrawer }, "×"));
    var meta = clear($("dmeta"));
    meta.appendChild(h("div", { style: "font-size:1.05rem;margin:2px 0 10px" }, s.title));
    var kv = h("dl", { class: "kv" });
    [["agent", s.agent + (driverOf(s.agent) ? " (" + driverOf(s.agent) + ")" : "")],
      ["workspace", s.workspace], ["cwd", s.cwd], ["model", s.model || "agent default"],
      ["owner", s.owner || null],
      ["created", fullTime(s.createdAt) + " (" + ago(s.createdAt) + ")"],
      ["updated", fullTime(s.updatedAt) + " (" + ago(s.updatedAt) + ")"],
      ["process", s.live ? "running" : "none"]].forEach(function (r) {
      if (r[1] === null) return;
      kv.appendChild(h("dt", null, r[0]));
      kv.appendChild(h("dd", null, r[1]));
    });
    meta.appendChild(kv);
    var pend = clear($("dpending"));
    if (s.pending) {
      pend.appendChild(pendingBlock(s.pending, false));
      pend.appendChild(h("div", { class: "sub mono", style: "margin-top:4px" }, "request id " + s.pending.id));
    }
  }

  function fetchDetail() {
    var d = drawer;
    var name = d.name;
    var url = "/dashboard/api/sessions/" + encodeURIComponent(name) + (d.lastSeq > 0 ? "?since=" + d.lastSeq : "");
    return getJson(url).then(function (res) {
      if (d.name !== name) return;
      d.detail = res.session;
      d.missing = false;
      drawerMeta(res.session);
      var body = $("dbody");
      var stick = !d.loaded || body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      var list = $("timeline");
      if (res.truncated && !d.truncated) {
        d.truncated = true;
        $("dnote").textContent = "Earlier events are not shown (latest " + res.events.length + " of " + res.lastSeq + ").";
      }
      res.events.forEach(function (e) {
        if (d.seen[e.seq]) return;
        d.seen[e.seq] = true;
        var row = evRow(e);
        if (row) list.appendChild(row);
        d.lastSeq = Math.max(d.lastSeq, e.seq);
      });
      if (!res.events.length && !d.loaded) $("dnote").textContent = "No events yet.";
      else if (res.events.length && !res.truncated && !d.truncated) $("dnote").textContent = "";
      d.loaded = true;
      if (stick) body.scrollTop = body.scrollHeight;
      if (res.hasMore) return fetchDetail();
    }).catch(function (err) {
      if (d.name !== name) return;
      if (err.status === 404) {
        d.missing = true;
        $("dnote").textContent = "This session no longer exists or is not visible to you.";
      } else throw err;
    });
  }

  function openDrawer(name) {
    if (drawer.name === name) return;
    drawer = { name: name, lastSeq: 0, seen: {}, tools: {}, loaded: false, truncated: false, missing: false, detail: null };
    clear($("timeline"));
    $("dnote").textContent = "Loading…";
    var s = sessionByName(name);
    clear($("dhead")).appendChild(h("span", { class: "name", style: "font-size:1.15rem" }, name));
    $("dhead").appendChild(h("span", { class: "sp" }));
    $("dhead").appendChild(h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeDrawer }, "×"));
    clear($("dmeta"));
    clear($("dpending"));
    if (s) drawer.detail = s;
    $("scrim").classList.add("open");
    $("drawer").classList.add("open");
    $("drawer").removeAttribute("inert");
    document.body.classList.add("locked");
    fetchDetail().then(function () { $("drawer").querySelector(".x").focus(); }).catch(function () {});
  }

  function closeDrawer() {
    if (location.hash.indexOf("#session/") === 0) location.hash = "#" + tab;
    else hideDrawer();
  }

  function hideDrawer() {
    if (!drawer.name) return;
    drawer.name = null;
    $("scrim").classList.remove("open");
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("inert", "");
    document.body.classList.remove("locked");
  }

  function route() {
    var hash = location.hash;
    if (hash.indexOf("#session/") === 0) {
      openDrawer(decodeURIComponent(hash.slice(9)));
      return;
    }
    hideDrawer();
    var t = hash.slice(1);
    if (TABS.some(function (x) { return x[0] === t; }) && t !== tab) { tab = t; lastKey = ""; render(); }
  }

  function tick() {
    if (busy) return;
    busy = true;
    var p = fetchState();
    if (drawer.name) p = p.then(fetchDetail);
    p.then(function () { setStatus("live"); }, function (err) {
      setStatus(err.status === 403 ? "denied" : "offline", err.message);
    }).then(function () { busy = false; schedule(); });
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) { setStatus("paused"); return; }
    timer = setTimeout(tick, POLL_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearTimeout(timer); setStatus("paused"); }
    else { clearTimeout(timer); tick(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer.name) closeDrawer(); });
  $("scrim").addEventListener("click", closeDrawer);
  window.addEventListener("hashchange", route);

  $("drawer").setAttribute("inert", "");
  var first = location.hash.slice(1);
  if (TABS.some(function (x) { return x[0] === first; })) tab = first;
  tick();
  route();
})();
</script>
</body>
</html>
`;

export const DASHBOARD_HTML = TEMPLATE.replaceAll("__ICON__", ICON_DATA_URI);
