import { isIP } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { JWTVerifyGetKey } from "jose";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { requireBearer } from "./auth/bearer.js";
import { ClientResolver } from "./auth/clients.js";
import { createIdentify } from "./auth/identity.js";
import { canonicalResource, metadataRouter, oauthRouter } from "./auth/oauth.js";
import { migrate } from "./auth/store.js";

export { listGrants, revokeAll } from "./auth/store.js";

export interface HttpAppOptions {
  config: Config;
  db: Db;
  createMcpServer: () => McpServer;
  now?: () => Date;
  accessKeys?: JWTVerifyGetKey;
  fetch?: typeof fetch;
}

export function listenHost(listen: string): string {
  const bracket = /^\[([^\]]+)\]/.exec(listen);
  if (bracket) return bracket[1] as string;
  const i = listen.lastIndexOf(":");
  return i === -1 ? listen : listen.slice(0, i);
}

export function isLoopbackHost(host: string): boolean {
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.startsWith("127.");
  return host === "::1";
}

export function createHttpApp(opts: HttpAppOptions): express.Express {
  const { config, db } = opts;
  const now = opts.now ?? (() => new Date());
  const auth = config.auth;
  const host = listenHost(config.listen);

  if (auth.login !== "cloudflare-access" && !isLoopbackHost(host)) {
    throw new Error(
      `auth.login = "${auth.login}" is only allowed when listening on loopback (listen = ${config.listen})`,
    );
  }
  if (auth.login !== "none" && !config.public_url) {
    throw new Error(`public_url is required when auth.login = "${auth.login}"`);
  }

  const app = express();
  app.disable("x-powered-by");

  const mcpHandlers: express.RequestHandler[] = [];

  if (auth.login !== "none") {
    migrate(db);
    const issuer = (config.public_url as string).replace(/\/+$/, "");
    const resource = canonicalResource(`${issuer}/mcp`) as string;
    app.use(metadataRouter(issuer, resource));
    app.use(
      oauthRouter({
        db,
        now,
        issuer,
        resource,
        loginMode: auth.login,
        identify: createIdentify(auth, { accessKeys: opts.accessKeys, now }),
        clients: new ClientResolver(db, now, opts.fetch),
      }),
    );
    mcpHandlers.push(
      requireBearer({
        db,
        now,
        resource,
        resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
      }),
    );
  }

  app.post("/mcp", ...mcpHandlers, express.json({ limit: "4mb" }), async (req, res) => {
    const server = opts.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.all("/mcp", (_req, res) => {
    res
      .status(405)
      .set("Allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      });
  });

  return app;
}
