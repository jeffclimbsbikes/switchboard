import { tmpdir } from "node:os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeProbeResult {
  subscriptionType?: string;
  /** False for API-key, Bedrock and Vertex sessions, where plan limits do not apply. */
  available: boolean;
  /** utilization is 0..1. */
  windows: { window: string; utilization?: number; resetsAt?: string }[];
}

export interface ClaudeProbeOptions {
  executable?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

interface RawWindow {
  utilization: number | null;
  resets_at: string | null;
}

const NAMED = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;

/**
 * EXPERIMENTAL: reads the plan windows through the SDK's unstable usage control
 * request (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`). It
 * opens a query without ever sending a prompt, so no tokens are spent, and
 * closes it again. Callers must treat any rejection as "unknown".
 */
export async function probeClaudeUsage(options: ClaudeProbeOptions = {}): Promise<ClaudeProbeResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 30_000);
  timer.unref?.();
  const silence: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          abort.signal.addEventListener("abort", () => resolve({ value: undefined, done: true }), {
            once: true,
          });
        }),
    }),
  };
  const q = query({
    prompt: silence,
    options: {
      cwd: tmpdir(),
      ...(options.executable ? { pathToClaudeCodeExecutable: options.executable } : {}),
      env: { ...process.env, ...options.env } as Record<string, string>,
      abortController: abort,
    },
  });
  try {
    const res = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise<never>((_, reject) => {
        abort.signal.addEventListener("abort", () => reject(new Error("usage probe timed out")), {
          once: true,
        });
      }),
    ]);
    const limits = res.rate_limits as Record<string, unknown> | null;
    const windows: ClaudeProbeResult["windows"] = [];
    const push = (window: string, raw: RawWindow | null | undefined) => {
      if (!raw) return;
      windows.push({
        window,
        ...(typeof raw.utilization === "number" && { utilization: raw.utilization / 100 }),
        ...(raw.resets_at && { resetsAt: raw.resets_at }),
      });
    };
    if (limits) {
      for (const name of NAMED) push(name, limits[name] as RawWindow | null | undefined);
      const scoped = limits.model_scoped as (RawWindow & { display_name: string })[] | undefined;
      for (const m of scoped ?? []) push(`model:${m.display_name}`, m);
    }
    return {
      available: res.rate_limits_available && limits !== null,
      ...(res.subscription_type && { subscriptionType: res.subscription_type }),
      windows,
    };
  } finally {
    clearTimeout(timer);
    try {
      q.close();
    } catch {}
    abort.abort();
  }
}
