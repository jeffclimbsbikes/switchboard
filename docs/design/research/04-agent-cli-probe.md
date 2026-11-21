# 04 - Agent CLI probe: driving Claude Code and OpenCode programmatically

Probed 2026-11-14 on this Mac. Installed: `claude` 2.1.325 (not .319), `opencode` v2.1.4 (Homebrew). Model for all Claude calls: `--model haiku` (resolves to `claude-haiku-5-5`). Total spend about 0.01 USD. No opencode model prompts were run. Raw captures were not kept in the repo.

Isolation flags used for every Claude call: `--setting-sources "" --strict-mcp-config` (plus `--tools ""` or `--tools Bash`), `</dev/null` when not using stdin input, cwd `/tmp/cc1`.

## 1. Claude Code

### 1.1 One-shot stream-json

```
claude -p "reply with the word ok" --model haiku --output-format stream-json --verbose \
  --session-id <uuid> --setting-sources "" --strict-mcp-config --tools "" </dev/null
```

`--verbose` is required with `stream-json`. Event sequence (newline-delimited JSON):

| line `type` / `subtype` | Notes |
|---|---|
| `system` / `init` | `session_id`, `cwd`, `tools`, `mcp_servers`, `model`, `permissionMode`, `claude_code_version`, `slash_commands`, `skills`, `agents`, `plugins`, `capabilities`, `messaging_socket_path` |
| `assistant` | `message` is a full Anthropic message (`content[]` of `text`, `thinking`, `tool_use`, with `usage`). One line per content block or message, not token deltas |
| `user` | `message.content[]` holds `tool_result` blocks (`tool_use_id`, `is_error`, `content`) |
| `rate_limit_event` | informational |
| `system` / `status`, `thinking_tokens` | seen in some turns |
| `result` / `success` | see below |

`result` fields: `subtype`, `is_error`, `result` (final text), `session_id`, `num_turns`, `duration_ms`, `duration_api_ms`, `ttft_ms`, `total_cost_usd` (0.00062 for the "ok" call), `usage`, `modelUsage`, `stop_reason`, `terminal_reason` (`completed`), `permission_denials[]` (`tool_name`, `tool_use_id`, `tool_input`), `uuid`.

Token-level streaming: add `--include-partial-messages` for `stream_event` lines (`{"type":"stream_event","event":{"type":"message_start",...}}`, i.e. raw Anthropic SSE events). Subagent text: `--forward-subagent-text`. Hooks: `--include-hook-events`.

### 1.2 Multi-turn on one process (`--input-format stream-json`)

Works. One process, two user lines on stdin with a pause between them:

```
{"type":"user","message":{"role":"user","content":"remember the number 7, reply ok"}}
{"type":"user","message":{"role":"user","content":"what number did I say? one word"}}
```
flags: `-p --input-format stream-json --output-format stream-json --verbose --replay-user-messages`

Output: `system init`, `user` (replayed, `isReplay:true`), `assistant "ok"`, `result`; then again `system init`, `user`, `assistant "7"`, `result`. So:
- One `result` per user turn; a fresh `system init` is emitted at the start of each turn (same session_id). Turn boundary = `result`.
- Context persists across turns in-process (answered 7).
- `--replay-user-messages` echoes stdin messages as acks (`isReplay` true).
- Process stays alive until stdin closes. Messages sent mid-turn are queued (`queue-operation` entries in the transcript; `result.queued_turn_count`).
- stdin user content may be a string or a content-block array.

### 1.3 Session ids, resume, continue, transcripts

- `--session-id <uuid>` is honored: init and result `session_id` equal the supplied UUID.
- `--resume <id>` (works with `-p`): same session_id, context retained (asked "what word did you reply earlier" -> `ok`). Appends to the same file.
- `--continue`: resumes most recent session in the cwd, same session_id.
- `--resume <id> --fork-session`: new session_id (`1585e836-...`), new transcript file; original untouched.
- `--no-session-persistence` (print only): nothing written, not resumable. `-n/--name` sets a display name; `--resume` accepts a name.
- Transcript: `~/.claude/projects/<slug>/<session_id>.jsonl`, where slug is the real cwd with `/` replaced by `-` (macOS resolves symlinks: `/tmp/cc1` -> `-private-tmp-cc1`). Lines start with `session-owner`, `queue-operation` (enqueue/dequeue), then `user`/`assistant` records with `parentUuid`, `isSidechain`, `promptId`, `sessionId`. Resume is keyed on cwd + id, so the server must spawn in the same cwd.

### 1.4 Permissions headless

Findings, each tested with `--tools Bash` and the prompt "run: echo hello > f.txt":

1. **Plain `-p`, no flags (default mode)**: tool is denied automatically. The `tool_result` has `is_error:true` ("Output redirection ... needs approval"), the file is not created, and `result.permission_denials[]` lists `{tool_name, tool_use_id, tool_input}`. The model usually replies with text asking for approval. Detection = denials in `result` after the turn; no way to approve mid-turn. `--permission-prompts none` makes this explicit; `host` is the other value.
2. **`--permission-prompt-tool stdio` with `--input-format stream-json`** (best fit for us). Claude emits on stdout:
   ```
   {"type":"control_request","request_id":"642b24bf-...","request":{"subtype":"can_use_tool","tool_name":"Bash",
     "display_name":"Bash","input":{"command":"echo hello > f.txt","description":"..."},"description":"...",
     "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"echo hello *"}],
        "behavior":"allow","destination":"localSettings"},
        {"type":"addDirectories","directories":["/private/tmp/cc1"],"destination":"session"}],
     "blocked_path":"/private/tmp/cc1/f.txt","tool_use_id":"toolu_01..."}}
   ```
   Reply on stdin:
   ```
   {"type":"control_response","response":{"subtype":"success","request_id":"<same>",
     "response":{"behavior":"allow","updatedInput":{...original input...}}}}
   ```
   Result: tool ran, file created, `permission_denials` empty. Deny is `{"behavior":"deny","message":"..."}` (standard SDK shape; allow path verified, deny not run). The turn blocks until we answer, so the MCP server can hold it open while a human decides. `permission_suggestions` can be echoed back (`updatedPermissions`) to implement "always allow".
3. **`--permission-prompt-tool mcp__<server>__<tool>`** with `--mcp-config`: also works. Tool is called with `{tool_name, input, tool_use_id}` (verified with a 20-line stdio MCP server) and returns text content that is JSON `{"behavior":"allow","updatedInput":{...}}`. File was created. Less rich than stdio (no suggestions/blocked_path) and requires a separate MCP process, so stdio is preferred.
4. **`--allowedTools "Bash(echo *)"`**: did NOT unblock `echo hello > f.txt`. The redirect triggers a separate write/path check that rules on the command prefix do not cover; still denied. Allow rules are fragile for shell. `--permission-mode acceptEdits|auto|dontAsk|plan|bypassPermissions|manual` exist (`--dangerously-skip-permissions` too); not individually run.
5. **AskUserQuestion**:
   - Plain `-p`: tool is not offered. The model ran ToolSearch (`select:AskUserQuestion`, "No matching deferred tools found") and asked in plain text instead. With `--tools AskUserQuestion` over stdio it exists.
   - With stdio control protocol: arrives as a `can_use_tool` control_request with `tool_name:"AskUserQuestion"`, `requires_user_interaction:true`, `input:{questions:[{question,header,multiSelect,options:[{label,description}]}]}`. Answer by allowing with `updatedInput = {...input, answers:{"<question text>":"<chosen label>"}}`. The model then saw: `Your questions have been answered: "Do you prefer cats or dogs?"="Cats"` and continued. Multi-select answers and free text ("Other") were not tested.
   - So: clarifying questions and permission requests are the same event kind, distinguished by `tool_name`.

### 1.5 Cancel

On a `-p --input-format stream-json` process: send
```
{"type":"control_request","request_id":"int1","request":{"subtype":"interrupt"}}
```
-> `control_response` `{"subtype":"success","request_id":"int1","response":{"still_queued":[]}}`, then the turn ends with `result` `subtype:"error_during_execution"`, `is_error:true`, `terminal_reason:"aborted_streaming"` (no `result` text key). The process stays alive and the next user message works (replied "ok"). Note: `result.result` can be missing; parse defensively. Killing the process is the hard-cancel fallback, and the session remains resumable from the transcript.

### 1.6 Other flags worth knowing
`--max-budget-usd`, `--model`, `--effort`, `--system-prompt`/`--append-system-prompt`, `--add-dir`, `--settings <file|json>`, `--bare`, `--restricted`, `--agent/--agents`, `--bg/--background` (+ `claude attach|logs|stop`), `--fork-session`, `--fallback-model`. `apiKeySource` appears in init (not printed here).

### 1.7 ACP adapters (npm)

| package | version | bin | status |
|---|---|---|---|
| `@zed-industries/claude-code-acp` | 0.16.2 | `claude-code-acp` | **deprecated**, "renamed to @agentclientprotocol/claude-agent-acp" |
| `@zed-industries/claude-agent-acp` | 0.23.1 | `claude-agent-acp` | older name of the new package, stale |
| `@agentclientprotocol/claude-agent-acp` | 0.107.0 | `claude-agent-acp` | current |

`npx -y @agentclientprotocol/claude-agent-acp` runs (stdio JSON-RPC, started within ~20s) and answered `initialize` (protocolVersion 1) with: `loadSession:true`, `promptCapabilities {image, embeddedContext}`, `mcpCapabilities {http, sse}`, `sessionCapabilities {list, resume, fork, close, delete, title, status, options, additionalDirectories, systemPrompt}`, `agentInfo {name:"@agentclientprotocol/claude-agent-acp", version:"0.107.0"}`, `_meta.claudeCode.promptQueueing`, `_meta.steering.supported`. I did not run a session/prompt through it (would use auth). It wraps the Claude Agent SDK, so it offers ACP `session/request_permission` natively.

## 2. OpenCode v2.1.4

This is the new v2 CLI (not the old `opencode run/serve` of 0.x/1.x); flags below are as printed.

- `opencode run [message...]`: flags `--format default|json`, `--session/-s <id>` ("continue, or create if it does not exist", so caller-chosen ids), `--continue/-c`, `--fork`, `--model/-m provider/model#variant`, `--agent`, `--file/-f`, `--title`, `--thinking`, `--auto` ("auto-approve permissions not explicitly denied"), `--server <url>`, `--standalone` (private server instead of the background service). No interactive permission path in `run` apart from `--auto`.
- Architecture: every command talks to a **background service** (`opencode service start|status|stop|restart|get`). A service was already running here (`opencode service status` -> `http://127.0.0.1:49374`, process `opencode serve --service`). `opencode api <operationId | METHOD path> [-d body] [--param k=v]` calls it from the shell; `opencode pair`, `opencode mini` exist.
- `opencode acp`: "Start an Agent Client Protocol server" (flag `--login` only). Not exercised. 
- `opencode serve [--hostname --port --cors --service --stdio]`: "Start the v2 API and web server". Started on `127.0.0.1:47214`; prints `server listening on http://127.0.0.1:47214` and **`server password <random>`**. Auth: HTTP Basic with username `opencode` and that password returns 200; no/other auth returns `401 {"_tag":"UnauthorizedError"}`; Bearer did not work. Server killed afterwards (the pre-existing service was left alone).
- OpenAPI: `GET /openapi.json` (OpenAPI 3.1, "opencode HttpApi", 124 paths). `/doc` is an HTML page. API prefix is `/api`. Sessions exist already (`GET /api/session` -> `{"data":[...]}`, envelope `{"data": ...}`).

Endpoints relevant to us (operationId):

| need | endpoint |
|---|---|
| create | `POST /api/session` (`session.create`) body `{id?, parentID?, title?, agent?, model?{id,providerID,variant}, location?{directory}, metadata?, permissions?[Permission.Rule]}` |
| list/get/delete | `GET /api/session`, `GET|DELETE|PATCH /api/session/{id}`, `GET /api/session/active` |
| prompt a turn | `POST /api/session/{id}/prompt` body `{id?, text, files?, agents?, skills?, metadata?, delivery?: "steer"|"queue", resume?}` -> `{data: Session.Inbox.User}`. Returns immediately; reply arrives via events/messages. Inbox: `GET /api/session/{id}/inbox`, `DELETE|PATCH .../inbox/{inboxID}` (cancel/edit queued input) |
| stream | `GET /api/event` (`event.subscribe`, `text/event-stream`, items `{id, event, data}`; payload schema is opaque `V2EventEncoded` in the spec, so event type names must be captured empirically) |
| history | `GET /api/session/{id}/message`, `.../message/{messageID}`, `.../context`, `.../diff` |
| permission | `GET /api/permission/request` (all pending), `GET /api/session/{id}/permission`, `POST /api/session/{id}/permission/{requestID}/reply` body `{decision:"once"|"always"|"reject", message?}` -> 204; saved rules via `/api/permission/saved` |
| questions | "forms": `GET /api/session/{id}/form`, `GET .../form/{formID}`, `POST .../form/{formID}/reply` body `{answer: object}` -> 204, `DELETE` to cancel. Form schema has Fields: String, Boolean, Integer, Number, Multiselect, External, with `Option` and `When`. (Assumed to be what the question tool surfaces; not confirmed live.) |
| cancel | `POST /api/session/{id}/interrupt` (`resume` param) |
| other | `fork`, `compact`, `switchModel`, `switchAgent`, `revert/*`, `shell`, `command`, `generate`, `experimental/session/{id}/wait`, `export/import`, `/api/pty/*` |

Models: `opencode models` lists `ollama-cloud/*` (e.g. `gpt-oss:20b`, `glm-5.3-flash`, `kimi-k3`, ...) and others (truncated at 20). Per the repo's CLAUDE.md, ollama-cloud has a weekly quota that was burned before, so I ran no prompts. Untested: actual event names, how a pending permission appears in the SSE stream, `opencode run --format json` shape, `opencode acp` handshake.

## 3. Implications for the switchboard design

- Claude: spawn one long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio [--include-partial-messages] [--session-id U | --resume U]` per session in a fixed cwd. Turn = user line -> events -> `result`. Permission and AskUserQuestion both arrive as `control_request/can_use_tool`; answer with `control_response`; cancel with `interrupt` control_request. Persisted state is just the transcript file plus cwd, so the server can restart and `--resume`.
- Alternative for Claude: `@agentclientprotocol/claude-agent-acp` gives the same capabilities over ACP, and `opencode acp` would let one ACP client cover both agents. Worth a follow-up probe of both ACP servers (`session/new`, `session/prompt`, `session/request_permission`) before choosing between "native per-agent adapters" and "ACP only".
- OpenCode: use the HTTP API (`serve` with Basic auth) rather than `run`; SSE for events, REST replies for permissions/forms. Needs an event-shape capture with a real (cheap) model before finalizing the mapping.
- Gotchas: `--allowedTools` prefix rules do not cover shell redirects; `result.result` may be absent on abort; `system init` repeats each turn; slug uses the resolved path (`/private/tmp`); opencode server password is per-start.
