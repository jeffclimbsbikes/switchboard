import type { Request } from "express";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AuthConfig } from "../../config.js";

export type Identify = (req: Request) => Promise<string | undefined>;

export interface IdentityOptions {
  accessKeys?: JWTVerifyGetKey;
  now: () => Date;
}

export function createIdentify(auth: AuthConfig, opts: IdentityOptions): Identify {
  if (auth.login === "dev") {
    const email = auth.email.toLowerCase();
    return async () => email;
  }
  if (auth.login === "cloudflare-access") {
    const issuer = `https://${auth.team}.cloudflareaccess.com`;
    const keys = opts.accessKeys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const allow = new Set(auth.allow.map((e) => e.toLowerCase()));
    return async (req) => {
      const token = req.header("cf-access-jwt-assertion");
      if (!token) return undefined;
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience: auth.aud,
          currentDate: opts.now(),
        });
        const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
        return email && allow.has(email) ? email : undefined;
      } catch {
        return undefined;
      }
    };
  }
  return async () => undefined;
}
