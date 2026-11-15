import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../../mcp/server.js";

export interface ToolContract {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  annotations?: unknown;
}

export interface McpContract {
  instructions: string;
  tools: ToolContract[];
}

async function read(createMcpServer: () => McpServer): Promise<McpContract> {
  const server = createMcpServer();
  const client = new Client({ name: "switchboard-dashboard", version: VERSION });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const tools: ToolContract[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          ...(t.title && { title: t.title }),
          ...(t.description && { description: t.description }),
          inputSchema: t.inputSchema,
          ...(t.annotations && { annotations: t.annotations }),
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return { instructions: client.getInstructions() ?? "", tools };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** What a real MCP client sees, read once per process through the same factory that serves /mcp. */
export function contractReader(createMcpServer: () => McpServer): () => Promise<McpContract> {
  let cached: Promise<McpContract> | undefined;
  return () => {
    cached ??= read(createMcpServer).catch((err) => {
      cached = undefined;
      throw err;
    });
    return cached;
  };
}
