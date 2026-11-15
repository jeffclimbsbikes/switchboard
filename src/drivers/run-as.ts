import { type ChildProcess, spawn } from "node:child_process";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

export interface RunAsOptions {
  user: string;
  sudoPath?: string;
}

export interface Invocation {
  command: string;
  args: string[];
}

const PASSTHROUGH = /^(CLAUDE_|ANTHROPIC_|SWITCHBOARD_)/;

export function passthroughEnv(
  env: Record<string, string | undefined>,
  explicit: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (key === "PATH" || PASSTHROUGH.test(key))) out[key] = value;
  }
  return { ...out, ...explicit };
}

/** sudo drops the environment, so it is re-injected through `env`; HOME comes from `-H`. */
export function runAsInvocation(
  run: RunAsOptions,
  target: { cwd: string; command: string; args: string[]; env: Record<string, string> },
): Invocation {
  return {
    command: run.sudoPath ?? "sudo",
    args: [
      "-n",
      "-u",
      run.user,
      "-H",
      "--",
      "env",
      ...Object.entries(target.env).map(([k, v]) => `${k}=${v}`),
      "bash",
      "-c",
      'cd "$0" && exec "$@"',
      target.cwd,
      target.command,
      ...target.args,
    ],
  };
}

export function spawnClaudeAs(
  run: RunAsOptions,
  cwd: string,
  explicitEnv: Record<string, string>,
): (options: SpawnOptions) => SpawnedProcess {
  return (options) => {
    const inv = runAsInvocation(run, {
      cwd,
      command: options.command,
      args: options.args,
      env: passthroughEnv(options.env, explicitEnv),
    });
    const child: ChildProcess = spawn(inv.command, inv.args, {
      cwd: "/",
      signal: options.signal,
      stdio: ["pipe", "pipe", "inherit"],
    });
    return child as unknown as SpawnedProcess;
  };
}
