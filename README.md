# switchboard

**An MCP server that is a control plane for coding-agent sessions.** Start,
steer, answer and resume [Claude Code](https://code.claude.com) or any
[Agent Client Protocol](https://agentclientprotocol.com) agent (OpenCode,
Codex, Gemini CLI, …) from any MCP client — including claude.ai, on your
phone, by voice.

You talk to Claude. Claude hands the work to a real coding agent on your own
machine, relays the agent's questions back to you, and you get a ping when it's
done.

![The whole system](docs/design/diagrams/1-system.png)

## What makes it different

- **Real back-and-forth.** When the agent asks a question (`AskUserQuestion`)
  or needs approval, the session goes to `waiting` and the question comes back
  through MCP as structured data. Claude answers from context or asks you.
  Nothing else we found could answer an agent's questions remotely.
- **Built for flaky, short-lived calls.** Every tool returns within
  `max_wait` (25 s by default); long work is followed with `wait` and a cursor.
  Hang up mid-build and nothing is lost.
- **Any agent.** Claude Code is driven through the official Agent SDK; every
  other agent through ACP. Adding one is a config entry.
- **Legit remote auth.** A full OAuth 2.1 server (PKCE, CIMD + DCR, RFC 9728 /
  8414 / 8707) of its own, so claude.ai connects as a normal custom connector.
  Human sign-in is delegated to Cloudflare Access (or run it locally with no
  auth over stdio).
- **Sessions survive.** State lives in SQLite; idle sessions park and resume
  with their context; a restart doesn't lose anything but the in-flight turn.

## Tools

| Tool | What it does |
| --- | --- |
| `agents` | configured agents and workspaces, with their descriptions |
| `start` | new session on a task; returns within ~10 s with its state |
| `send` | follow-up in a session (resumes parked ones) |
| `wait` | progress since a cursor: activity, a pending question, or the reply |
| `respond` | answer a question or approval in the user's words (“blue”, “2”, “allow”) |
| `sessions` | everything, one line each |
| `stop` | interrupt the turn or close the session |

The server's MCP instructions tell the client it is pairing with a live agent:
relay questions, keep the user posted, don't go silent in voice.

## Quick start (local, Claude Code or Claude Desktop)

```sh
git clone https://github.com/jeffclimbsbikes/switchboard && cd switchboard
npm ci && npm run build
mkdir -p ~/.config/switchboard && cp switchboard.example.toml ~/.config/switchboard/config.toml
$EDITOR ~/.config/switchboard/config.toml     # set a workspace
node dist/cli.js check
claude mcp add switchboard -- node "$PWD/dist/cli.js" stdio
```

Node 22.13+ is required. `switchboard check` confirms the agent executables
and workspaces exist.

## Choosing an agent and workspace

Give every agent and workspace a short `description` (max 300 characters) so
the client can pick by what each is for. It is optional; the `agents` tool
lists them and the client falls back to the defaults.

```toml
[agents.claude]
driver = "claude"
description = "Strongest model; best for hard or open-ended work."

[workspaces]
site = { path = "~/src/site", description = "My website", default = true }
scratch = "~/scratch"          # the plain path form still works
```

## Remote: claude.ai as the client

Run `switchboard serve` behind HTTPS and add `https://<host>/mcp` as a custom
connector in claude.ai (Settings → Connectors). The recommended setup is a
Cloudflare Tunnel with two Access applications:

| Host / path | Access policy | Why |
| --- | --- | --- |
| `<host>/authorize` | allow your email (optionally + WARP) | the only human step; switchboard verifies the Access JWT |
| `<host>` (everything else) | bypass | claude.ai's servers call `/mcp`, `/token`, discovery; switchboard checks its own bearer tokens |

Then set `[auth] login = "cloudflare-access"` with your team, the AUD tag of
the `/authorize` application, and the allowed emails. See
[docs/design](docs/design/site/index.html) for the full flow and diagrams.
`switchboard grants` lists connected clients; `--revoke` signs them all out.

Notifications (Telegram, ntfy, or any command) fire when a turn ends, the
agent needs you, or it fails — but only if no client is already waiting.

## Multiple people

By default everyone who can sign in is the admin: all agents, all workspaces,
all sessions. List someone under `users` (keyed by the email they sign in with)
to restrict them. They only see the agents and workspaces you list (omit a list
for "all"), the first listed one is their default, and they only see and act on
sessions they started. Someone else's session looks exactly like a missing one.
Emails not listed stay unrestricted, and so do stdio and `auth = "none"`.

```toml
[users."diana@example.com"]
agents = ["diana"]
workspaces = ["diana-site"]
notify_chat = "123456789"     # her Telegram chat; needs [notify.telegram] for the bot token
```

To give her a less-privileged agent, run it as another Unix user with `run_as`
on a `claude` or `acp` agent:

```toml
[agents.diana]
driver = "claude"
run_as = "diana"
```

switchboard then starts the agent with `sudo -n -u diana -H`, so it needs a
sudoers rule such as `switchboard ALL=(diana) NOPASSWD: ALL`. The target user
must be able to execute the agent binary and read the workspace. Only `PATH`,
`CLAUDE_*`, `ANTHROPIC_*` and `SWITCHBOARD_*` variables (plus an acp agent's
configured `env`) are passed through; the agent gets her `HOME`, her
credentials, and her permissions.

## Security model

switchboard runs coding agents with whatever permissions you configure; with
`bypassPermissions` anyone who can call it can run code as that user. So:
remote access always goes through OAuth with an email allowlist, `auth =
"none"` and `"dev"` refuse to listen beyond loopback, tokens are stored hashed
and refresh tokens rotate with reuse detection. Run it as a user whose blast
radius you accept.

## Development

```sh
npm run check            # biome + tsc + vitest (no network, no secrets)
SWITCHBOARD_LIVE=1 npx vitest run test/live   # real claude (haiku) + opencode handshake
```

Every outside dependency has a stand-in in `test/fixtures`: a fake `claude`
CLI speaking its stream-json control protocol, a fake ACP agent, a local JWKS
for Cloudflare Access. One driver contract suite
(`test/contract/driver-contract.ts`) runs against every driver.

## License

MIT
