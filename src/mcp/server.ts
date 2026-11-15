import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller, SessionManagerApi } from "../core/api.js";
import { SwitchboardError } from "../core/api.js";
import type { PendingRequest, SessionState, SessionView, WaitResult } from "../types.js";

export const VERSION = "0.1.0";

export const INSTRUCTIONS = `switchboard runs real coding agents (Claude Code, OpenCode, …) on the user's machine. Each session is a live agent working in a repository: it reads code, runs commands, edits files, deploys. Treat it like a capable colleague you are pairing with, not a form to fill in.

How to work with it:
- Delegate whole tasks with start, in the user's words plus anything you already know that helps (constraints, names, who it's for). Don't over-specify how.
- Calls return within a few seconds. While a session is working, call wait (pass the cursor you got) and give the user a short, natural update now and then. Never go silent for long in a voice conversation; seconds: 8-10 keeps the conversation flowing.
- When the agent asks a question or wants approval (state "waiting"), answer it yourself only if the user already told you the answer or it is clearly implied. Otherwise ask the user, briefly, reading the options, and pass their answer to respond in their words.
- When a turn ends (state "idle"), tell the user the outcome in a sentence or two: what was done, the URL if there is one, and anything the agent flagged. Follow-ups go to the same session with send; it keeps its context.
- If the user wants to move on, that's fine: the agent keeps working and the user gets a notification when it finishes or needs them. sessions lists everything later.
- To choose an agent or workspace, call agents when the user names a tool or model or you are unsure which fits, and pick by description; otherwise use the defaults. Tell the user which agent you used when it isn't the default. A session keeps its agent: start a new session to switch.
- Use stop only when the user asks (interrupt stops the current turn; close ends the session).`;

const sessionArg = z.string().describe("Session name, e.g. “otter”.");

function quickWaitMs(maxWait: number) {
  return Math.min(10_000, maxWait);
}

function describeRequest(p: PendingRequest): string {
  if (p.kind === "question") {
    return p.questions
      .map((q) => {
        const opts = q.options.map(
          (o, i) => `${i + 1}. ${o.label}${o.description ? ` (${o.description})` : ""}`,
        );
        return `${q.question}${opts.length ? `\n${opts.join("\n")}` : ""}${q.multiSelect ? "\n(more than one allowed)" : ""}`;
      })
      .join("\n\n");
  }
  return `${p.tool}: ${p.summary}\nOptions: ${p.options.map((o) => o.label).join(" / ")}`;
}

export function nextStep(
  state: SessionState,
  w?: Pick<WaitResult, "pending" | "reply" | "error" | "cursor">,
): string {
  switch (state) {
    case "starting":
    case "working":
      return `Still working. Give the user a one-line update if it helps, then call wait with cursor ${w?.cursor ?? 0}. If they'd rather move on, tell them they'll get a notification.`;
    case "waiting":
      if (w?.pending?.kind === "approval")
        return "The agent needs approval. Unless the user already approved exactly this, ask them, then call respond with allow, deny or always.";
      return "The agent is asking a question. Answer only if the user already told you; otherwise ask them (read the options), then call respond with their answer.";
    case "idle":
      return "The turn is finished. Tell the user the outcome briefly. Use send for follow-ups in this session.";
    case "failed":
      return `The agent stopped with an error${w?.error ? `: ${w.error}` : ""}. Tell the user; send will try to resume the session.`;
    case "parked":
      return "The session is parked (no process running, context kept). send resumes it.";
    case "closed":
      return "The session is closed. Start a new one for more work.";
  }
}

function result(text: string, data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: `${text}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

function headline(view: Pick<SessionView, "session" | "state">, w?: WaitResult): string {
  const name = `“${view.session}”`;
  switch (w?.state ?? view.state) {
    case "waiting":
      return w?.pending ? `${name} is waiting on you:\n${describeRequest(w.pending)}` : `${name} is waiting.`;
    case "idle":
      return w?.reply ? `${name} finished:\n${w.reply}` : `${name} is idle.`;
    case "failed":
      return `${name} failed${w?.error ? `: ${w.error}` : "."}`;
    default: {
      const last = w?.activity.at(-1);
      return `${name} is ${w?.state ?? view.state}${last ? ` (${last})` : ""}.`;
    }
  }
}

function report(view: SessionView, w: WaitResult) {
  return result(headline(view, w), {
    session: view.session,
    agent: view.agent,
    workspace: view.workspace,
    title: view.title,
    state: w.state,
    cursor: w.cursor,
    activity: w.activity,
    ...(w.pending ? { pending: w.pending } : {}),
    ...(w.reply ? { reply: w.reply } : {}),
    ...(w.error ? { error: w.error } : {}),
    next: nextStep(w.state, w),
  });
}

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof SwitchboardError ? err.code : "internal";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: code, message },
  };
}

interface ToolExtra {
  authInfo?: { extra?: Record<string, unknown> };
}

function callerOf(extra: ToolExtra | undefined): Caller {
  const email = extra?.authInfo?.extra?.email;
  return typeof email === "string" && email ? { email } : {};
}

function wrap<A>(fn: (args: A, caller: Caller) => Promise<ReturnType<typeof result>>) {
  return async (args: A, extra?: ToolExtra) => {
    try {
      return await fn(args, callerOf(extra));
    } catch (err) {
      return failure(err);
    }
  };
}

export function createMcpServer(manager: SessionManagerApi, opts: { maxWaitMs: number }): McpServer {
  const server = new McpServer({ name: "switchboard", version: VERSION }, { instructions: INSTRUCTIONS });
  const quick = quickWaitMs(opts.maxWaitMs);
  const maxSeconds = Math.max(1, Math.floor(opts.maxWaitMs / 1000));

  async function settle(view: SessionView, caller: Caller, waitMs = quick) {
    return report(view, await manager.wait(view.session, { maxWaitMs: waitMs }, caller));
  }

  server.registerTool(
    "agents",
    {
      title: "What can run",
      description:
        "List the coding agents and workspaces (repositories) this switchboard can use, with what each is for. Call it to choose which agent or workspace fits a task.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async (_args: unknown, caller) => {
      const agents = manager.agents(caller);
      const workspaces = manager.workspaces(caller);
      const line = (id: string, isDefault: boolean, description?: string, detail?: string) =>
        `${id}${isDefault ? " (default)" : ""}${description ? ` — ${description}` : ""}${detail ? ` · ${detail}` : ""}`;
      const agentLines = agents.map((a) =>
        line(a.id, a.default, a.description, a.model ? `model ${a.model}` : undefined),
      );
      const workspaceLines = workspaces.map((w) => line(w.id, w.default, w.description, w.path));
      return result(`Agents:\n${agentLines.join("\n")}\n\nWorkspaces:\n${workspaceLines.join("\n")}`, {
        agents,
        workspaces,
      });
    }),
  );

  server.registerTool(
    "start",
    {
      title: "Start a session",
      description:
        "Start a new coding-agent session on a task, optionally choosing the agent and workspace (see agents). Returns within ~10 s with the session name and its state: working, waiting (the agent has a question), or idle (already done).",
      inputSchema: {
        prompt: z.string().min(1).describe("The task, in plain words, with any context that helps."),
        agent: z.string().optional().describe("Agent id from the agents tool (default if omitted)."),
        workspace: z.string().optional().describe("Workspace id from the agents tool (default if omitted)."),
        model: z.string().optional().describe("Model override, e.g. opus or sonnet."),
        title: z.string().optional().describe("Short title for the session list."),
      },
    },
    wrap(
      async (
        args: { prompt: string; agent?: string; workspace?: string; model?: string; title?: string },
        caller,
      ) => settle(await manager.start(args, caller), caller),
    ),
  );

  server.registerTool(
    "send",
    {
      title: "Send a follow-up",
      description:
        "Send the next message to a session (a follow-up, a correction, more context). Resumes parked sessions with their context. Returns within ~10 s.",
      inputSchema: { session: sessionArg, message: z.string().min(1) },
    },
    wrap(async ({ session, message }: { session: string; message: string }, caller) =>
      settle(await manager.send(session, message, caller), caller),
    ),
  );

  server.registerTool(
    "wait",
    {
      title: "Check on a session",
      description:
        "Wait for progress on a session and get what happened since the cursor: activity lines, a pending question, or the final reply. Returns early when something needs attention.",
      inputSchema: {
        session: sessionArg,
        cursor: z.number().int().nonnegative().optional().describe("Cursor from the previous result."),
        seconds: z
          .number()
          .int()
          .min(0)
          .max(maxSeconds)
          .optional()
          .describe(`How long to wait at most (0-${maxSeconds}). Use 8-10 in voice conversations.`),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(
      async (
        { session, cursor, seconds }: { session: string; cursor?: number; seconds?: number },
        caller,
      ) => {
        const w = await manager.wait(
          session,
          {
            ...(cursor !== undefined ? { cursor } : {}),
            maxWaitMs: seconds !== undefined ? seconds * 1000 : opts.maxWaitMs,
          },
          caller,
        );
        const view = manager.list(undefined, caller).find((s) => s.session === session);
        if (!view) throw new SwitchboardError(`No session named “${session}”.`, "not_found");
        return report(view, w);
      },
    ),
  );

  server.registerTool(
    "respond",
    {
      title: "Answer the agent",
      description:
        "Answer a session's pending question or approval. answer is what the user said: an option label or number, allow / deny / always for approvals, or free text.",
      inputSchema: {
        session: sessionArg,
        request: z.string().describe("The pending request id."),
        answer: z.string().min(1),
      },
    },
    wrap(async ({ session, request, answer }: { session: string; request: string; answer: string }, caller) =>
      settle(await manager.respond(session, request, answer, caller), caller),
    ),
  );

  server.registerTool(
    "sessions",
    {
      title: "List sessions",
      description: "List sessions with their state and latest activity, newest first.",
      inputSchema: {
        state: z.enum(["starting", "working", "waiting", "idle", "parked", "failed", "closed"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ state }: { state?: SessionState }, caller) => {
      const list = manager.list(state ? { state } : undefined, caller);
      const line = list.length
        ? list
            .map(
              (s) => `${s.session}: ${s.state}${s.pending ? " (needs you)" : ""} · ${s.agent} — ${s.title}`,
            )
            .join("\n")
        : "No sessions.";
      return result(line, { sessions: list });
    }),
  );

  server.registerTool(
    "stop",
    {
      title: "Stop a session",
      description: "interrupt stops the current turn (the session stays usable); close ends the session.",
      inputSchema: { session: sessionArg, mode: z.enum(["interrupt", "close"]).default("interrupt") },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ session, mode }: { session: string; mode: "interrupt" | "close" }, caller) => {
      const view = await manager.stop(session, mode, caller);
      return result(`“${view.session}” is ${view.state}.`, { ...view, next: nextStep(view.state) });
    }),
  );

  return server;
}
