# switchboard — working notes

Goal: an MCP server that is the control plane for coding-agent sessions
(Claude Code first, any agent like OpenCode next): start, list, prompt,
resume, answer questions, stop. Remote connector for claude.ai (voice too),
self-hosted on pidev behind Cloudflare. Simple to add; configure where the
agent executable is.

## Requirements (from Jeff, 2026-11-14)
- Voice Claude delegates to Claude Code, real back-and-forth: Claude Code can
  ask questions; voice answers from context or asks Jeff in real time.
- "Fully fledged, legit" connector auth from claude.ai.
- Tell Jeff when a job is done.
- Agent-agnostic (Claude Code, OpenCode, ...). Build our own; take ideas from
  claude-code-rc-mcp, claude-sessions-mcp, Spotify's thing ("XIRP"?).
- Tests + CI with no secrets.
- Design doc in Trove: draw.io diagrams, one whole-system diagram, few words.

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
  build.rutang.cloud = bypass (we check bearer); path app /authorize = Jeff only +
  WARP (he authorizes from his own WARP device); verify Cf-Access-Jwt-Assertion.
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
  Published: https://trove.rutang.cloud/switchboard-design (zip site, preview card).
  Rebuild: `cd design/diagrams && for f in d*_*.py; do python3 $f; done`, copy
  svg+drawio into site/diagrams, zip site, upload with if_match.

## Next (build order)
1. core + tools + FakeDriver over stdio   2. ClaudeDriver (+ fake-claude)
3. HTTP + OAuth (+ test JWKS)              4. Pi: systemd, Terraform, Telegram; voice test
5. AcpDriver (OpenCode spike first)        6. worktrees, per-tool rules, app link
Day-one spike: stub connector on build.rutang.cloud to test voice + timeouts.
