import type { Response } from "express";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const STYLE = `
  :root{color-scheme:light dark;--bg:#f6f6f4;--fg:#1c1c1a;--muted:#6b6b66;--card:#fff;--line:#dcdcd6;--accent:#1c1c1a;--accent-fg:#fff}
  @media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ececE8;--muted:#9a9a93;--card:#202020;--line:#35352f;--accent:#ececE8;--accent-fg:#161614}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
  main{box-sizing:border-box;width:min(28rem,100% - 2rem);padding:1.75rem;background:var(--card);border:1px solid var(--line);border-radius:12px}
  h1{font-size:1.2rem;margin:0 0 .75rem}p{margin:.5rem 0}.muted{color:var(--muted);font-size:.9rem}
  .row{display:flex;gap:.75rem;margin-top:1.5rem}
  button{flex:1;font:inherit;padding:.6rem 1rem;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
  button.allow{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
  code{word-break:break-all}`;

function page(res: Response, status: number, title: string, body: string): void {
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    })
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
    );
}

export function errorPage(res: Response, status: number, message: string): void {
  page(res, status, "switchboard", `<h1>Something went wrong</h1><p>${escapeHtml(message)}</p>`);
}

export function accessRequiredPage(res: Response): void {
  page(
    res,
    403,
    "Access required",
    `<h1>Sign-in required</h1><p>This page must be opened through Cloudflare Access, with an account that is on the allow list.</p><p class="muted">Start the connection again from your MCP client, and sign in when Cloudflare asks.</p>`,
  );
}

export interface ConsentView {
  clientName: string;
  redirectHost: string;
  serverHost: string;
  email: string;
  pendingId: string;
  csrf: string;
}

export function consentPage(res: Response, v: ConsentView): void {
  const label = v.clientName || v.redirectHost;
  const detail =
    v.clientName && v.clientName !== v.redirectHost
      ? `<p class="muted">Returns to <code>${escapeHtml(v.redirectHost)}</code></p>`
      : "";
  page(
    res,
    200,
    "Authorize switchboard",
    `<h1>Allow ${escapeHtml(label)} to use switchboard on ${escapeHtml(v.serverHost)}?</h1>
<p>Signed in as <strong>${escapeHtml(v.email)}</strong></p>${detail}
<form method="post" action="/authorize">
<input type="hidden" name="pending" value="${escapeHtml(v.pendingId)}"><input type="hidden" name="csrf" value="${escapeHtml(v.csrf)}">
<div class="row"><button name="decision" value="deny" type="submit">Deny</button><button class="allow" name="decision" value="allow" type="submit">Allow</button></div>
</form>`,
  );
}
