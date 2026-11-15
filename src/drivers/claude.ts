import { randomUUID } from "node:crypto";
import {
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Answer, ApprovalOption, PendingRequest, Question, StopReason } from "../types.js";
import type { AgentSession, Driver, DriverEvent, DriverStartOptions } from "./driver.js";

export interface ClaudeDriverOptions {
  executable?: string;
  model?: string;
  permissionMode?: PermissionMode;
  appendSystemPrompt?: string;
  env?: Record<string, string>;
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

  constructor(
    driver: ClaudeDriverOptions,
    private readonly opts: DriverStartOptions,
  ) {
    const mode = driver.permissionMode ?? "default";
    const append = [driver.appendSystemPrompt, opts.appendSystemPrompt].filter(Boolean).join("\n\n");
    const model = opts.model ?? driver.model;
    this.q = query({
      prompt: this.input,
      options: {
        cwd: opts.cwd,
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
        if (msg.subtype === "success" && !msg.is_error) {
          this.emit({ type: "turn_end", stopReason: "end_turn", result: msg.result });
          return;
        }
        const stopReason: StopReason = cancelled ? "cancelled" : "error";
        const detail = msg.subtype === "success" ? msg.result : msg.errors?.join("; ");
        this.emit({ type: "turn_end", stopReason, ...(detail ? { result: detail } : {}) });
        return;
      }
      default:
        return;
    }
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
