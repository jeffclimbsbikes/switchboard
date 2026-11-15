import type {} from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Db } from "../../db.js";
import { verifyAccess } from "./store.js";

export interface BearerOptions {
  db: Db;
  now: () => Date;
  resource: string;
  resourceMetadataUrl: string;
}

export function requireBearer(opts: BearerOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const challenge = (error?: string) => {
      const parts = error ? [`error="${error}"`] : [];
      parts.push(`resource_metadata="${opts.resourceMetadataUrl}"`);
      res.set("WWW-Authenticate", `Bearer ${parts.join(", ")}`);
      res
        .status(401)
        .json(
          error ? { error, error_description: "invalid or expired access token" } : { error: "unauthorized" },
        );
    };
    const header = req.header("authorization");
    if (!header) return challenge();
    const match = /^Bearer +(\S+)$/i.exec(header);
    if (!match) return challenge("invalid_token");
    const info = verifyAccess(opts.db, match[1] as string, opts.now().getTime());
    if (!info || info.resource !== opts.resource) return challenge("invalid_token");
    req.auth = {
      token: match[1] as string,
      clientId: info.clientId,
      scopes: info.scope.split(" ").filter(Boolean),
      expiresAt: Math.floor(info.expiresAt / 1000),
      resource: new URL(info.resource),
      extra: { email: info.email },
    };
    next();
  };
}
