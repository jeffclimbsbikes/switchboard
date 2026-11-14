# Prior art for switchboard

Researched 2026-11-14. Items marked (unverified) come from memory or secondary sources, not primary docs or source.

## 1. Spotify: the name is Xirp (and Honk, Fleetshift, Chirp)

The user's memory is right. "Xirp" is real, but it is a product, not a wire protocol.

- **Xirp** is a macOS desktop app, in beta since about 2026-08-10. Spotify describes it as a vendor-neutral agentic development environment. It runs Claude Code, Codex, Gemini CLI, Pi and Cursor, each authenticated through its own native CLI.
  - Each task gets its own **git worktree**. Agents live in **persistent terminal sessions** you can switch between, with a status view and grid layout.
  - Optionally it connects to Spotify Portal (Backstage). Catalog and workspace context reaches the agent **via MCP**, and finished session transcripts are uploaded so other engineers or agents can resume them.
  - The public docs do not say how Xirp drives agents (ACP, PTY or CLI wrapping), nor how it handles permissions, transcripts or resume. "Persistent terminal sessions" suggests PTY hosting.
  - Sources: https://backstage.spotify.com/docs/xirp/index.md, https://backstage.spotify.com/spotify-for-backstage-terms/xirp-preview-terms/, https://runtimewire.com/article/spotify-xirp-coding-agents-model-lock-in (paywalled, so only secondary coverage), https://medium.com/@tahirbalarabe2/what-is-spotify-xirp-cdb963efcb0c
- **Honk** is Spotify's background coding agent. It runs Claude through the **Agent SDK inside Spotify's own harness**, in Kubernetes pods, so many sessions run concurrently. It uses trusted tools and multi-OS CI as verification. Backstage is exposed to it as MCP servers and CLIs, which let it look up ownership and docs and contact owning teams on Slack.
  - **Fleetshift** (Fleet Management) picks targets, schedules changes and tracks PRs. It has produced more than 2.5M automated PRs.
  - Humans reach Honk by mentioning it in Slack. There is a "Goose Farm" live dashboard of active sessions.
  - **Chirp** is named in the post as the mechanism for agent orchestration in Honk v2, along with shared "multiplayer" sessions. It is not described anywhere I could find.
  - Source: https://engineering.atspotify.com/2026/6/code-with-claude-coding-is-no-longer-the-constraint
  - The post says nothing about how an agent asks a human a clarifying question beyond Slack.

Borrow from Spotify:
- Per-task worktrees.
- Delegate auth to each agent's native CLI.
- A status view across all sessions.
- MCP as the way to inject context.
- Run the SDK in your own thin harness.

Nothing here is a protocol we can adopt.

## 2. Existing MCP session controllers

### afonsofigs/claude-code-rc-mcp (single `server.js`, about 111 KB, Node 24, express + ssh2 + MCP SDK)

Source: https://github.com/afonsofigs/claude-code-rc-mcp (README.md, CLAUDE.md, server.js)

- **Architecture:** claude.ai -> HTTPS, OAuth 2.1 and Streamable HTTP -> this server -> **SSH** -> `tmux new-session -d 'claude --rc <name> [prompt]'`.
  - It exists because `claude --rc` (Remote Control) needs a TTY and has no headless mode.
  - Per-session state lives in `~/.claude-rc-mcp/<id>.{meta,url,log,prompt,debug,...}` on the dev host, so the MCP server itself is stateless.
- **Tools (9):**
  - `start_session(name, path, prompt?, bypass_permissions?, trust_folder?)`
  - `send_prompt(id, prompt, wait_seconds=90, max 240)`
  - `get_reply(id, wait_seconds=90, 0 means peek)`
  - `interrupt_session(id)`
  - `resume_session(id, bypass_permissions?)`
  - `list_sessions()`
  - `disconnect_session(id)`
  - `stop_session(id)`
  - `list_projects()`
- **Driving a session:**
  - Prompts are written as base64 to a file and read back with `"$(cat ...)"`, so they never touch a shell parser.
  - Follow-ups are typed into tmux as a **bracketed paste**. It sends Esc first if the session is busy, because a paste into a running turn becomes a queued attachment.
  - It launches with `--session-id` chosen by the server, so the transcript path is known, and with `--append-system-prompt` (including a note that pasted text is trusted).
  - It uses `tmux pipe-pane` for logs, because piping through `tee` makes Claude fall back to `--print`.
- **Reading replies:** it reads the JSONL transcript at `~/.claude/projects/<proj>/<uuid>.jsonl` and uses `stop_reason` on the assistant entry to decide the turn is over. The reply is anchored to the prompt, not the clock. It handles `/clear` moving to a new conversation and slash-command output.
- **Blocked detection:** primarily the CLI's own status file `<config>/sessions/<pid>.json` (`status: busy|idle|waiting`, `waitingFor`). Fallback is a strict regex on `tmux capture-pane` for the approval box. Startup states such as the folder-trust dialog are detected separately.
- **Answering questions or approvals:** **it cannot.** It reports "waiting for input, answer at claude.ai/code". The README suggests an `APPEND_SYSTEM_PROMPT` telling the agent not to use `AskUserQuestion` and to ask in plain text. Otherwise the user must use `bypass_permissions`.
- **Auth:** OAuth 2.1 with fixed client credentials derived from `MCP_SECRET`, tokens persisted to disk. An SSH key reaches the host. Claude Code itself must already be logged in.
- **Weaknesses:**
  - Depends on TUI details such as dialog text, the status file schema and the debug log line `Torn down (archive=200)`.
  - Closing a session means hanging up tmux so the bridge archives it, and a SIGKILL skips the archive.
  - One concurrent turn per session.
  - No structured approval handling.
  - Single 111 KB file.
  - Needs SSH hop plus tmux plus Remote Control.
- **Good ideas:** server-chosen `--session-id`, transcript + `stop_reason` as ground truth, state on the host, retention and expiry sweeps, a `wait_seconds` cap under the connector timeout with a "still working, call get_reply" result.

### jmunroe/claude-sessions-mcp (fork of gorynychzmey/claude-sessions-mcp; TypeScript, systemd user unit)

Source: https://github.com/jmunroe/claude-sessions-mcp (README.md, docs/superpowers/specs/2026-09-18-claude-sessions-mcp-design.md, src/tools.ts). I did not read the upstream beyond its file tree. It has the same layout plus `src/registry.ts` and no `tools-list` fixture. The fork adds `scripts/tools-list.mjs` and `tests/tools-list.test.ts`.

- **Architecture:** a single loopback-only (127.0.0.1) Streamable-HTTP MCP server per machine. It talks directly to the **Remote Control bridge REST API** that the bridge itself uses (undocumented, reverse-engineered on CLI 2.1.274). It uses no tmux, no SSH and no PTY.
- **Tools (8):**
  - `list_instances()`
  - `list_sessions(instance?)`
  - `spawn_session(instance, prompt, title?, effort?, permission_mode?, caller?, tags?, model?)`
  - `send_message(session_id, text)`
  - `read_session(session_id, limit?, cursor?, verbose?)`
  - `wait_for_idle(session_id, timeout_s=300)`
  - `archive_session`, `unarchive_session`, `delete_session`
- **API calls (all with Bearer = `claudeAiOauth.accessToken` read from `~/.claude/.credentials.json`, header `anthropic-beta: oauth-2025-04-20`):**
  - `POST /v1/code/sessions` (this alone starts a worker under the bridge)
  - `POST /v1/code/sessions/{id}/events` (a `user_message` event)
  - `GET .../events` (cursor-paged)
  - `GET .../events/stream` (SSE with `Last-Event-ID`)
  - `POST .../archive`, `unarchive`, `DELETE`
  - `POST /v1/environments/<env>/bridge/reconnect`
- **Reading replies:** the SSE stream emits `client_event` frames. A `result` event carries `result` text, `stop_reason`, `permission_denials`, `usage`, `total_cost_usd`. `wait_for_idle` resumes the stream from the newest sequence number so it does not replay old results. It polls session status alongside, because **archiving emits nothing on the stream**.
- **Blocked detection:** none as a first-class signal. `control_request` events appear in the log, but no tool answers them. It only exposes `permission_denials` after the turn.
- **Permissions:** it sends a `set_permission_mode` control request and waits for the `control_response` before posting the prompt, because the worker ignores `config.permission_mode` at create time. `bypassPermissions` is refused.
- **Safety rails:** per-bridge spawn ceiling (default 3, fail-closed if the count is incomplete), loopback-only bind with a Host-header allowlist, and `mcp:` and `spawned-by:` tags in place of a local database.
- **Weaknesses:**
  - Undocumented API that may change.
  - Relies on the user's claude.ai OAuth token and cannot refresh it.
  - Linux-only (reads `/proc` to find bridges).
  - Unarchive and restart do not wake a worker for about 6 minutes unless it reconnects.
  - Loopback-only, so it has no remote auth story.
  - Session list filters are ignored server-side.
  - Needs a running RC bridge.
- **Good ideas:** loopback bind plus Host allowlist, spawn ceiling, resumable SSE with sequence guards, a `cursor` on reads, condensed events with `verbose`, and tags in place of a database.

## 3. Other session managers and control planes

- **Claude Agent SDK** (https://code.claude.com/docs/en/agent-sdk/user-input) is the cleanest primitive for us.
  - `canUseTool(toolName, input, {signal, suggestions})` fires for tool approvals and for `AskUserQuestion`, and the callback **can stay pending indefinitely**.
  - The question input is `questions[{question, header, options[{label, description}], multiSelect}]`. You answer with `{behavior:"allow", updatedInput:{questions, answers:{<question>: <label>}}}`. Optional `response` is free text.
  - Approvals return `{behavior:"allow", updatedInput, updatedPermissions?}` or `{behavior:"deny", message}`.
  - A `PermissionRequest` hook can push notifications. A `PreToolUse` hook returning `defer` lets the process exit and resume later.
  - Streaming input lets you interrupt mid-turn. `AskUserQuestion` is unavailable in subagents.
  - This is exactly the "blocked on a question or permission, and answer it" primitive, and the connector approaches above cannot do it. A harness around the SDK can hold the pending promise, expose it as `pending_requests`, and resolve it from an MCP tool call.
- **Omnara** (https://github.com/omnara-ai/omnara) is a hosted agent platform. A daemon (`omnarad`) on your machine connects outbound, so there are no inbound ports. Each tool is configured as run-immediately, ask-a-human-first, or blocked, and the agent waits for approval. Steps are persisted in Postgres so the agent resumes after a crash. It also has an MCP server so one agent can launch others. The earlier open-source Omnara wrapped the Claude CLI and mirrored its permission prompts (https://hn.svelte.dev/item/44878650). Borrow the per-tool ask/allow/block policy and outbound-only connectivity.
- **Happy** (https://github.com/slopus/happy) wraps `claude` or `codex` as `happy claude` and syncs the session to a phone through an end-to-end-encrypted relay (`happy-server`). Its permission handling is not in the README. Mechanism worth studying is the relay model with E2E encryption, which would let the connector reach a Pi behind NAT.
- **Claude Squad** (https://claudeskills.info/harness/claude-squad/) runs one tmux session plus one git worktree per agent from a TUI. It has an AutoYes option that bypasses confirmations. It shows how simple the tmux model is, and where it stops, because approvals are only auto-yes.
- **Vibe Kanban** orchestrates each task in its own worktree and, per a third-party guide (unconfirmed), runs agents with permission checks skipped. The company shut down in April 2026 (https://nimbalyst-website.pages.dev/blog/best-agent-management-tools-2026/). Reminder that worktree isolation is not the same as sandboxing.
- **CCManager, agtx, Crystal/Nimbalyst, Conductor, Sculptor** (unverified, from memory and a survey: https://nimbalyst-website.pages.dev/blog/best-agent-management-tools-2026/): all are desktop or TUI apps built on worktrees plus PTY or CLI. Sculptor (Imbue) runs each agent in a Docker container, which is closer to our isolation needs. I did not confirm how any of them handle permissions.
- **`claude mcp serve`** (unverified, from memory): exposes Claude Code's own tools (Bash, Edit, View, ...) over stdio MCP. It does not manage sessions or turns, so it is not a competitor.

## 4. What to borrow / what to avoid

**Borrow**
1. **Run the Agent SDK in our own harness** (the Honk pattern) instead of scraping a TUI. `canUseTool` gives a structured pending-request object for approvals and `AskUserQuestion`. Resolve it with `answer_request(session_id, request_id, allow|deny|answers)`.
2. **Treat "blocked" as first-class state.** Session status should be `running | idle | blocked(request) | done | error`. A turn call returns early with the pending request instead of timing out.
3. **Bounded waits.** Cap `wait_seconds` below the connector timeout, and return "still working" plus a cursor. Offer a long-poll wait tool, backed by resumable SSE with sequence guards (claude-sessions-mcp).
4. **Server-chosen session IDs** and the transcript/result event as the source of truth, with `stop_reason` and `result` text as turn-end. Keep session state on disk on the Pi so the service restarts cleanly.
5. **Per-task git worktrees** (Xirp, Claude Squad), with an explicit permission mode per session.
6. **Policy per tool** (Omnara): allow, ask or deny rules, plus a hard refusal of `bypassPermissions` unless the user opts in per session.
7. **Spawn ceiling** and fail-closed counting, plus tags or metadata on sessions we created.
8. **Auth the connector properly.** claude.ai custom connectors need OAuth 2.1 over HTTPS (as in claude-code-rc-mcp), and the CLI itself keeps its own login. Reuse rc-mcp's pattern of a persisted token store. Keep the agent process on an unprivileged user per this repo's `agent`/`svc` model.
9. **Agent-neutral adapter boundary.** Xirp wraps Claude, Codex, Gemini and others through each CLI's own auth. Define our own `start / send / read / pending / answer / stop` interface and keep the Claude SDK behind it.
10. **Voice-friendly output.** Return short plain-text `summary` fields and question labels that read well aloud, since the intended front end is claude.ai voice mode.

**Avoid**
- **Scraping TUI text or status files** (rc-mcp). It breaks across CLI versions.
- **Undocumented bridge REST APIs and OAuth token reuse** (claude-sessions-mcp). A single API change breaks it, and the token is the user's claude.ai credential.
- **tmux plus bracketed paste as the main control path.** Keep it only as a fallback for attaching a human to a session.
- **Telling the agent to avoid `AskUserQuestion` as the way to answer questions.** It works around the lack of a structured answer path.
- **Worktrees presented as sandboxing** (Vibe Kanban). Isolation needs a user or container boundary.
- **Unbounded sessions with no retention or cleanup.**
- **Building on Honk-v2 or Chirp assumptions.** There is no public spec.
