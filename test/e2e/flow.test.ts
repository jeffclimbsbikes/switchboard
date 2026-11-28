import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/sessions.js";
import { openDb } from "../../src/db.js";
import { FakeDriver } from "../../src/drivers/fake.js";
import { createHttpApp } from "../../src/http/server.js";
import { createMcpServer } from "../../src/mcp/server.js";
import {
  AUD,
  baseConfig,
  exchange,
  getCode,
  type Harness,
  OWNER,
  pkce,
  register,
  TEAM,
} from "../http/harness.js";

type ToolResult = {
  content: { text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

describe("end to end: claude.ai-style client over HTTP + OAuth, real core, fake agent", () => {
  let h: Harness;
  let manager: SessionManager;
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const config = baseConfig({ max_wait: "3s" });
    const db = openDb(":memory:");
    manager = new SessionManager({ config, db, drivers: { fake: new FakeDriver() } });
    const app = createHttpApp({
      config,
      db,
      createMcpServer: () => createMcpServer(manager, { maxWaitMs: config.max_wait }),
      accessKeys: createLocalJWKSet({ keys: [jwk] }),
    });
    const listener = app.listen(0, "127.0.0.1");
    await new Promise((r) => listener.once("listening", r));
    const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
    const jwt = async () =>
      new SignJWT({ email: OWNER })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
        .setAudience(AUD)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
    h = { base, db, jwt, clock: { ms: Date.now() }, close: async () => {} } as unknown as Harness;

    const { body: reg } = await register(h);
    const { verifier, challenge } = pkce();
    const code = await getCode(h, reg.client_id as string, challenge);
    const tokens = (await (await exchange(h, reg.client_id as string, code, verifier)).json()) as {
      access_token: string;
    };

    client = new Client({ name: "claude.ai", version: "test" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
      }),
    );
    close = async () => {
      await client.close();
      await manager.shutdown();
      await new Promise<void>((r) => listener.close(() => r()));
    };
  });

  afterAll(async () => close?.());

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolResult;

  it("sees the instructions and tools", async () => {
    expect(client.getInstructions()).toMatch(/real coding agents/);
    expect((await client.listTools()).tools).toHaveLength(8);
    const agents = await call("agents");
    expect(agents.structuredContent).toMatchObject({ agents: [{ id: "fake", default: true }] });
  });

  it("runs a whole conversation: question, answer, follow-up, approval, stop", async () => {
    const started = await call("start", { prompt: "ask Just you, or Alice too? | just me | both" });
    const session = started.structuredContent.session as string;
    let s = started.structuredContent;
    if (s.state !== "waiting") s = (await call("wait", { session, cursor: s.cursor })).structuredContent;
    expect(s.state).toBe("waiting");
    const pending = s.pending as { id: string; kind: string };
    expect(pending.kind).toBe("question");

    const answered = await call("respond", { session, request: pending.id, answer: "2" });
    expect(answered.structuredContent).toMatchObject({ state: "idle", reply: "answered: both" });
    expect(answered.content[0]?.text).toContain("finished:\nanswered: both");

    const followUp = await call("send", { session, message: "count" });
    expect(followUp.structuredContent).toMatchObject({ state: "idle", reply: "turn 2" });

    const approval = await call("send", { session, message: "approve deploy" });
    const req = approval.structuredContent.pending as { id: string; kind: string };
    expect(req.kind).toBe("approval");
    const denied = await call("respond", { session, request: req.id, answer: "no thanks" });
    expect(denied.structuredContent).toMatchObject({ state: "idle", reply: "denied deploy" });

    const list = await call("sessions");
    expect(list.content[0]?.text).toMatch(new RegExp(`^${session}: idle`));

    const stopped = await call("stop", { session, mode: "close" });
    expect(stopped.structuredContent).toMatchObject({ state: "closed" });
    const after = await call("send", { session, message: "count" });
    expect(after.isError).toBe(true);
  });

  it("reports progress on slow work instead of blocking", async () => {
    const started = await call("start", { prompt: "slow 5000" });
    const session = started.structuredContent.session as string;
    const w = await call("wait", { session, cursor: started.structuredContent.cursor, seconds: 1 });
    expect(w.structuredContent.state).toBe("working");
    expect(String(w.structuredContent.next)).toMatch(/call wait with cursor/);
    const stopped = await call("stop", { session, mode: "interrupt" });
    expect(stopped.isError).toBeFalsy();
  });

  it("rejects calls without a token", async () => {
    const res = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
});
