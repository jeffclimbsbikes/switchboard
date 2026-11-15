import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { createNotifier, nullNotifier } from "../../src/core/notifier.js";

const notifyConfig = (notify: Record<string, unknown>) =>
  parseConfig({ agents: { a: { driver: "fake" } }, workspaces: { w: "/tmp" }, notify }).notify;

const n = { session: "otter", kind: "done", text: "all good" } as const;

describe("createNotifier", () => {
  it("posts to telegram with the token from the env", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const notifier = createNotifier(notifyConfig({ telegram: { chat: "42", token_env: "TOK" } }), {
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: { TOK: "abc" },
    });
    await notifier.notify(n);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botabc/sendMessage");
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: "42", text: "otter done: all good" });
  });

  it("posts text to ntfy", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 200 }));
    const notifier = createNotifier(notifyConfig({ ntfy: { url: "https://ntfy.example/topic" } }), {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await notifier.notify({ ...n, kind: "waiting", text: "which db?" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example/topic");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("otter waiting: which db?");
  });

  it("runs the command with the message on stdin and env set", async () => {
    let written = "";
    const child = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), {
        end: (s: string) => {
          written = s;
          queueMicrotask(() => child.emit("close", 0));
        },
      }),
    });
    const fake = vi.fn(() => child);
    const notifier = createNotifier(notifyConfig({ command: ["notify-send", "-u", "low"] }), {
      spawn: fake as unknown as typeof spawn,
      env: { PATH: "/bin" },
    });
    await notifier.notify(n);
    const [cmd, args, opts] = fake.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(cmd).toBe("notify-send");
    expect(args).toEqual(["-u", "low"]);
    expect(opts.env).toMatchObject({ SWITCHBOARD_SESSION: "otter", SWITCHBOARD_KIND: "done", PATH: "/bin" });
    expect(written).toBe("otter done: all good");
  });

  it("logs failures instead of throwing, and still tries the other channels", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("telegram")) throw new Error("network down");
      return new Response("", { status: 200 });
    });
    const notifier = createNotifier(
      notifyConfig({ telegram: { chat: "1" }, ntfy: { url: "https://ntfy.example/t" } }),
      { fetch: fetch as unknown as typeof globalThis.fetch, env: { TELEGRAM_BOT_TOKEN: "t" } },
    );
    await expect(notifier.notify(n)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("logs a missing telegram token", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn();
    const notifier = createNotifier(notifyConfig({ telegram: { chat: "1" } }), {
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: {},
    });
    await notifier.notify(n);
    expect(fetch).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("is a no-op when nothing is configured", async () => {
    expect(createNotifier(notifyConfig({}))).toBe(nullNotifier);
    await expect(nullNotifier.notify(n)).resolves.toBeUndefined();
  });
});

describe("notifier retries", () => {
  it("retries a network failure once", async () => {
    const { createNotifier } = await import("../../src/core/notifier.js");
    let calls = 0;
    const fetchStub = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const n = createNotifier(
      { telegram: { token_env: "T", chat: "1" }, nag_after: 600_000 },
      { fetch: fetchStub, env: { T: "123:abc" }, retryDelayMs: 1 },
    );
    await n.notify({ session: "otter", kind: "done", text: "hi" });
    expect(calls).toBe(2);
  });
});
