import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

const duration = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+(ms|s|m|h)$/)])
  .transform((v) => (typeof v === "number" ? v : parseDuration(v)));

export function parseDuration(text: string): number {
  const m = /^(\d+)(ms|s|m|h)$/.exec(text);
  if (!m) throw new Error(`bad duration: ${text}`);
  const n = Number(m[1]);
  const unit = m[2] as "ms" | "s" | "m" | "h";
  return n * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit];
}

const path = z.string().transform(expandHome);

const description = z.string().max(300).optional();

const unixUser = z.string().regex(/^[a-z_][a-z0-9_-]*\$?$/i, "not a valid Unix username");

const claudeAgent = z.object({
  driver: z.literal("claude"),
  executable: path.optional(),
  model: z.string().optional(),
  permission_mode: z
    .enum(["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "auto"])
    .default("default"),
  append_system_prompt: z.string().optional(),
  run_as: unixUser.optional(),
  description,
  default: z.boolean().default(false),
});

const acpAgent = z.object({
  driver: z.literal("acp"),
  command: z.array(z.string()).min(1),
  env: z.record(z.string(), z.string()).default({}),
  model: z.string().optional(),
  run_as: unixUser.optional(),
  description,
  default: z.boolean().default(false),
});

const fakeAgent = z.object({
  driver: z.literal("fake"),
  description,
  default: z.boolean().default(false),
});

const agent = z.discriminatedUnion("driver", [claudeAgent, acpAgent, fakeAgent]);

const workspace = z.union([path, z.object({ path, description, default: z.boolean().default(false) })]);

const auth = z.discriminatedUnion("login", [
  z.object({ login: z.literal("none") }),
  z.object({
    login: z.literal("cloudflare-access"),
    team: z.string().min(1),
    aud: z.string().min(1),
    allow: z.array(z.string().email()).min(1),
  }),
  /** For local development only: every /authorize is approved as `email`. Refused unless listening on loopback. */
  z.object({ login: z.literal("dev"), email: z.string().email() }),
]);

const notify = z
  .object({
    telegram: z.object({ token_env: z.string().default("TELEGRAM_BOT_TOKEN"), chat: z.string() }).optional(),
    ntfy: z.object({ url: z.string().url() }).optional(),
    command: z.array(z.string()).min(1).optional(),
    nag_after: duration.default(600_000),
  })
  .default({ nag_after: 600_000 });

const user = z.object({
  agents: z.array(z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
  notify_chat: z.string().optional(),
});

const users = z
  .record(z.string(), user)
  .default({})
  .transform((u) => Object.fromEntries(Object.entries(u).map(([email, v]) => [email.toLowerCase(), v])));

export const configSchema = z
  .object({
    listen: z.string().default("127.0.0.1:8787"),
    public_url: z.string().url().optional(),
    state_dir: path.default(join(homedir(), ".local", "state", "switchboard")),
    max_wait: duration.default(25_000),
    idle_park_after: duration.default(1_800_000),
    max_live_sessions: z.number().int().positive().default(4),
    agents: z
      .record(z.string(), agent)
      .refine((a) => Object.keys(a).length > 0, "configure at least one agent"),
    workspaces: z
      .record(z.string(), workspace)
      .refine((w) => Object.keys(w).length > 0, "configure at least one workspace"),
    auth: auth.default({ login: "none" }),
    notify,
    users,
  })
  .superRefine((config, ctx) => {
    const workspaceIds = Object.keys(config.workspaces);
    for (const [email, u] of Object.entries(config.users)) {
      for (const id of u.agents ?? []) {
        if (!(id in config.agents)) {
          ctx.addIssue({
            code: "custom",
            path: ["users", email, "agents"],
            message: `unknown agent "${id}"; configured: ${Object.keys(config.agents).join(", ")}`,
          });
        }
      }
      for (const id of u.workspaces ?? []) {
        if (!workspaceIds.includes(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["users", email, "workspaces"],
            message: `unknown workspace "${id}"; configured: ${workspaceIds.join(", ")}`,
          });
        }
      }
    }
  });

export type RawConfig = z.input<typeof configSchema>;
export type Config = z.output<typeof configSchema>;
export type AgentConfig = z.output<typeof agent>;
export type AuthConfig = z.output<typeof auth>;
export type NotifyConfig = z.output<typeof notify>;

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`invalid switchboard config:\n${lines.join("\n")}`);
  }
  return result.data;
}

export function loadConfig(file: string): Config {
  return parseConfig(parseToml(readFileSync(resolve(file), "utf8")));
}

export function defaultConfigPath(): string {
  return process.env.SWITCHBOARD_CONFIG ?? join(homedir(), ".config", "switchboard", "config.toml");
}

export function defaultAgentId(config: Config): string {
  const entries = Object.entries(config.agents);
  return (entries.find(([, a]) => a.default) ?? entries[0])?.[0] as string;
}

export function workspaces(
  config: Config,
): { id: string; path: string; description?: string; default: boolean }[] {
  const list = Object.entries(config.workspaces).map(([id, w]) =>
    typeof w === "string"
      ? { id, path: w, default: false }
      : {
          id,
          path: w.path,
          ...(w.description ? { description: w.description } : {}),
          default: w.default,
        },
  );
  if (list.length > 0 && !list.some((w) => w.default)) (list[0] as { default: boolean }).default = true;
  return list;
}
