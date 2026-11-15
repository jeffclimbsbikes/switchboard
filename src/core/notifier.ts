import { spawn as nodeSpawn } from "node:child_process";
import type { NotifyConfig } from "../config.js";

export interface Notification {
  session: string;
  kind: "done" | "waiting" | "failed";
  text: string;
}

export interface Notifier {
  notify(n: Notification): Promise<void>;
}

export const nullNotifier: Notifier = { async notify() {} };

export interface NotifierDeps {
  fetch?: typeof fetch;
  spawn?: typeof nodeSpawn;
  env?: NodeJS.ProcessEnv;
}

export function createNotifier(config: NotifyConfig, deps: NotifierDeps = {}): Notifier {
  const doFetch = deps.fetch ?? fetch;
  const doSpawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const channels: ((n: Notification, message: string) => Promise<void>)[] = [];

  if (config.telegram) {
    const { token_env, chat } = config.telegram;
    channels.push(async (_n, message) => {
      const token = env[token_env];
      if (!token) throw new Error(`telegram: ${token_env} is not set`);
      const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: message }),
      });
      if (!res.ok) throw new Error(`telegram: HTTP ${res.status}`);
    });
  }

  if (config.ntfy) {
    const { url } = config.ntfy;
    channels.push(async (_n, message) => {
      const res = await doFetch(url, { method: "POST", body: message });
      if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
    });
  }

  if (config.command) {
    const [cmd, ...args] = config.command as [string, ...string[]];
    channels.push(
      (n, message) =>
        new Promise<void>((resolve, reject) => {
          const child = doSpawn(cmd, args, {
            env: { ...env, SWITCHBOARD_SESSION: n.session, SWITCHBOARD_KIND: n.kind },
            stdio: ["pipe", "ignore", "ignore"],
          });
          child.once("error", reject);
          child.once("close", () => resolve());
          child.stdin?.on("error", () => {});
          child.stdin?.end(message);
        }),
    );
  }

  if (channels.length === 0) return nullNotifier;

  return {
    async notify(n) {
      const message = `${n.session} ${n.kind}: ${n.text}`;
      await Promise.all(
        channels.map(async (send) => {
          try {
            await send(n, message);
          } catch (err) {
            console.error(`switchboard: notification failed: ${err instanceof Error ? err.message : err}`);
          }
        }),
      );
    },
  };
}
