#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(process.env.TMPDIR ?? "/tmp", "fake-claude-state");
mkdirSync(stateDir, { recursive: true });

const sessionId = flag("resume") ?? flag("session-id") ?? randomUUID();
const permissionMode = flag("permission-mode") ?? "default";
const model = flag("model") ?? "fake";
const countFile = join(stateDir, `${sessionId}.count`);
const nextCount = () => {
  let n = 0;
  try {
    n = Number(readFileSync(countFile, "utf8"));
  } catch {}
  writeFileSync(countFile, String(n + 1));
  return n + 1;
};

const send = (obj) =>
  process.stdout.write(`${JSON.stringify({ session_id: sessionId, uuid: randomUUID(), ...obj })}\n`);
const record = (kind, data) =>
  appendFileSync(join(stateDir, "log.jsonl"), `${JSON.stringify({ kind, sessionId, ...data })}\n`);

let inited = false;
const initOnce = () => {
  if (inited) return;
  inited = true;
  record("init", { model });
  send({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    tools: [],
    model,
    permissionMode,
    mcp_servers: [],
  });
};

const assistant = (content) =>
  send({
    type: "assistant",
    message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model, content },
    parent_tool_use_id: null,
  });
const toolResult = (tool_use_id, content, is_error = false) =>
  send({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id, content, is_error }] },
    parent_tool_use_id: null,
  });
const costFile = join(stateDir, `${sessionId}.cost`);
const addCost = (usd) => {
  let total = 0;
  try {
    total = Number(readFileSync(costFile, "utf8"));
  } catch {}
  total += usd;
  writeFileSync(costFile, String(total));
  return total;
};
const rateLimit = () =>
  send({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      rateLimitType: "five_hour",
      utilization: 0.42,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
    },
  });
const result = (text) => {
  rateLimit();
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    stop_reason: "end_turn",
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    total_cost_usd: addCost(0.25),
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 10,
    },
    modelUsage: {},
    permission_denials: [],
  });
};
const sayAndEnd = (text) => {
  assistant([{ type: "text", text }]);
  result(text);
};

const waiting = new Map();
let abortTurn = null;

const askPermission = (tool_name, input, tool_use_id, extra = {}) =>
  new Promise((resolve) => {
    const request_id = randomUUID();
    waiting.set(request_id, resolve);
    send({
      type: "control_request",
      request_id,
      request: { subtype: "can_use_tool", tool_name, display_name: tool_name, input, tool_use_id, ...extra },
    });
  });

async function runTurn(text) {
  initOnce();
  const [cmd, ...restWords] = text.trim().split(/\s+/);
  const rest = text.trim().slice(cmd.length).trim();
  switch (cmd) {
    case "reply":
      return sayAndEnd(rest);
    case "count":
      return sayAndEnd(`turn ${nextCount()}`);
    case "crash":
      assistant([{ type: "text", text: "about to crash" }]);
      process.exit(3);
      return;
    case "ask": {
      const [question, ...labels] = rest.split("|").map((s) => s.trim());
      const id = `toolu_${randomUUID()}`;
      const input = {
        questions: [
          {
            question,
            header: "Q",
            multiSelect: false,
            options: labels.map((label) => ({ label, description: label })),
          },
        ],
      };
      assistant([{ type: "tool_use", id, name: "AskUserQuestion", input }]);
      const res = await askPermission("AskUserQuestion", input, id, { requires_user_interaction: true });
      record("ask_response", { response: res });
      if (res.behavior !== "allow") {
        toolResult(id, "The user declined to answer.", true);
        return sayAndEnd("declined");
      }
      const answer = res.updatedInput?.answers?.[question];
      toolResult(id, `Your questions have been answered: "${question}"="${answer}".`);
      return sayAndEnd(`answered: ${answer}`);
    }
    case "approve": {
      const tool = restWords[0] ?? "Bash";
      const id = `toolu_${randomUUID()}`;
      const input = { command: `${tool} --now` };
      assistant([{ type: "tool_use", id, name: tool, input }]);
      if (permissionMode !== "bypassPermissions") {
        const res = await askPermission(tool, input, id, {
          description: `Run ${tool}`,
          permission_suggestions: [
            {
              type: "addRules",
              rules: [{ toolName: tool }],
              behavior: "allow",
              destination: "localSettings",
            },
          ],
        });
        record("approve_response", { response: res });
        if (res.behavior !== "allow") {
          toolResult(id, res.message ?? "denied", true);
          return sayAndEnd(`denied ${tool}`);
        }
      }
      toolResult(id, "ok");
      return sayAndEnd(`approved ${tool}`);
    }
    case "slow": {
      const ms = Number(restWords[0] ?? 1000);
      const id = `toolu_${randomUUID()}`;
      assistant([{ type: "tool_use", id, name: "Bash", input: { command: `sleep ${ms / 1000}` } }]);
      const finished = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(true), ms);
        abortTurn = () => {
          clearTimeout(t);
          resolve(false);
        };
      });
      abortTurn = null;
      if (!finished) {
        send({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "aborted_streaming",
          stop_reason: null,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: {},
          modelUsage: {},
          permission_denials: [],
          errors: [],
        });
        return;
      }
      toolResult(id, "slept");
      return sayAndEnd("slept");
    }
    default:
      return sayAndEnd(`unknown command: ${text}`);
  }
}

const controlOk = (request_id, response = {}) =>
  send({ type: "control_response", response: { subtype: "success", request_id, response } });

let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === "control_request") {
    const sub = msg.request.subtype;
    if (sub === "interrupt") {
      abortTurn?.();
      return controlOk(msg.request_id);
    }
    if (sub === "get_usage") {
      return controlOk(msg.request_id, {
        session: {
          total_cost_usd: 0,
          total_api_duration_ms: 0,
          total_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: {},
        },
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 34, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
          seven_day: { utilization: 61, resets_at: new Date(Date.now() + 86_400_000).toISOString() },
          seven_day_opus: null,
        },
        behaviors: null,
      });
    }
    return controlOk(msg.request_id, sub === "initialize" ? { commands: [], models: [] } : {});
  }
  if (msg.type === "control_response") {
    const resolve = waiting.get(msg.response.request_id);
    waiting.delete(msg.response.request_id);
    resolve?.(msg.response.response);
    return;
  }
  if (msg.type === "user") {
    const c = msg.message.content;
    const text = typeof c === "string" ? c : c.map((b) => b.text ?? "").join("");
    chain = chain.then(() => runTurn(text));
  }
});
rl.on("close", () => process.exit(0));
