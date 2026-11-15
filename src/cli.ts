#!/usr/bin/env node
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Config, defaultConfigPath, loadConfig, workspaces } from "./config.js";
import { createNotifier } from "./core/notifier.js";
import { SessionManager } from "./core/sessions.js";
import { openDb } from "./db.js";
import { createDrivers } from "./drivers/index.js";
import { createHttpApp, listGrants, revokeAll } from "./http/server.js";
import { createMcpServer, VERSION } from "./mcp/server.js";

const USAGE = `switchboard ${VERSION} — MCP control plane for coding-agent sessions

usage: switchboard <command> [--config <file>]

  serve    HTTP server (Streamable HTTP at /mcp, OAuth when configured)
  stdio    MCP over stdin/stdout, for local clients (Claude Code, Desktop)
  check    validate the config and look for the agent executables
  grants   list connected clients; --revoke signs them all out

config: --config, $SWITCHBOARD_CONFIG, or ~/.config/switchboard/config.toml`;

process.removeAllListeners("warning");
process.on("warning", (w: Error & { code?: string }) => {
  if (w.code !== "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" && w.name !== "ExperimentalWarning") console.error(w);
});

function log(...args: unknown[]) {
  console.error("[switchboard]", ...args);
}

function boot(config: Config) {
  const db = openDb(join(config.state_dir, "switchboard.db"));
  const manager = new SessionManager({
    config,
    db,
    drivers: createDrivers(config),
    notifier: createNotifier(config.notify),
  });
  manager.usage.start();
  return { db, manager };
}

export function splitListen(listen: string): { host: string; port: number } {
  const m = /^(?:\[(.+)\]|([^:]+)):(\d+)$/.exec(listen);
  if (!m) throw new Error(`listen must be host:port, got ${listen}`);
  return { host: (m[1] ?? m[2]) as string, port: Number(m[3]) };
}

function onPath(cmd: string): boolean {
  if (cmd.includes("/")) return existsSync(cmd);
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function check(config: Config): boolean {
  let ok = true;
  for (const [id, agent] of Object.entries(config.agents)) {
    const cmd =
      agent.driver === "claude"
        ? (agent.executable ?? "claude")
        : agent.driver === "acp"
          ? agent.command[0]
          : null;
    if (cmd === null || cmd === undefined) {
      console.log(`agent ${id}: ${agent.driver}`);
      continue;
    }
    const found = onPath(cmd);
    ok &&= found;
    console.log(`agent ${id}: ${agent.driver} → ${cmd} ${found ? "✓" : "✗ not found"}`);
  }
  for (const w of workspaces(config)) {
    let status: "ok" | "missing" | "unreadable";
    try {
      status = statSync(w.path).isDirectory() ? "ok" : "missing";
    } catch (err) {
      status = (err as NodeJS.ErrnoException).code === "EACCES" ? "unreadable" : "missing";
    }
    ok &&= status !== "missing";
    const mark = {
      ok: "✓",
      missing: "✗ missing",
      unreadable: "? not readable by this user (fine for run_as agents)",
    };
    console.log(`workspace ${w.id}: ${w.path} ${mark[status]}`);
  }
  console.log(
    `auth: ${config.auth.login} · listen ${config.listen}${config.public_url ? ` · ${config.public_url}` : ""}`,
  );
  return ok;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      revoke: { type: "boolean" },
    },
  });
  if (values.version) return console.log(VERSION);
  const command = positionals[0];
  if (values.help || !command) return console.log(USAGE);
  const config = loadConfig(values.config ?? defaultConfigPath());

  if (command === "check") {
    process.exitCode = check(config) ? 0 : 1;
    return;
  }

  if (command === "grants") {
    const db = openDb(join(config.state_dir, "switchboard.db"));
    if (values.revoke) return console.log(`revoked ${revokeAll(db)} token(s)`);
    const grants = listGrants(db);
    if (!grants.length) return console.log("no active grants");
    for (const g of grants) console.log(JSON.stringify(g));
    return;
  }

  if (command === "stdio") {
    const { manager } = boot(config);
    const server = createMcpServer(manager, { maxWaitMs: config.max_wait });
    await server.connect(new StdioServerTransport());
    const stop = async () => {
      await manager.shutdown();
      process.exit(0);
    };
    process.stdin.on("end", stop);
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return;
  }

  if (command === "serve") {
    const { db, manager } = boot(config);
    const app = createHttpApp({
      config,
      db,
      createMcpServer: () => createMcpServer(manager, { maxWaitMs: config.max_wait }),
      dashboard: manager,
    });
    const { host, port } = splitListen(config.listen);
    const server = app.listen(port, host, () =>
      log(`listening on http://${config.listen} (auth: ${config.auth.login})`),
    );
    const stop = async () => {
      log("shutting down");
      server.close();
      await manager.shutdown();
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return;
  }

  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  log(err instanceof Error ? err.message : err);
  process.exit(1);
});
