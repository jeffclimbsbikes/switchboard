import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { ScriptedDriver } from "../core/scripted-driver.js";

const managers: SessionManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});

async function connect(extra: Record<string, unknown> = {}) {
  const config = parseConfig({
    agents: {
      claude: {
        driver: "claude",
        default: true,
        models: [
          { id: "opus", label: "Opus", description: "hardest work", default: true },
          { id: "sonnet", input_price: 3, output_price: 15 },
        ],
      },
      opencode: {
        driver: "acp",
        command: ["opencode", "acp"],
        models: [{ id: "ollama-cloud/kimi-k3.1-pro", label: "Kimi", description: "cheap", input_price: 0.6 }],
      },
      plain: { driver: "fake" },
    },
    workspaces: { w: "/tmp" },
    max_wait: 200,
    ...extra,
  });
  const driver = new ScriptedDriver();
  const manager = new SessionManager({
    config,
    db: openDb(":memory:"),
    drivers: { claude: driver, opencode: driver, plain: driver },
  });
  managers.push(manager);
  const server = createMcpServer(manager, { maxWaitMs: 200 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, driver, manager };
}

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

describe("agents and start tools with a model catalog", () => {
  it("lists each agent's models one per line and includes the catalog", async () => {
    const { client } = await connect();
    const r = (await client.callTool({ name: "agents", arguments: {} })) as unknown as ToolResult;
    const text = r.content[0]?.text ?? "";
    expect(text).toContain(
      [
        "claude (default) · model opus",
        "  · opus — Opus: hardest work (default)",
        "  · sonnet (in/out $3/$15 per M)",
        "opencode",
        "  · ollama-cloud/kimi-k3.1-pro — Kimi: cheap (in $0.6 per M)",
        "plain",
      ].join("\n"),
    );
    const agents = r.structuredContent.agents as { id: string; models?: { id: string }[] }[];
    expect(agents.find((a) => a.id === "claude")?.models?.map((m) => m.id)).toEqual(["opus", "sonnet"]);
    expect(agents.find((a) => a.id === "plain")?.models).toBeUndefined();
  });

  it("describes the model parameter and rejects an unknown model speakably", async () => {
    const { client, driver } = await connect();
    const { tools } = await client.listTools();
    const start = tools.find((t) => t.name === "start");
    const props = (start?.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
    const model = props.model;
    expect(model?.description).toBe("Model id from the agents tool for the chosen agent.");

    const bad = (await client.callTool({
      name: "start",
      arguments: { prompt: "go", agent: "claude", model: "haiku" },
    })) as unknown as ToolResult;
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toBe(
      "The claude agent has no model called haiku. Choose one of: opus, sonnet.",
    );
    expect(driver.starts).toHaveLength(0);

    const ok = (await client.callTool({
      name: "start",
      arguments: { prompt: "go", agent: "claude", model: "sonnet" },
    })) as unknown as ToolResult;
    expect(ok.isError).toBeUndefined();
    expect(driver.starts[0]?.model).toBe("sonnet");
  });

  it("ends with a usage hint once plan data is known", async () => {
    const { client, manager } = await connect();
    const before = (await client.callTool({ name: "agents", arguments: {} })) as unknown as ToolResult;
    expect(before.structuredContent.usage).toBeUndefined();

    manager.usage.noteRateLimit(
      {
        type: "rate_limit",
        provider: "claude",
        window: "five_hour",
        utilization: 0.34,
        status: "allowed",
        resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      new Date().toISOString(),
    );
    const after = (await client.callTool({ name: "agents", arguments: {} })) as unknown as ToolResult;
    expect(after.content[0]?.text).toContain("/tmp\n\nUsage: Claude plan: 5-hour 34%\n\n{");
    expect(after.structuredContent.usage).toBe("Usage: Claude plan: 5-hour 34%");
  });
});
