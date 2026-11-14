# 02 - Agent protocols: ACP, OpenCode serve, Claude Code headless/SDK

Researched 2026-11-14 from docs (WebFetch summaries; some details not on fetched pages are marked UNVERIFIED).

## 1. Agent Client Protocol (ACP)

**Transport.** JSON-RPC 2.0 (requests + notifications). Agent is normally a subprocess of the client; newline-delimited JSON over stdin/stdout (confirmed for `opencode acp`). Stdio is the only practical binding today. https://agentclientprotocol.com/protocol/overview

**Lifecycle / methods (v1, stable):**
- Agent-side (client calls): `initialize` (capability exchange), `authenticate`, `session/new`, `session/prompt`, optional `session/load` (needs `loadSession`), `session/resume` (needs `sessionCapabilities.resume`), `session/list`, `session/close`, `session/set_mode`, `session/set_config_option`; notification `session/cancel`.
- Client-side (agent calls): `session/request_permission` (baseline), optional `fs/read_text_file`, `fs/write_text_file`, `terminal/*` (create/output/release/wait_for_exit/kill), `elicitation/create`; notifications `session/update`, `elicitation/complete`.
- `session/new`: `{cwd (absolute), mcpServers[], additionalDirectories?, systemPrompt?}` -> `{sessionId}`. https://agentclientprotocol.com/protocol/session-setup
- `session/load` / `session/resume`: `{sessionId, cwd, mcpServers}`. `load` replays whole history as `session/update` (user_message_chunk, agent_message_chunk...) then responds; `resume` restores context with NO replay.
- `session/prompt`: `{sessionId, prompt: ContentBlock[]}`; the **response** (stopReason: `end_turn|max_tokens|max_turn_requests|refusal|cancelled`) ends the turn. https://agentclientprotocol.com/protocol/v1/prompt-turn
- `session/update` variants (`params.update.sessionUpdate`): `user_message_chunk, agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update` (toolCallId, title, kind, status pending/in_progress/completed, content), `plan, available_commands_update, current_mode_update, config_option_update, session_info_update, usage_update`, plus `notice`/`compaction_*` (capability-gated).
- `session/cancel` (notification): client must answer pending permission requests with `cancelled`; agent must finish the original `session/prompt` with stopReason `cancelled`.
- `session/request_permission`: params `{sessionId, toolCall (ToolCallUpdate), options[{optionId,name,kind}]}`; kinds `allow_once|allow_always|reject_once|reject_always` (UI hint only; agent owns scope). Reply `{outcome:{outcome:"selected",optionId}}` or `{outcome:{outcome:"cancelled"}}`. https://agentclientprotocol.com/protocol/tool-calls
- **Elicitation (ask-user equivalent):** agent->client `elicitation/create` with exactly one of `sessionId` (optionally `toolCallId`) or `requestId`; `mode: form|url`; `message`; form has flat `requestedSchema` (string, enum/oneOf, number, boolean, multi-select array). Response `action: accept|decline|cancel` + `content`. Client must advertise `capabilities.elicitation.{form,url}` or agent gets -32601. https://agentclientprotocol.com/protocol/v2/elicitation
- **Modes/models:** v1 has `session/set_mode` + `modes`; model selection via config options (`session/set_config_option {sessionId, configId, type, value}`, categories e.g. `mode`, `model`, `effort`).

**v2 (draft, in flight) changes:** `session/load` removed -> `session/resume` with `replayFrom:{type:"start"}`, plus `replay_complete` update; `set_mode`/`current_mode_update` removed in favor of config options; `session/request_permission` gains required `title`, optional `description`/`subject`; `session/cancel` no longer implicitly cancels pending permissions (use `$/cancel_request`); agent reports `state_update: requires_action` while blocked on permission; `session/delete` optional; `session/fork` draft only. https://agentclientprotocol.com/protocol/v2/migration  -> A client must handle both v1 and v2 for a while.

## 2. Adapters / agent support (https://agentclientprotocol.com/overview/agents)

| Agent | How | Notes |
|---|---|---|
| Claude Code | `@agentclientprotocol/claude-agent-acp` (npm; GitHub agentclientprotocol/claude-agent-acp). Older name `@zed-industries/claude-code-acp` (zed-industries/claude-code-acp) is the predecessor; use the new one. | Wraps the official Claude Agent SDK. Serves v1 and draft v2 (`CLAUDE_AGENT_ACP_PROTOCOL=v1|v2|auto`). v2 supports `session/resume` with replay, list, fork, close. Standalone binaries (no Node; `CLAUDE_CODE_EXECUTABLE`); `@preview` npm tag. Version seen: 0.64.0 (2026-07-30). Permission requests yes; modes via config option (list not documented on fetched page); model/effort via config. AskUserQuestion: exists but buggy in Zed (issue "panel closes", https://claudeissues.com/issue/82850-askuserquestion-tool-closes-the-panel-screen-when-used-via-claude-agent-acp-in-z); whether it maps to `elicitation/create` or a permission request is UNVERIFIED - test before relying on it. https://github.com/agentclientprotocol/claude-agent-acp |
| OpenCode | `opencode acp` (built in) | Most complete: new/load(replay)/resume/fork/list(cursor,cwd filter)/close/delete; config options model/effort/mode; permissions allow once/always/reject; questions as `elicitation.form` (secret-looking forms never sent; unshowable questions cancelled); one process serves many sessions; exits on stdin close; **one prompt at a time per session** (2nd concurrent prompt errors); load/resume/fork need original cwd. https://opencode.ai/docs/cli/acp/ |
| Codex CLI | `@agentclientprotocol/codex-acp` (new, built on Codex App Server). `zed-industries/codex-acp` / `npx @zed-industries/codex-acp` is archived. | Auth: ChatGPT sub, `CODEX_API_KEY`, `OPENAI_API_KEY`. Load/resume support UNVERIFIED. https://github.com/zed-industries/codex-acp |
| Gemini CLI | `gemini --experimental-acp` | Experimental flag (name may have changed; verify). |
| Others | Cline, Goose, Kiro, Qwen Code, Copilot (preview), Cursor, Junie, OpenHands, Pi (`pi-acp`), OpenClaw, Hermes Agent... | Registry on the agents page. |

## 3. SDKs
- TypeScript `@agentclientprotocol/sdk`: fluent `client()` API (registers typed handlers for client methods, connects to agent); `ClientSideConnection` is deprecated. Examples: https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples ; ref https://agentclientprotocol.github.io/typescript-sdk . https://agentclientprotocol.com/libraries/typescript
- Python `agent-client-protocol` (PyPI; 0.8.x seen; tracks schema versions; has a Gemini bridge example). https://github.com/agentclientprotocol/python-sdk
- Rust `agent-client-protocol` crate (0.14.x seen). Others exist.
- Client implementation = spawn subprocess, wire stdio streams into the SDK, implement handlers for `session/update`, `session/request_permission`, (fs/terminal if advertised), `elicitation/create`.

## 4. OpenCode `opencode serve` (HTTP)
https://opencode.ai/docs/server/ - `--port` (4096), `--hostname` (127.0.0.1); basic auth via `OPENCODE_SERVER_PASSWORD` (user `opencode`).
- Sessions: `GET/POST /session`, `GET/PATCH/DELETE /session/:id`, `POST /session/:id/abort|fork|revert|unrevert|summarize`.
- Messages: `POST /session/:id/message` (blocks until reply), `POST /session/:id/prompt_async` (204), `GET /session/:id/message`, `/command`, `/shell`.
- Permissions: `POST /session/:id/permissions/:permissionID` `{response, remember?}`.
- Events: SSE `GET /event` (first `server.connected`), `GET /global/event`. Question API not on fetched page (UNVERIFIED). Persistent server: sessions survive our restarts natively. There is also an OpenAPI spec/JS SDK (`@opencode-ai/sdk`) - UNVERIFIED here.

## 5. Claude Code headless and Agent SDK
- CLI: `claude -p ... --output-format stream-json --verbose [--include-partial-messages] [--input-format stream-json]`; `--resume <id>` / `--continue`; session_id appears in `system/init` and `result` events; `--permission-mode`, `--allowedTools`, `--permission-prompt-tool <mcp tool>` (hosts approvals), `--permission-prompts none`. In `-p` Manual mode, un-approved calls are **denied** unless a hook or permission-prompt-tool answers. `--session-id` flag: UNVERIFIED on fetched pages (exists in CLI to pin a UUID). SIGTERM leaves the turn unfinished with no result; use SIGINT/`interrupt()`. https://code.claude.com/docs/en/headless
- Agent SDK (`@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`): `query()` async generator; `canUseTool(toolName, input, {signal, suggestions})` -> `{behavior:"allow", updatedInput, updatedPermissions?}` | `{behavior:"deny", message}`. Same callback receives `AskUserQuestion` with `input.questions[{question, header, options[{label,description}], multiSelect}]`; return allow with `updatedInput:{questions, answers:{<question text>:<label or labels>}, response?}`. Callback may stay pending indefinitely; for long waits use a `PreToolUse` hook returning `defer` so the process can exit and resume later. Python needs streaming-input + dummy PreToolUse hook workaround for `can_use_tool`. AskUserQuestion unavailable in subagents. https://code.claude.com/docs/en/agent-sdk/user-input
- Sessions: stored at `~/.claude/projects/<encoded-cwd>/<id>.jsonl`; `resume: id`, `continue: true`, `forkSession: true`; `listSessions()`, `getSessionMessages()`, `renameSession`, `tagSession`; resume works from any cwd on the same machine; cross-host needs `SessionStore` adapter. https://code.claude.com/docs/en/agent-sdk/sessions

## 6. Recommendation

**Backend interface** (switchboard-internal, agent-agnostic): `startSession(cwd, opts)`, `prompt(sid, text) -> turn stream`, `events(sid)` (normalized: message chunk, tool_call, plan, permission_request, question, turn_end), `respondPermission(reqId, choice)`, `answerQuestion(reqId, answers)`, `cancel`, `resume`, `list`, `close`. Model it on ACP's shapes - they are already a good lowest common denominator (permission options with kinds; question as schema form; stopReason).

**Strategy: ACP client as the primary universal driver, with a native Claude Agent SDK driver as the first-class Claude backend (or at least a fallback).**
- ACP gives one code path for OpenCode (native, best-supported), Codex, Gemini, Goose, etc. Adding an agent = a spawn command.
- For Claude specifically, the ACP adapter is itself the Agent SDK underneath, so it adds a hop and a translation layer (AskUserQuestion mapping is unproven, adapter lags SDK features such as `defer`, deny-with-message, `updatedPermissions`, option previews). Since Claude is the first target and the SDK maps 1:1 to our needs, implement `ClaudeSdkBackend` directly and `AcpBackend` generically; validate with OpenCode via ACP. Keep OpenCode `serve` HTTP as an alternative driver only if ACP's one-process-per-client lifetime hurts.

**Pros of ACP:** one protocol, typed SDKs (TS/Python), streaming + permissions + elicitation + cancel + resume standardized; agents ship adapters maintained upstream.
**Cons:** protocol is mid v1->v2 migration (load vs resume, modes vs config options); capabilities vary per agent so the client must capability-gate everything; adapters are young and bug-prone (Zed AskUserQuestion issue); no standard "list all sessions across restarts" guarantee beyond optional `session/list`.

**Gotchas**
- *Process lifetime:* ACP agents are child processes tied to stdio; if switchboard dies, the agent dies (opencode exits on stdin close) and an in-flight turn plus any pending permission/question is lost. Run switchboard as a long-lived daemon with a per-agent process pool; consider keeping agent processes alive across idle periods but reaping by TTL. Pending permission/question state must live in switchboard memory (and be persisted as "orphaned: turn interrupted" on restart).
- *Resume after restart:* persist `{switchboard_id, agent, agent_session_id, cwd, mcpServers}`. On restart spawn the agent and call `session/resume` (no replay, cheap) or `session/load` (replay; use only to rebuild transcript). Use the original cwd (OpenCode requires it; Claude keys storage on it). Claude native: `resume: id`; sessions are host-local files, so back up `~/.claude/projects`. An interrupted turn is not continued automatically (`CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` exists).
- *Concurrency:* one active prompt per session (OpenCode errors on a second); serialize or queue per session in switchboard; different sessions can run in parallel in one agent process (OpenCode) but memory/CPU on the Pi matters. Queue `send_prompt` while a turn is active or expose steering explicitly.
- *Blocking requests vs MCP request/response:* permission and questions block the agent inside a pending JSON-RPC call (or `canUseTool` promise). MCP tools should be `get_pending_requests` + `respond`, not blocking calls; timeouts on pending requests need a policy (default deny/cancel vs wait). On cancel, answer all pending permissions `cancelled` (ACP requirement).
- *Non-interactive defaults:* headless Claude denies un-approved tools; ACP agents rely on the client to answer. Always advertise `elicitation.form` capability and test that each adapter actually uses it vs falling back to permission prompts or text.
- *Security:* "allow_always" persists rules in the agent's settings (Claude `localSettings`); decide whether switchboard may select it. Do not expose `fs/*` and `terminal/*` capabilities unless needed - agents then use their own tools.
- *Verify before committing design:* claude-agent-acp AskUserQuestion mapping, session/resume behavior, config option ids for mode/model; Codex-acp resume; Gemini flag name.
