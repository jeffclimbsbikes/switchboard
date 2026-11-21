export const LOGIN_CSS = `
.lg-list{display:grid;gap:12px}
.lg-acct{display:grid;gap:8px;padding:10px 0;border-top:1px dashed var(--line)}
.lg-acct:first-child{border-top:0;padding-top:0}
.lg-top{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap}
.lg-name{font:650 17px var(--mono);color:var(--silk)}
.lg-btn{min-height:44px;padding:0 18px;border-radius:6px;border:1.5px solid var(--copper);background:transparent;color:var(--copper-hi);font:650 14px var(--mono);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.lg-btn.primary{background:var(--copper);color:#1a1208}
.lg-btn[disabled]{opacity:.5;cursor:default}
.lg-steps{display:grid;gap:10px;padding:12px;border:1.5px solid var(--line);border-radius:6px;background:#0b3228}
.lg-steps p{font-size:14px;color:var(--silk-2)}
.lg-steps form{display:flex;gap:8px;flex-wrap:wrap}
.lg-steps input{flex:1 1 200px;min-width:0;min-height:44px;padding:0 12px;border-radius:6px;border:1.5px solid var(--line);background:var(--mask);color:var(--silk);font:16px var(--mono)}
.lg-msg{font-size:13.5px}
.lg-msg.ok{color:var(--good)}
.lg-msg.err{color:var(--bad)}
`;

export const LOGIN_HTML = `<section class="board" id="claudeLogin" style="margin-bottom:16px" hidden>
<div class="part wide">
<div class="refdes">J0 · claude login</div>
<div class="lg-list" id="lgList"></div>
</div>
</section>`;

export const LOGIN_JS = `(function () {
  var root = document.getElementById("claudeLogin");
  var list = document.getElementById("lgList");
  if (!root || !list) return;
  var LABEL = { logged_in: "logged in", expiring: "expiring", expired_refreshable: "expired", logged_out: "logged out", unknown: "unknown" };
  var CLS = { logged_in: "s-idle", expiring: "s-waiting", expired_refreshable: "s-failed", logged_out: "s-failed", unknown: "s-closed" };
  var accounts = [];
  var flows = {};

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function api(method, path, body) {
    var opts = { method: method, cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } };
    if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.message || ("HTTP " + res.status)); e.status = res.status; throw e; }
        return data;
      });
    });
  }

  function expiryText(a) {
    if (!a.expiresAt) return "";
    var ms = Date.parse(a.expiresAt) - Date.now();
    var days = Math.round(Math.abs(ms) / 86400000);
    var d = new Date(a.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" });
    if (ms < 0) return "expired " + d;
    return "sign-in ends " + d + (days <= 7 ? " (" + (days < 1 ? "<1 day" : days + " d") + ")" : "");
  }

  function path(a) { return "/dashboard/api/accounts/" + encodeURIComponent(a.account) + "/login"; }

  function setFlow(a, f) { if (f) flows[a.account] = f; else delete flows[a.account]; draw(); }

  function start(a) {
    setFlow(a, { step: "starting" });
    api("POST", path(a), {}).then(function (r) {
      setFlow(a, { step: "code", url: r.url, loginId: r.loginId });
    }, function (e) { setFlow(a, { step: "error", message: e.message }); });
  }

  function submit(a, f, input) {
    var code = input.value.trim();
    if (!code) return;
    f.busy = true; f.message = ""; draw();
    api("POST", path(a) + "/" + encodeURIComponent(f.loginId), { code: code }).then(function () {
      setFlow(a, { step: "done" });
      load();
    }, function (e) {
      if (e.status === 409 || e.status === 422) setFlow(a, { step: "error", message: e.message });
      else { f.busy = false; f.message = e.message; draw(); }
    });
  }

  function flowView(a, f) {
    if (f.step === "starting") return h("p", { class: "lg-msg" }, "Starting login…");
    if (f.step === "done") return h("p", { class: "lg-msg ok" }, "Logged in. Agents on this account can run again.");
    if (f.step === "error") {
      return h("div", { class: "lg-steps" },
        h("p", { class: "lg-msg err" }, f.message || "Login failed."),
        h("div", null, h("button", { class: "lg-btn", type: "button", onclick: function () { start(a); } }, "Try again")));
    }
    var input = h("input", { type: "text", inputmode: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "Paste the code here", "aria-label": "Login code" });
    if (f.draft) input.value = f.draft;
    input.addEventListener("input", function () { f.draft = input.value; });
    return h("div", { class: "lg-steps" },
      h("p", null, "1. Sign in with Claude in a new tab, then copy the code it shows."),
      h("div", null, h("a", { class: "lg-btn primary", href: f.url, target: "_blank", rel: "noopener noreferrer" }, "Open Claude sign-in")),
      h("p", null, "2. Paste the code here."),
      h("form", { onsubmit: function (ev) { ev.preventDefault(); submit(a, f, input); } },
        input,
        h("button", { class: "lg-btn primary", type: "submit", disabled: !!f.busy }, f.busy ? "Checking…" : "Finish login")),
      f.message ? h("p", { class: "lg-msg err" }, f.message) : null,
      h("div", null, h("button", { class: "lg-btn", type: "button", onclick: function () { setFlow(a, null); } }, "Cancel")));
  }

  function draw() {
    var active = document.activeElement;
    var keep = active && active.tagName === "INPUT" && list.contains(active);
    var caret = keep ? active.selectionStart : 0;
    while (list.firstChild) list.removeChild(list.firstChild);
    accounts.forEach(function (a) {
      var f = flows[a.account];
      var exp = expiryText(a);
      var needs = a.status !== "logged_in";
      list.appendChild(h("div", { class: "lg-acct" },
        h("div", { class: "lg-top" },
          h("span", { class: "lg-name" }, a.account),
          h("span", { class: "pill " + (CLS[a.status] || "s-closed") }, LABEL[a.status] || a.status),
          a.subscriptionType ? h("span", { class: "badge" }, a.subscriptionType) : null,
          h("span", { class: "sp" }),
          !f ? h("button", { class: "lg-btn" + (needs ? " primary" : ""), type: "button", onclick: function () { start(a); } }, needs ? "Log in" : "Re-login") : null),
        h("div", { class: "sub" }, (a.agents.length > 1 ? "agents " : "agent ") + a.agents.join(", ") + (exp ? " · " + exp : "")),
        f ? flowView(a, f) : null));
    });
    if (keep) {
      var again = list.querySelector("input");
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) {} }
    }
  }

  function load() {
    return api("GET", "/dashboard/api/accounts").then(function (r) {
      accounts = r;
      root.hidden = r.length === 0;
      draw();
    }, function () {});
  }

  function busyFlow() { return Object.keys(flows).some(function (k) { return flows[k].step === "code" || flows[k].step === "starting"; }); }
  setInterval(function () { if (!document.hidden && !busyFlow()) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !busyFlow()) load(); });
  load();
})();`;
