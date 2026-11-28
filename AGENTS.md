# AGENTS.md

Instructions for coding agents working in this repository. `CLAUDE.md` is a
symlink to this file.

## What this is

switchboard is an MCP server that lets a chat client (claude.ai, Claude Desktop,
voice) start, steer, answer and resume real coding-agent sessions (Claude Code
through the Agent SDK, OpenCode or any ACP agent) on a machine you control.
What and why: `README.md`. Design, diagrams and decisions:
`docs/design/site/index.html` and `docs/NOTES.md`.

This repository is **public and generic**. Never add personal names, emails,
domains, hostnames, IPs, account IDs or details of anyone's own deployment to
code, tests, docs or examples. Deployment-specific config belongs in the
deployer's own repo, not here.

## Layout

- `src/core/`: session manager, store (node:sqlite), answers/requests broker,
  policy (per-user access), usage, archive and history, notifier.
- `src/drivers/`: the `Driver` contract (`driver.ts`) and its implementations:
  Claude Agent SDK (`claude.ts`), ACP (`acp.ts`), `fake.ts` for tests,
  `run-as.ts` for running an agent as another Unix user.
- `src/mcp/server.ts`: the MCP tool surface and the instructions sent to clients.
- `src/http/`: Streamable HTTP transport, OAuth 2.1 authorization server
  (`auth/`), dashboard (`dashboard/`).
- `src/cli.ts`: `serve`, `stdio`, `check`, `grants`, `archive`.
- `test/`: vitest suites plus fixtures (fake Claude, fake ACP agent, fake sudo,
  fake Claude login). Live tests are skipped unless explicitly enabled.

## Working rules

- Keep the tool surface small and the contracts in `src/types.ts`,
  `src/drivers/driver.ts` and `src/core/api.ts` stable; changes are additive.
- New behaviour comes with tests against the public surface (MCP tools,
  `SessionManagerApi`, driver contract), using the fakes rather than real agents.
- Record notable design decisions in `docs/NOTES.md`; update `README.md` when the
  tool surface or configuration changes, and the design site if it lists them.
- Before declaring work done, run `npm run check` (biome lint, `tsc --noEmit`,
  vitest) and read the real exit code; don't pipe test output through `tail`.
- `npm run build` compiles to `dist/`.
