import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const stateDir = process.env.FAKE_ACP_STATE_DIR;
const resumeMode = process.env.FAKE_ACP_RESUME_MODE ?? "resume";
const modelLog = process.env.FAKE_ACP_MODEL_LOG;
if (stateDir) mkdirSync(stateDir, { recursive: true });

const memory = new Map();
const cancels = new Map();
let clientCaps = {};

const file = (id) => (stateDir ? join(stateDir, `${id}.json`) : null);
const load = (id) => {
  const f = file(id);
  if (f && existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  return memory.get(id) ?? null;
};
const save = (id, state) => {
  memory.set(id, state);
  const f = file(id);
  if (f) writeFileSync(f, JSON.stringify(state));
};

const modelOption = {
  type: "select",
  id: "model",
  name: "Model",
  category: "model",
  currentValue: "fake-small",
  options: [
    { value: "fake-small", name: "Fake Small" },
    { value: "fake-large", name: "Fake Large" },
  ],
};

const text = (client, sessionId, t, kind = "agent_message_chunk") =>
  client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: kind, content: { type: "text", text: t } },
  });

const sleep = (ms, sessionId) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    cancels.set(sessionId, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

async function elicit(client, sessionId, message, properties) {
  return client.request(acp.methods.client.elicitation.create, {
    mode: "form",
    sessionId,
    message,
    requestedSchema: { type: "object", properties },
  });
}

async function runScript(client, sessionId, line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = line.trim().slice(cmd.length).trim();
  switch (cmd) {
    case "reply": {
      const mid = Math.ceil(arg.length / 2);
      await text(client, sessionId, arg.slice(0, mid));
      await text(client, sessionId, arg.slice(mid));
      return "end_turn";
    }
    case "count": {
      const state = load(sessionId);
      state.turns += 1;
      save(sessionId, state);
      await text(client, sessionId, `turn ${state.turns}`);
      return "end_turn";
    }
    case "ask": {
      const [question, ...labels] = arg.split("|").map((s) => s.trim());
      const res = await elicit(client, sessionId, question, {
        choice: {
          type: "string",
          title: "Choice",
          oneOf: labels.map((l) => ({ const: `v-${l}`, title: l })),
        },
      });
      if (res.action !== "accept") await text(client, sessionId, `no answer: ${res.action}`);
      else await text(client, sessionId, `answered: ${String(res.content?.choice).replace(/^v-/, "")}`);
      return "end_turn";
    }
    case "askform": {
      const res = await elicit(client, sessionId, "details please", {
        proceed: { type: "boolean", title: "Proceed?" },
        name: { type: "string", title: "Name" },
        count: { type: "integer", title: "Count" },
      });
      await text(
        client,
        sessionId,
        `form: ${JSON.stringify(res.action === "accept" ? res.content : res.action)}`,
      );
      return "end_turn";
    }
    case "approve": {
      const res = await client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: {
          toolCallId: `perm-${randomUUID()}`,
          title: `run ${rest[0]}`,
          kind: "execute",
          status: "pending",
        },
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject_once", name: "Reject", kind: "reject_once" },
          { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
        ],
      });
      const allowed = res.outcome.outcome === "selected" && res.outcome.optionId.startsWith("allow");
      if (res.outcome.outcome === "cancelled") return "cancelled";
      await text(client, sessionId, `${allowed ? "approved" : "denied"} ${rest[0]}`);
      return "end_turn";
    }
    case "tools": {
      await text(client, sessionId, "before");
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "read file",
          kind: "read",
          status: "pending",
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
      });
      await text(client, sessionId, "after");
      return "end_turn";
    }
    case "slow": {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "slow",
          title: "sleeping",
          kind: "other",
          status: "in_progress",
        },
      });
      const cancelled = await sleep(Number(rest[0] ?? 1000), sessionId);
      if (cancelled) return "cancelled";
      await text(client, sessionId, "slept");
      return "end_turn";
    }
    case "crash":
      process.exit(1);
      return "end_turn";
    default:
      await text(client, sessionId, `unknown command: ${cmd}`);
      return "end_turn";
  }
}

async function replay(client, sessionId) {
  await text(client, sessionId, "replayed question", "user_message_chunk");
  await text(client, sessionId, "REPLAYED ANSWER");
}

const app = acp
  .agent({ name: "fake-acp-agent" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => {
    clientCaps = params.clientCapabilities ?? {};
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: resumeMode === "load",
        sessionCapabilities: resumeMode === "resume" ? { resume: {} } : {},
      },
    };
  })
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `fake-${randomUUID()}`;
    save(sessionId, { turns: 0 });
    return { sessionId, configOptions: [modelOption] };
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    if (resumeMode !== "resume") throw acp.RequestError.methodNotFound("session/resume");
    if (!load(params.sessionId)) throw acp.RequestError.resourceNotFound(params.sessionId);
    return { configOptions: [modelOption] };
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    if (resumeMode !== "load") throw acp.RequestError.methodNotFound("session/load");
    if (!load(params.sessionId)) throw acp.RequestError.resourceNotFound(params.sessionId);
    await replay(client, params.sessionId);
    return { configOptions: [modelOption] };
  })
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
    if (modelLog)
      appendFileSync(modelLog, `${JSON.stringify({ configId: params.configId, value: params.value })}\n`);
    return { configOptions: [{ ...modelOption, currentValue: params.value }] };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const line = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (/^ask/.test(line) && !clientCaps.elicitation?.form) {
      await text(client, params.sessionId, "client lacks elicitation");
      return { stopReason: "end_turn" };
    }
    const stopReason = await runScript(client, params.sessionId, line);
    return { stopReason };
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    cancels.get(params.sessionId)?.();
  });

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
