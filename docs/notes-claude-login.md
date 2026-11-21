# Notes: headless Claude Code login

Researched read-only on the Pi (Claude Code 2.1.326, Debian/Trixie, aarch64). No login was
completed, no code was pasted, no token was read or copied. Probing used a throwaway
`CLAUDE_CONFIG_DIR` and was killed at the prompt.

## Commands

- `claude auth login [--claudeai | --console] [--email <e>] [--sso]`: sign in (`--claudeai`, the
  subscription flow, is the default).
- `claude auth status [--json | --text]`: JSON by default. Exit 0 when logged in, 1 when not.
  Prints JSON in both cases.
- `claude auth logout`, `claude setup-token` (long-lived token, subscription only; not used here).
- No `login` top-level subcommand beyond `auth login`; no env var is needed to start a login.

## `claude auth login` behaviour

- Does not need a TTY. Plain pipes (stdin, stdout, stderr all pipes) work, so no `script`/PTY is
  required. Under `script -qfc` it behaves the same, plus OSC 8 hyperlink escapes around the URL.
- Output, in order:
  ```
  Opening browser to sign in…
  If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=…&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=…&code_challenge=…&code_challenge_method=S256&state=…
  Paste code here if prompted > 
  ```
  The URL is a single unwrapped line (about 530 chars). The prompt has no trailing newline.
- The redirect URI is `platform.claude.com/oauth/code/callback`, a hosted page that displays a
  code (form `<code>#<state>`). The user copies it and it is pasted on stdin followed by newline.
  There is no usable automatic path: although the CLI also opens a loopback listener (127.0.0.1,
  random port), the authorize URL does not redirect to it, and the Pi is not the user's browser.
- With stdin at EOF it exits non-zero: `Couldn't log in: Input ended before a code was pasted. ...`
  So the process must keep stdin open while waiting.
- It tries to open a browser (fails harmlessly on a headless Pi).
- Credentials land in `$CLAUDE_CONFIG_DIR` (default `~/.claude`) `/.credentials.json`, mode 0600,
  plus `.claude.json`. An unrelated fresh config dir starts logged out.

## Reading status without secrets

`claude auth status` (about 0.3 s, also via `sudo -n -u <user> -H -- /usr/bin/claude auth status`)
returns, for a claude.ai login: `loggedIn`, `authMethod`, `loginExpiresAt` (ISO time the stored
login, i.e. refresh credential, ends), `subscriptionType`, `storedClaudeAiLogin`, `planTier`,
plus identity fields (`email`, `orgId`, `orgName`) that switchboard deliberately drops. Logged out:
`loggedIn:false`, `loginExpiresAt:null`, exit 1.

`~/.claude/.credentials.json` holds `claudeAiOauth.{accessToken, refreshToken, expiresAt,
refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier}`. `expiresAt` is the short-lived
access token and is refreshed automatically; `loginExpiresAt` from `auth status` is the number that
matters (about 3 weeks out at the time of research). Switchboard never reads this file.

Status mapping used by switchboard:

| `auth status`                                  | status                |
|------------------------------------------------|-----------------------|
| `loggedIn` and `loginExpiresAt` > 3 days away  | `logged_in`           |
| `loggedIn` and `loginExpiresAt` < 3 days away  | `expiring`            |
| not `loggedIn`, `storedClaudeAiLogin` true     | `expired_refreshable` |
| not `loggedIn` otherwise                       | `logged_out`          |
| command failed, timed out or unparseable       | `unknown`             |

`expired_refreshable` is inferred from the field name and could not be exercised without an
expired login; the dashboard treats it like logged out (needs a login).

## Agent SDK

`@anthropic-ai/claude-agent-sdk/sdk.d.ts` has no login API. It only reports state: `SDKAuthStatus`
(`type: 'auth_status'`), `ApiKeySource`, `credential_expires_at` on results, and the
`forceLoginMethod` setting. Login must go through the CLI.

## Accounts on the Pi

Agents: `claude` runs as jeff (`~/.local/bin/claude`), `apps` as `diana` (`/usr/bin/claude`).
jeff has passwordless sudo, which is how switchboard (running as jeff) reaches diana's login
the same way `run_as` agents are launched. `svc` and `agent` have no Claude login.
