import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express, { type Request, type Response, type Router } from "express";
import type { Config } from "../../config.js";
import { type Caller, type DashboardApi, SwitchboardError } from "../../core/api.js";
import type { Db } from "../../db.js";
import { VERSION } from "../../mcp/server.js";
import type { Identify } from "../auth/identity.js";
import { accessRequiredPage } from "../auth/pages.js";
import { listGrants } from "../auth/store.js";
import { contractReader } from "./contract.js";
import { DASHBOARD_HTML } from "./page.js";

export interface DashboardDeps {
  config: Config;
  db: Db;
  dashboard: DashboardApi;
  createMcpServer: () => McpServer;
  identify: Identify;
  now: () => Date;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function configSummary(config: Config, restricted: boolean) {
  const auth = config.auth;
  const channels = [
    ...(config.notify.telegram ? ["telegram"] : []),
    ...(config.notify.ntfy ? ["ntfy"] : []),
    ...(config.notify.command ? ["command"] : []),
  ];
  return {
    listen: config.listen,
    publicUrl: config.public_url ?? null,
    maxWaitMs: config.max_wait,
    idleParkAfterMs: config.idle_park_after,
    maxLiveSessions: config.max_live_sessions,
    auth: {
      login: auth.login,
      ...(!restricted &&
        auth.login === "cloudflare-access" && { team: auth.team, allowed: auth.allow.length }),
      ...(!restricted && auth.login === "dev" && { email: auth.email }),
    },
    notify: { channels, nagAfterMs: config.notify.nag_after },
  };
}

function parseSince(raw: unknown): number | undefined | "bad" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return "bad";
  return Number(raw);
}

export function dashboardRouter(deps: DashboardDeps): Router {
  const { config, db, dashboard } = deps;
  const router = express.Router();
  const contract = contractReader(deps.createMcpServer);
  const callerOf = (res: Response) => res.locals.caller as Caller;

  router.use("/dashboard", async (req, res, next) => {
    res.set(SECURITY_HEADERS);
    if (config.auth.login === "none") {
      res.locals.caller = {};
      return next();
    }
    const email = await deps.identify(req);
    if (email) {
      res.locals.caller = { email };
      return next();
    }
    if (req.path.startsWith("/api/")) return void res.status(403).json({ error: "forbidden" });
    accessRequiredPage(res);
  });

  router.get("/dashboard", (_req, res) => {
    res.set({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP });
    res.send(DASHBOARD_HTML);
  });

  router.get("/dashboard/api/state", async (req: Request, res: Response) => {
    const caller = callerOf(res);
    dashboard.touchUsage?.();
    const snapshot = dashboard.snapshot(caller);
    const { restricted } = snapshot.viewer;
    const withTools = req.query.tools !== "0";
    let mcp: Awaited<ReturnType<typeof contract>> | null = null;
    let mcpError: string | undefined;
    if (withTools) {
      try {
        mcp = await contract();
      } catch (err) {
        mcpError = err instanceof Error ? err.message : String(err);
      }
    }
    const grants =
      restricted || config.auth.login === "none"
        ? []
        : listGrants(db, deps.now().getTime()).map((g) => ({
            clientName: g.clientName,
            clientId: g.clientId,
            email: g.email,
            createdAt: g.createdAt.toISOString(),
            expiresAt: g.expiresAt.toISOString(),
          }));
    res.json({
      version: VERSION,
      now: deps.now().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      config: configSummary(config, restricted),
      ...snapshot,
      grants,
      ...(withTools && { mcp, ...(mcpError && { mcpError }) }),
    });
  });

  router.get("/dashboard/api/sessions/:name", (req, res) => {
    const since = parseSince(req.query.since);
    const rawLimit = req.query.limit;
    if (since === "bad" || (rawLimit !== undefined && !/^\d+$/.test(String(rawLimit)))) {
      return void res.status(400).json({ error: "bad_input", message: "since and limit must be integers" });
    }
    try {
      res.json(
        dashboard.detail(
          req.params.name as string,
          {
            ...(since !== undefined && { since }),
            ...(rawLimit !== undefined && { limit: Number(rawLimit) }),
          },
          callerOf(res),
        ),
      );
    } catch (err) {
      if (err instanceof SwitchboardError && err.code === "not_found") {
        return void res.status(404).json({ error: "not_found", message: err.message });
      }
      throw err;
    }
  });

  return router;
}
