import type { Config } from "../config.js";
import { AcpDriver } from "./acp.js";
import { ClaudeDriver } from "./claude.js";
import type { Driver } from "./driver.js";
import { FakeDriver } from "./fake.js";

export function createDrivers(config: Config): Record<string, Driver> {
  const drivers: Record<string, Driver> = {};
  for (const [id, agent] of Object.entries(config.agents)) {
    switch (agent.driver) {
      case "claude":
        drivers[id] = new ClaudeDriver({
          ...(agent.executable ? { executable: agent.executable } : {}),
          ...(agent.model ? { model: agent.model } : {}),
          permissionMode: agent.permission_mode,
          ...(agent.append_system_prompt ? { appendSystemPrompt: agent.append_system_prompt } : {}),
          ...(agent.run_as ? { runAs: agent.run_as } : {}),
        });
        break;
      case "acp":
        drivers[id] = new AcpDriver({
          command: agent.command,
          env: agent.env,
          ...(agent.model ? { model: agent.model } : {}),
          ...(agent.run_as ? { runAs: agent.run_as } : {}),
        });
        break;
      case "fake":
        drivers[id] = new FakeDriver();
        break;
    }
  }
  return drivers;
}
