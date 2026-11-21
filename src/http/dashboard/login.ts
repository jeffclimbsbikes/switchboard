import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Config } from "../../config.js";
import { type AccountError, type AccountsService, AccountError as Err } from "../../core/accounts.js";
import type { Caller } from "../../core/api.js";
import { resolveAccess } from "../../core/policy.js";

function sameOrigin(config: Config, req: Request): boolean {
  if (req.get("sec-fetch-site") && !["same-origin", "none"].includes(req.get("sec-fetch-site") as string)) {
    return false;
  }
  const claimed = req.get("origin") ?? req.get("referer");
  if (!claimed) return false;
  let url: URL;
  try {
    url = new URL(claimed);
  } catch {
    return false;
  }
  if (config.public_url && url.origin === new URL(config.public_url).origin) return true;
  return url.host === req.get("host");
}

/** Claude login routes under /dashboard/api/accounts. Mount after the dashboard's identity middleware. */
export function loginRouter(config: Config, accounts: AccountsService): Router {
  const router = express.Router();
  const callerOf = (res: Response) => res.locals.caller as Caller;

  const visible = (res: Response) => {
    const access = resolveAccess(config, callerOf(res));
    return accounts.accounts().filter((a) => a.agents.some((id) => access.agents.includes(id)));
  };

  const withAccount = (req: Request, res: Response, next: NextFunction) => {
    const account = visible(res).find((a) => a.id === req.params.account);
    if (!account) return void res.status(404).json({ error: "not_found", message: "no such account" });
    res.locals.account = account;
    next();
  };

  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (!sameOrigin(config, req)) {
      return void res.status(403).json({ error: "forbidden", message: "cross-origin request refused" });
    }
    if (!req.is("application/json")) {
      return void res.status(415).json({ error: "bad_input", message: "send application/json" });
    }
    next();
  };

  const body = express.json({ limit: "4kb" });

  const fail = (res: Response, err: unknown) => {
    if (err instanceof Err) {
      const e = err as AccountError;
      const status = e.code === "bad_input" ? 400 : e.code === "expired" ? 409 : 502;
      return void res.status(status).json({ error: e.code, message: e.message });
    }
    res.status(500).json({ error: "internal", message: "login failed" });
  };

  router.get("/dashboard/api/accounts", async (_req, res) => {
    res.json(await Promise.all(visible(res).map((a) => accounts.status(a))));
  });

  router.post("/dashboard/api/accounts/:account/login", guard, withAccount, body, async (_req, res) => {
    try {
      res.json(await accounts.startLogin(res.locals.account));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post(
    "/dashboard/api/accounts/:account/login/:loginId",
    guard,
    withAccount,
    body,
    async (req, res) => {
      const code = (req.body as { code?: unknown } | undefined)?.code;
      if (typeof code !== "string") {
        return void res.status(400).json({ error: "bad_input", message: "code must be a string" });
      }
      try {
        const outcome = await accounts.submitCode(res.locals.account, req.params.loginId as string, code);
        res.status(outcome.ok ? 200 : 422).json(outcome.ok ? { ok: true, account: outcome.info } : outcome);
      } catch (err) {
        fail(res, err);
      }
    },
  );

  router.use("/dashboard/api/accounts", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === "object" && "type" in err) {
      return void res.status(400).json({ error: "bad_input", message: "invalid JSON body" });
    }
    next(err);
  });

  return router;
}
