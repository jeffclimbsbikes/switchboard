import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { SessionManagerApi, StartInput } from "../../src/core/api.js";
import { SwitchboardError } from "../../src/core/api.js";
import { createMcpServer, INSTRUCTIONS } from "../../src/mcp/server.js";
import type { SessionSummary, SessionView, WaitResult } from "../../src/types.js";

const now = "2026-11-14T00:00:00.000Z";

function stubManager(): SessionManagerApi & { calls: unknown[][]; next: Partial<WaitResult> } {
  const view: SessionView = {
    session: "otter",
    agent: "claude",
    workspace: "app",
    title: "packing list",
    state: "working",
    createdAt: now,
    updatedAt: now,
  };
  const calls: unknown[][] = [];
  const m = {
    calls,
    next: {} as Partial<WaitResult>,
    agents: () => [{ id: "claude", driver: "claude" as const, default: true }],
    workspaces: () => [{ id: "app", path: "/srv/app", default: true }],
    start: async (input: StartInput) => {
      calls.push(["start", input]);
      return view;
    },
    send: async (s: string, msg: string) => {
      calls.push(["send", s, msg]);
      if (s !== "otter") throw new SwitchboardError(`No session named “${s}”.`, "not_found");
      return view;
    },
    respond: async (s: string, r: string, a: string) => {
      calls.push(["respond", s, r, a]);
      return view;
    },
    wait: async (s: string, opts?: { cursor?: number; maxWaitMs?: number }) => {
      calls.push(["wait", s, opts]);
      return {
        session: s,
        state: "working" as const,
        cursor: 3,
        activity: ["running: Bash: npm test"],
        ...m.next,
      };
    },
    list: (): SessionSummary[] => [{ ...view, lastActivity: "running: Bash: npm test" }],
    stop: async (s: string, mode: "interrupt" | "close") => {
      calls.push(["stop", s, mode]);
      return { ...view, state: mode === "close" ? ("closed" as const) : ("idle" as const) };
    },
    shutdown: async () => {},
  };
  return m;
}

async function connect(manager: SessionManagerApi, maxWaitMs = 25_000) {
  const server = createMcpServer(manager, { maxWaitMs });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
}

describe("mcp server", () => {
  it("advertises the seven tools and instructions", async () => {
    const client = await connect(stubManager());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["agents", "respond", "send", "sessions", "start", "stop", "wait"].sort(),
    );
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it("offers history only when the manager has it, and passes caller-scoped arguments through", async () => {
    expect(INSTRUCTIONS).toContain("history");
    const m = stubManager();
    const seen: unknown[] = [];
    const withHistory = {
      ...m,
      history: async (input: unknown) => {
        seen.push(input);
        return {
          entries: [
            {
              id: "2026-01-01-otter-claude",
              session: "otter",
              agent: "claude",
              title: "packing list",
              created: "2026-01-01T00:00:00.000Z",
              updated: "2026-01-02T00:00:00.000Z",
              state: "archived" as const,
              abstract: "Built a packing list app.",
              path: "/a/otter.md",
            },
          ],
        };
      },
    };
    const client = await connect(withHistory);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("history");
    const r = await call(client, "history", { query: "packing", limit: 5 });
    expect(seen).toEqual([{ query: "packing", limit: 5 }]);
    expect(r.content[0]?.text).toContain(
      "otter · 2026-01-01 · claude · archived — packing list\n  Built a packing list app.\n  /a/otter.md",
    );
    expect((await call(client, "history", { limit: 99 })).isError).toBe(true);
    const plain = await connect(stubManager());
    expect((await plain.listTools()).tools.map((t) => t.name)).not.toContain("history");
  });

  it("start delegates, then waits briefly and reports progress with a next step", async () => {
    const m = stubManager();
    const client = await connect(m);
    const r = await call(client, "start", { prompt: "build a packing list app" });
    expect(m.calls[0]).toEqual(["start", { prompt: "build a packing list app" }]);
    expect(m.calls[1]).toEqual(["wait", "otter", { maxWaitMs: 10_000 }]);
    expect(r.structuredContent).toMatchObject({ session: "otter", state: "working", cursor: 3 });
    expect(String(r.structuredContent.next)).toMatch(/call wait with cursor 3/);
    expect(r.content[0]?.text).toMatch(/^“otter” is working \(running: Bash: npm test\)/);
  });

  it("reads a pending question aloud-friendly and points to respond", async () => {
    const m = stubManager();
    m.next = {
      state: "waiting",
      pending: {
        id: "q1",
        kind: "question",
        questions: [
          {
            question: "Just you, or Alice too?",
            options: [{ label: "just me" }, { label: "both" }],
            multiSelect: false,
          },
        ],
      },
    };
    const client = await connect(m);
    const r = await call(client, "wait", { session: "otter", cursor: 3, seconds: 8 });
    expect(m.calls.at(-1)).toEqual(["wait", "otter", { cursor: 3, maxWaitMs: 8_000 }]);
    expect(r.content[0]?.text).toContain("Just you, or Alice too?\n1. just me\n2. both");
    expect(String(r.structuredContent.next)).toMatch(/respond/);
  });

  it("reports a finished turn with the reply", async () => {
    const m = stubManager();
    m.next = { state: "idle", reply: "Live at packing.example.com" };
    const client = await connect(m);
    const r = await call(client, "respond", { session: "otter", request: "q1", answer: "both" });
    expect(m.calls[0]).toEqual(["respond", "otter", "q1", "both"]);
    expect(r.content[0]?.text).toContain("finished:\nLive at packing.example.com");
  });

  it("caps wait seconds at max_wait", async () => {
    const client = await connect(stubManager(), 5_000);
    const r = await call(client, "wait", { session: "otter", seconds: 30 });
    expect(r.isError).toBe(true);
  });

  it("turns errors into speakable tool errors", async () => {
    const client = await connect(stubManager());
    const r = await call(client, "send", { session: "nope", message: "hi" });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("No session named “nope”.");
    expect(r.structuredContent).toMatchObject({ error: "not_found" });
  });

  it("describes agents and workspaces", async () => {
    const m = {
      ...stubManager(),
      agents: () => [
        {
          id: "claude",
          driver: "claude" as const,
          model: "opus",
          description: "Best for hard problems",
          default: true,
        },
        { id: "opencode", driver: "acp" as const, default: false },
      ],
      workspaces: () => [
        { id: "app", path: "/srv/app", description: "The main repo", default: true },
        { id: "scratch", path: "/tmp/scratch", default: false },
      ],
    };
    const client = await connect(m);
    const r = await call(client, "agents");
    const text = r.content[0]?.text ?? "";
    expect(text).toContain("claude (default) — Best for hard problems · model opus");
    expect(text).toContain("\nopencode\n");
    expect(text).toContain("app (default) — The main repo · /srv/app");
    expect(text).toContain("\nscratch · /tmp/scratch");
    expect(r.structuredContent).toMatchObject({
      agents: [{ id: "claude", description: "Best for hard problems" }, { id: "opencode" }],
      workspaces: [{ id: "app", description: "The main repo" }, { id: "scratch" }],
    });
  });

  it("explains how to choose an agent", () => {
    expect(INSTRUCTIONS).toMatch(/call agents/);
    expect(INSTRUCTIONS).toMatch(/start a new session to switch/);
  });

  it("lists sessions and stops them", async () => {
    const m = stubManager();
    const client = await connect(m);
    expect((await call(client, "sessions")).content[0]?.text).toMatch(
      /^otter: working · claude — packing list/,
    );
    const r = await call(client, "stop", { session: "otter", mode: "close" });
    expect(r.structuredContent).toMatchObject({ state: "closed" });
  });
});
