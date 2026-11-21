import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import { runAsInvocation } from "../drivers/run-as.js";

export const SELF = "self";

export type AccountStatusKind = "logged_in" | "expiring" | "expired_refreshable" | "logged_out" | "unknown";

export interface Account {
  id: string;
  executable: string;
  agents: string[];
}

export interface AccountInfo {
  account: string;
  agents: string[];
  status: AccountStatusKind;
  expiresAt?: string;
  subscriptionType?: string;
}

export interface LoginStart {
  loginId: string;
  url: string;
}

export type LoginOutcome = { ok: true; info: AccountInfo } | { ok: false; error: string };

export type AccountErrorCode = "not_found" | "bad_input" | "no_url" | "expired";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AccountsOptions {
  config: Config;
  sudoPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  urlTimeoutMs?: number;
  loginTtlMs?: number;
  codeTimeoutMs?: number;
  statusTimeoutMs?: number;
  expiringWithinMs?: number;
}

const URL_HOSTS = ["claude.com", "claude.ai", "anthropic.com"];
const CODE_SHAPE = /^[A-Za-z0-9._~#:+/=-]{1,2048}$/;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const OUTPUT_CAP = 32_768;

/** One account per Unix user an agent's Claude Code runs as; `self` is the switchboard user. */
export function deriveAccounts(config: Config): Account[] {
  const byId = new Map<string, Account>();
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (agent.driver !== "claude") continue;
    const id = agent.run_as ?? SELF;
    const account = byId.get(id) ?? { id, executable: agent.executable ?? "claude", agents: [] };
    account.agents.push(agentId);
    byId.set(id, account);
  }
  return [...byId.values()];
}

export function parseAuthorizeUrl(output: string): string | undefined {
  const clean = output.replace(ANSI, "");
  for (const match of clean.matchAll(/https:\/\/[^\s"'<>\\]+/g)) {
    try {
      const url = new URL(match[0]);
      const host = url.hostname.toLowerCase();
      if (URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return url.toString();
    } catch {}
  }
  return undefined;
}

interface ActiveLogin {
  id: string;
  account: string;
  child: ChildProcess;
  state: "awaiting_code" | "submitting" | "finished";
  exited: Promise<number | null>;
  timer: NodeJS.Timeout;
}

/** Reads each account's Claude login status and drives its headless `claude auth login`. Never keeps or returns tokens. */
export class AccountsService {
  private readonly accountList: Account[];
  private readonly logins = new Map<string, ActiveLogin>();
  private readonly o: Required<Omit<AccountsOptions, "config" | "sudoPath" | "env">> &
    Pick<AccountsOptions, "sudoPath" | "env">;

  constructor(options: AccountsOptions) {
    this.accountList = deriveAccounts(options.config);
    this.o = {
      now: Date.now,
      urlTimeoutMs: 15_000,
      loginTtlMs: 600_000,
      codeTimeoutMs: 45_000,
      statusTimeoutMs: 10_000,
      expiringWithinMs: 3 * 86_400_000,
      ...options,
    };
  }

  accounts(): Account[] {
    return this.accountList;
  }

  find(id: string): Account | undefined {
    return this.accountList.find((a) => a.id === id);
  }

  private command(account: Account, args: string[]) {
    const env = this.o.env ?? process.env;
    if (account.id === SELF) return { command: account.executable, args, env };
    const inv = runAsInvocation(
      { user: account.id, ...(this.o.sudoPath ? { sudoPath: this.o.sudoPath } : {}) },
      { cwd: "/", command: account.executable, args, env: { PATH: env.PATH ?? "/usr/bin:/bin" } },
    );
    return { command: inv.command, args: inv.args, env };
  }

  async status(account: Account): Promise<AccountInfo> {
    const base = { account: account.id, agents: account.agents };
    const out = await this.statusJson(account);
    if (!out) return { ...base, status: "unknown" };
    const expires = typeof out.loginExpiresAt === "string" ? Date.parse(out.loginExpiresAt) : Number.NaN;
    const subscription = typeof out.subscriptionType === "string" ? out.subscriptionType : undefined;
    const extra = {
      ...(Number.isFinite(expires) && { expiresAt: new Date(expires).toISOString() }),
      ...(subscription && { subscriptionType: subscription }),
    };
    if (out.loggedIn !== true) {
      return {
        ...base,
        status: out.storedClaudeAiLogin === true ? "expired_refreshable" : "logged_out",
        ...extra,
      };
    }
    const soon = Number.isFinite(expires) && expires - this.o.now() < this.o.expiringWithinMs;
    return { ...base, status: soon ? "expiring" : "logged_in", ...extra };
  }

  private statusJson(account: Account): Promise<Record<string, unknown> | undefined> {
    const cmd = this.command(account, ["auth", "status", "--json"]);
    return new Promise((resolve) => {
      let out = "";
      let settled = false;
      const done = (value: Record<string, unknown> | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const child = spawn(cmd.command, cmd.args, {
        cwd: "/",
        env: cmd.env,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done(undefined);
      }, this.o.statusTimeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        if (out.length < OUTPUT_CAP) out += d.toString("utf8");
      });
      child.on("error", () => done(undefined));
      child.on("close", () => {
        try {
          const parsed: unknown = JSON.parse(out);
          done(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined);
        } catch {
          done(undefined);
        }
      });
    });
  }

  async startLogin(account: Account): Promise<LoginStart> {
    this.endLogin(account.id);
    const cmd = this.command(account, ["auth", "login", "--claudeai"]);
    const child = spawn(cmd.command, cmd.args, { cwd: "/", env: cmd.env, stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", (code) => resolve(code));
    });
    child.stdin.on("error", () => {});
    const login: ActiveLogin = {
      id: randomUUID(),
      account: account.id,
      child,
      state: "awaiting_code",
      exited,
      timer: setTimeout(() => this.endLogin(account.id), this.o.loginTtlMs),
    };
    login.timer.unref();
    void exited.then(() => {
      clearTimeout(login.timer);
      if (this.logins.get(account.id) === login && login.state !== "submitting") {
        this.logins.delete(account.id);
      }
    });
    this.logins.set(account.id, login);

    let buffer = "";
    const url = await new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), this.o.urlTimeoutMs);
      const onData = (d: Buffer) => {
        if (buffer.length < OUTPUT_CAP) buffer += d.toString("utf8");
        const found = parseAuthorizeUrl(buffer);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      void exited.then(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
    child.stdout.removeAllListeners("data");
    child.stderr.removeAllListeners("data");
    child.stdout.resume();
    child.stderr.resume();
    if (!url) {
      this.endLogin(account.id);
      throw new AccountError("no_url", "Claude did not print a sign-in link");
    }
    return { loginId: login.id, url };
  }

  async submitCode(account: Account, loginId: string, code: string): Promise<LoginOutcome> {
    const login = this.logins.get(account.id);
    if (!login || login.id !== loginId || login.state !== "awaiting_code") {
      throw new AccountError("expired", "This login is no longer active. Start it again.");
    }
    const trimmed = code.trim();
    if (!CODE_SHAPE.test(trimmed))
      throw new AccountError("bad_input", "That does not look like a login code");
    login.state = "submitting";
    login.child.stdin?.write(`${trimmed}\n`);
    const timeout = new Promise<"timeout">((resolve) => {
      const t = setTimeout(() => resolve("timeout"), this.o.codeTimeoutMs);
      t.unref();
      void login.exited.then(() => clearTimeout(t));
    });
    const result = await Promise.race([login.exited, timeout]);
    login.state = "finished";
    if (this.logins.get(account.id) === login) this.logins.delete(account.id);
    if (result === "timeout") {
      login.child.kill("SIGKILL");
      return { ok: false, error: "Claude took too long to accept the code. Start the login again." };
    }
    const info = await this.status(account);
    if (result === 0 && (info.status === "logged_in" || info.status === "expiring"))
      return { ok: true, info };
    return { ok: false, error: "Claude rejected the code. Start the login again and use a fresh code." };
  }

  endLogin(accountId: string): void {
    const login = this.logins.get(accountId);
    if (!login) return;
    this.logins.delete(accountId);
    clearTimeout(login.timer);
    login.state = "finished";
    login.child.stdin?.end();
    login.child.kill("SIGTERM");
    const kill = setTimeout(() => login.child.kill("SIGKILL"), 2000);
    kill.unref();
    void login.exited.then(() => clearTimeout(kill));
  }

  activeLogins(): number {
    return this.logins.size;
  }

  close(): void {
    for (const id of [...this.logins.keys()]) this.endLogin(id);
  }
}
