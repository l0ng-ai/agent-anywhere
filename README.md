<div align="center">

### Agent Anywhere

**Your coding agent, in every chat app.**

[![CI](https://github.com/l0ng-ai/agent-anywhere/actions/workflows/ci.yml/badge.svg)](https://github.com/l0ng-ai/agent-anywhere/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

Agent Anywhere is a gateway daemon that puts a coding agent — Claude Code,
Gemini CLI, Codex, or anything speaking the
[Agent Client Protocol](https://agentclientprotocol.com) — behind your chat
bots. DM it on Telegram or @-mention it on Discord: the agent runs with full
tool access on your machine and streams its answer into a single message that
edits in place.

## Features

- **Seven platforms, one daemon** — Discord, Telegram, Slack, Lark, QQ, LINE, WeCom; any number of instances (multi-account included) from one config file.
- **Any ACP agent, per-message routing** — define several agents (harness, model, cwd) and route by platform, server, channel, user, or slash command.
- **Native-feeling streaming** — throttled in-place edits, live tool-call bubbles, burst merging, interrupt-on-new-message; platforms without editing fall back to chunked sends measured in rendered length.
- **The agent acts in the chat** — over a local socket it sends files, reacts, replies, opens threads, and asks blocking button questions (`agent-anywhere ask`), never touching a channel id.
- **Small config** — five sections, typed per-platform credentials, `${VAR}` and `.env` expansion; experience tuning is frozen in code.

## Quick start

```bash
npm install -g agent-anywhere-cli

agent-anywhere setup    # wizard: pick platform, paste credentials, choose the agent
agent-anywhere doctor   # self-check: config / credentials / ACP SDK / harness
agent-anywhere start    # start the daemon — now message your bot
```

Authentication belongs to the agent, not the gateway: `harness: claude` reuses
this machine's `claude /login` session by default — log in once, no API key.
(Fine for personal use under the ToS; a multi-user service requires an API key.)

### Or let your agent set it up

Paste this into Claude Code (or any coding agent):

```text
Set up https://github.com/l0ng-ai/agent-anywhere for me: install the CLI
(npm i -g agent-anywhere-cli) and its skill (npx skills add
https://github.com/l0ng-ai/agent-anywhere/tree/main/skill -g), then follow
the skill to configure and start it.
```

## Agent skill

The daemon already injects a one-line hint each turn so any agent can discover
the reverse commands. For the full playbook — sending files, threads, blocking
button questions (`ask`), reading history, and safely editing the gateway
config from inside the chat — install the bundled
[skill](skill/SKILL.md) into your agent with
[skills](https://github.com/vercel-labs/skills):

```bash
npx skills add https://github.com/l0ng-ai/agent-anywhere/tree/main/skill -g
```

`-g` installs it user-wide (recommended — the agent's working directory is set
per agent in `agents[].cwd`); drop it to install into the current project only.
The skill also ships inside the npm package (`agent-anywhere-cli/skill/`) if
you prefer to copy it manually.

## Platforms

| | Discord | Telegram | Slack | Lark | QQ | LINE | WeCom |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Streaming in-place edit | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Lifecycle reactions | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| Typing indicator | ✓ | ✓ | – | – | – | ✓ | – |
| Native reply | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Threads / auto-thread | ✓ | ✓ | ✓ | – | – | – | – |
| Buttons (`ask`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Slash commands | ✓ | ✓ | ✓ | – | – | – | – |

Outbound markdown is rendered per platform (Telegram entities, Slack mrkdwn,
plain-text flattening for LINE/WeCom); missing capabilities degrade honestly.

## Configuration

```yaml
version: 1

platforms:                    # named instances; the key is the instance id
  discord-main:
    type: discord             # discord|telegram|slack|lark|qq|line|wecom
    token: ${DISCORD_TOKEN}   # every string supports ${VAR}
    chat:
      requireMention: true    # group channels need an @mention
  telegram-bot:               # same type twice = multi-account
    type: telegram
    token: ${TELEGRAM_TOKEN}

agents:                       # at least one; routing picks by id
  - id: claude
    harness: claude           # claude|gemini|codex|custom
    cwd: ~/projects/main
  - id: codex
    harness: codex

routing:
  default: claude
  pipeline:                   # ordered; first match wins
    - when: { platform: telegram-bot }
      use: { agent: codex }
    - when: { command: "/review" }
      use: { agent: claude }

session:
  scope: per_channel          # per_thread|per_channel|per_user|shared

access:
  allowFrom: ["discord-main:123456"]   # <instanceId>:userId; empty = anyone
```

Credentials are typed and validated per platform
(`src/platform/config-schemas.ts`). `${VAR}` expands from the environment plus
a `<configDir>/.env` sidecar, so the YAML can be committed. For several
deployments, keep one file per deployment and pick it with `--config <path>`.

Conversation context is persistent: it survives daemon restarts (sessions are
resumed via ACP `session/load`) and is cleared only when the user sends `/new`
or `/clear` in the chat.

> **Security:** agents run with full tool access — an empty `access.allowFrom`
> means anyone who can message the bot can drive Bash on your machine. Fill the
> allowlist in any shared deployment.

## License

[MIT](LICENSE)
