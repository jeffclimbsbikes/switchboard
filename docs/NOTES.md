# switchboard — working notes

Goal: an MCP server that is the control plane for coding-agent sessions
(Claude Code first, any agent like OpenCode next): start, list, prompt,
resume, answer questions, stop. Remote connector for claude.ai (voice too),
self-hosted on your own server behind Cloudflare. Simple to add; configure where the
agent executable is.

## Requirements (from the owner, 2026-11-14)
- Voice Claude delegates to Claude Code, real back-and-forth: Claude Code can
  ask questions; voice answers from context or asks the owner in real time.
- "Fully fledged, legit" connector auth from claude.ai.
- Tell the owner when a job is done.
- Agent-agnostic (Claude Code, OpenCode, ...). Build our own; take ideas from
  claude-code-rc-mcp, claude-sessions-mcp, Spotify's thing ("XIRP"?).
- Tests + CI with no secrets.
- Design doc: draw.io diagrams, one whole-system diagram, few words.

## Log
- 14:20 research 01 (prior art) + 02 (protocols) in. Spotify's thing = **Xirp**
  (macOS app, worktree per task, vendor-neutral; not a protocol). Honk = Agent
  SDK in their own harness. Existing MCPs scrape tmux/TUI or use undocumented
  RC bridge API; neither can answer questions/approvals. Key primitive:
  Agent SDK `canUseTool` (approvals + AskUserQuestion, can stay pending).
- Decision: two drivers behind one interface — `claude` (Agent SDK direct,
  `pathToClaudeCodeExecutable` = "where is claude") and `acp` (any ACP agent
  by command: `opencode acp`, codex-acp, gemini). Normalized events modeled on
  ACP shapes (permission options with kinds; question as form; stopReason).
- Decision: every MCP call returns within max_wait (default 25s); "blocked"
  is a first-class state returned early; cursor-based `wait` long-poll.
- Decision: Node 22+/TypeScript, node:sqlite (no native deps), reuse
  @modelcontextprotocol/sdk auth router for the OAuth AS.
- 14:35 research 03 (auth) in. claude.ai: Streamable HTTP; 401 + resource_metadata;
  PRM + AS metadata; PKCE S256; CIMD+DCR; callback claude.ai/api/mcp/auth_callback;
  egress 160.79.104.0/21; 240s per tool call (reports of 30-60s) → cap waits ~25s;
  no elicitation/Tasks/standing GET stream → own poll pattern; Tunnel 524 after
  100s silence. Access Managed OAuth fails with claude.ai (#410) → avoid.
- Decision: switchboard = own OAuth 2.1 AS + resource server. Exact-host Access app
  switchboard.example.com = bypass (we check bearer); path app /authorize = owner only +
  WARP (the owner authorizes from their own WARP device); verify Cf-Access-Jwt-Assertion.
  WAF skip for 160.79.104.0/21. Verify precedence after apply. Voice + custom
  connectors: unconfirmed (open bug) → test day one; Telegram covers "done".
- 14:50 research 04 (CLI probe) in. claude 2.1.325: stream-json in/out multi-turn
  on one process; `--permission-prompt-tool stdio` → control_request can_use_tool
  (also AskUserQuestion) answered with control_response; interrupt keeps process
  usable; --session-id/--resume/--fork-session work. That's what the Agent SDK
  speaks → use the SDK (pathToClaudeCodeExecutable) and keep raw protocol as the
  fallback. ACP: current pkg @agentclientprotocol/claude-agent-acp 0.107.0
  (initialize advertises load/resume/fork/list). OpenCode 2.1.4: `opencode acp`,
  `opencode serve` (Basic auth, /api SSE). OpenCode events/questions unprobed →
  build-time spike.
- Diagram 1 (system) done.
- 15:30 diagrams 1-7 done (design/diagrams/d*_*.py → drawio CLI → svg with
  embedded source, png previews). Page: design/site/index.html.
  Rebuild: `cd docs/design/diagrams && for f in d*_*.py; do python3 $f; done`, copy
  svg+drawio into site/diagrams.

## Next (build order)
1. core + tools + FakeDriver over stdio   2. ClaudeDriver (+ fake-claude)
3. HTTP + OAuth (+ test JWKS)              4. server: systemd, Terraform, Telegram; voice test
5. AcpDriver (OpenCode spike first)        6. worktrees, per-tool rules, app link
Day-one spike: stub connector on switchboard.example.com to test voice + timeouts.

## Refresh (restart an agent, keep the conversation)
- Decision: a new small tool `refresh` (optional `session`), not a mode on `stop`.
  `stop` is marked destructive and means "end"; refresh is non-destructive and
  needs its own description so clients reach for it when instructions, skills or
  MCP servers changed. Omitting `session` is the bulk form.
- Decision: no `force`. A working or waiting session is refused (`busy`); the
  caller composes `stop` interrupt + `refresh`. Killing a turn or dropping a
  pending approval is a decision for the user, not a flag.
- Mechanics: idle live session = mark `starting` (so a racing `send` gets
  `busy`), retire the process, `resume` with the stored agent conversation id
  and `priorCostUsd`, then settle on `idle` and re-arm the park timer. No turn
  starts, so cost/turn totals are untouched. Parked = resume now. Failed, closed
  or id-less sessions error clearly.
- Bulk only restarts live idle sessions: parked ones have no process and already
  load fresh config on resume, and resuming them all would churn the live slots.
- The dashboard stays read-only; it lists the tool contract automatically.
