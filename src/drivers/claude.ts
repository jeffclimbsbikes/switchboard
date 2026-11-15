import { randomUUID } from "node:crypto";
import {
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  query,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Answer, ApprovalOption, PendingRequest, Question, StopReason, TokenUsage } from "../types.js";
import type { AgentSession, Driver, DriverEvent, DriverStartOptions } from "./driver.js";
import { spawnClaudeAs } from "./run-as.js";

export interface ClaudeDriverOptions {
  executable?: string;
  model?: string;
  permissionMode?: PermissionMode;
  appendSystemPrompt?: string;
  env?: Record<string, string>;
  runAs?: string;
  sudoPath?: string;
}

const APPROVAL_OPTIONS: ApprovalOption[] = [
  { id: "allow", label: "Allow once", kind: "allow_once" },
  { id: "always", label: "Always allow", kind: "allow_always" },
  { id: "reject", label: "Reject", kind: "reject_once" },
];

const SUMMARY_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"];

export function summarizeTool(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    for (const key of SUMMARY_KEYS) {
      const v = (input as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) {
        const line = v.trim().split("\n")[0] ?? "";
        return `${name}: ${line.length > 100 ? `${line.slice(0, 97)}...` : line}`;
      }
    }
  }
  return name;
}

const PLAN_STATUS = { allowed: "allowed", allowed_warning: "warning", rejected: "rejected" } as const;

/** The SDK reports utilization as a fraction; anything above 1 can only be a percentage. */
export function normalizeUtilization(value: number): number {
  return value > 1 ? value / 100 : value;
}

/** Epoch seconds from the SDK (milliseconds tolerated) to an ISO timestamp. */
export function resetsAtIso(epoch: number): string {
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch).toISOString();
}

export function rateLimitEvent(info: SDKRateLimitInfo): DriverEvent | undefined {
  if (!info.rateLimitType) return undefined;
  return {
    type: "rate_limit",
    provider: "claude",
    window: info.rateLimitType,
    status: PLAN_STATUS[info.status] ?? "allowed",
    ...(typeof info.utilization === "number" && { utilization: normalizeUtilization(info.utilization) }),
    ...(typeof info.resetsAt === "number" && { resetsAt: resetsAtIso(info.resetsAt) }),
  };
}

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter?: (r: IteratorResult<SDKUserMessage>) => void;
  private ended = false;

  push(text: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value: msg, done: false });
    } else this.items.push(msg);
  }

  end() {
    this.ended = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

interface Pending {
  settle: (result: PermissionResult) => void;
  tool: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
}

function questionsFrom(input: Record<string, unknown>): Question[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw.map((q: Record<string, unknown>) => ({
    question: String(q.question ?? ""),
    ...(typeof q.header === "string" ? { header: q.header } : {}),
    options: (Array.isArray(q.options) ? q.options : []).map((o: Record<string, unknown>) => ({
      label: String(o.label ?? ""),
      ...(typeof o.description === "string" ? { description: o.description } : {}),
    })),
    multiSelect: q.multiSelect === true,
  }));
}

class ClaudeSession implements AgentSession {
  private readonly input = new InputQueue();
  private readonly pending = new Map<string, Pending>();
  private readonly titles = new Map<string, string>();
  private readonly abort = new AbortController();
  private readonly q: Query;
  private readonly loop: Promise<void>;
  private turnActive = false;
  private interrupting = false;
  private closed = false;
  private costSoFar: number;

  constructor(
    driver: ClaudeDriverOptions,
    private readonly opts: DriverStartOptions,
  ) {
    this.costSoFar = opts.resume ? (opts.priorCostUsd ?? 0) : 0;
    const mode = driver.permissionMode ?? "default";
    const append = [driver.appendSystemPrompt, opts.appendSystemPrompt].filter(Boolean).join("\n\n");
    const model = opts.model ?? driver.model;
    this.q = query({
      prompt: this.input,
      options: {
        cwd: driver.runAs ? "/" : opts.cwd,
        ...(driver.runAs
          ? {
              spawnClaudeCodeProcess: spawnClaudeAs(
                { user: driver.runAs, ...(driver.sudoPath ? { sudoPath: driver.sudoPath } : {}) },
                opts.cwd,
                driver.env ?? {},
              ),
            }
          : {}),
        permissionMode: mode,
        ...(mode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
        ...(model ? { model } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
        ...(driver.executable ? { pathToClaudeCodeExecutable: driver.executable } : {}),
        ...(append ? { systemPrompt: { type: "preset", preset: "claude_code", append } } : {}),
        env: { ...process.env, ...driver.env } as Record<string, string>,
        abortController: this.abort,
        canUseTool: this.canUseTool,
      },
    });
    this.loop = this.run();
  }

  private emit(event: DriverEvent) {
    if (!this.closed) this.opts.onEvent(event);
  }

  private async run() {
    try {
      for await (const msg of this.q) this.handle(msg);
      if (!this.closed) this.emit({ type: "error", message: "claude exited unexpectedly", fatal: true });
    } catch (err) {
      if (!this.closed) {
        this.emit({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: true });
      }
    } finally {
      this.rejectAll("agent process ended", false);
    }
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") this.emit({ type: "session", agentSessionId: msg.session_id });
        return;
      case "assistant": {
        if (msg.parent_tool_use_id) return;
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.emit({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const title = summarizeTool(block.name, block.input);
            this.titles.set(block.id, title);
            this.emit({ type: "tool", id: block.id, title, status: "running" });
          }
        }
        return;
      }
      case "user": {
        const content = msg.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const title = this.titles.get(block.tool_use_id);
          if (title === undefined) continue;
          this.titles.delete(block.tool_use_id);
          this.emit({
            type: "tool",
            id: block.tool_use_id,
            title,
            status: block.is_error ? "failed" : "done",
          });
        }
        return;
      }
      case "result": {
        const cancelled = this.interrupting || msg.terminal_reason === "aborted_streaming";
        this.turnActive = false;
        this.interrupting = false;
        this.titles.clear();
        const usage = this.turnUsage(msg);
        if (msg.subtype === "success" && !msg.is_error) {
          this.emit({ type: "turn_end", stopReason: "end_turn", result: msg.result, ...usage });
          return;
        }
        const stopReason: StopReason = cancelled ? "cancelled" : "error";
        const detail = msg.subtype === "success" ? msg.result : msg.errors?.join("; ");
        this.emit({ type: "turn_end", stopReason, ...(detail ? { result: detail } : {}), ...usage });
        return;
      }
      case "rate_limit_event": {
        const event = rateLimitEvent(msg.rate_limit_info);
        if (event) this.emit(event);
        return;
      }
      default:
        return;
    }
  }

  /** total_cost_usd is cumulative for the conversation; usage is this turn's. */
  private turnUsage(msg: SDKResultMessage): { costUsd?: number; tokens?: TokenUsage } {
    const out: { costUsd?: number; tokens?: TokenUsage } = {};
    const total = msg.total_cost_usd;
    if (typeof total === "number" && Number.isFinite(total)) {
      const delta = total >= this.costSoFar ? total - this.costSoFar : total;
      this.costSoFar = total;
      out.costUsd = Math.round(delta * 1e6) / 1e6;
    }
    const u = msg.usage as unknown as Record<string, unknown> | undefined;
    const num = (k: string) => (typeof u?.[k] === "number" ? (u[k] as number) : undefined);
    const input = num("input_tokens");
    const output = num("output_tokens");
    if (input !== undefined || output !== undefined) {
      out.tokens = {
        input: input ?? 0,
        output: output ?? 0,
        cacheRead: num("cache_read_input_tokens") ?? 0,
        cacheWrite: num("cache_creation_input_tokens") ?? 0,
      };
    }
    return out;
  }

  private canUseTool: CanUseTool = (tool, input, options) => {
    return new Promise<PermissionResult>((resolve) => {
      const id = randomUUID();
      const toolUseID = options.toolUseID;
      const settle = (r: PermissionResult) => {
        this.pending.delete(id);
        resolve(r);
      };
      this.pending.set(id, {
        settle,
        tool,
        input,
        toolUseID,
        ...(options.suggestions ? { suggestions: options.suggestions } : {}),
      });
      options.signal.addEventListener("abort", () => {
        if (this.pending.has(id)) settle({ behavior: "deny", message: "aborted", toolUseID });
      });
      const request: PendingRequest =
        tool === "AskUserQuestion"
          ? { id, kind: "question", questions: questionsFrom(input) }
          : {
              id,
              kind: "approval",
              tool,
              summary: options.title ?? options.description ?? summarizeTool(tool, input),
              input,
              options: APPROVAL_OPTIONS,
            };
      this.emit({ type: "request", request });
    });
  };

  private rejectAll(message: string, interrupt: boolean) {
    for (const p of [...this.pending.values()])
      p.settle({ behavior: "deny", message, interrupt, toolUseID: p.toolUseID });
  }

  async prompt(text: string) {
    if (this.closed) throw new Error("session is closed");
    this.turnActive = true;
    this.input.push(text);
  }

  async respond(requestId: string, answer: Answer) {
    const p = this.pending.get(requestId);
    if (!p) throw new Error(`no pending request ${requestId}`);
    if (answer.kind === "question") {
      const answers = Object.fromEntries(
        Object.entries(answer.answers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      );
      p.settle({
        behavior: "allow",
        updatedInput: { ...p.input, answers },
        toolUseID: p.toolUseID,
      });
      return;
    }
    const option = APPROVAL_OPTIONS.find((o) => o.id === answer.optionId);
    if (!option) throw new Error(`unknown option ${answer.optionId}`);
    if (option.kind === "allow_once") {
      p.settle({ behavior: "allow", updatedInput: p.input, toolUseID: p.toolUseID });
    } else if (option.kind === "allow_always") {
      p.settle({
        behavior: "allow",
        updatedInput: p.input,
        toolUseID: p.toolUseID,
        ...(p.suggestions ? { updatedPermissions: p.suggestions } : {}),
      });
    } else {
      p.settle({
        behavior: "deny",
        message: answer.message ?? "The user rejected this action.",
        toolUseID: p.toolUseID,
      });
    }
  }

  async interrupt() {
    if (this.closed || !this.turnActive) return;
    this.interrupting = true;
    this.rejectAll("interrupted", true);
    await this.q.interrupt();
  }

  async close() {
    if (this.closed) return;
    this.rejectAll("session closed", true);
    this.closed = true;
    this.input.end();
    this.q.close();
    this.abort.abort();
    await this.loop.catch(() => {});
  }
}

export class ClaudeDriver implements Driver {
  readonly kind = "claude" as const;

  constructor(private readonly options: ClaudeDriverOptions = {}) {}

  async start(options: DriverStartOptions): Promise<AgentSession> {
    return new ClaudeSession(this.options, options);
  }
}
