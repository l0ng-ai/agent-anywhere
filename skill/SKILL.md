---
name: agent-anywhere
description: Use this when you (an agent running inside the Agent Anywhere daemon) need to act on the IM beyond a plain-text reply—send files/images, reply to or proactively push a specific message, edit a message you sent earlier, fetch channel history for context, add an emoji reaction, delete a message, create a thread, or send the user buttons to ask a clarifying question (blocking until they pick). Your ordinary text output is automatically streamed back to the IM by the daemon, so you do not need this skill for that; use it only when you need an "action beyond text".
---

# IM Gateway Reverse Commands

Your plain-text reply **is automatically streamed back to the current IM session by the daemon**—just output normally, do not use commands to re-send text.

Only call `agent-anywhere` when you need one of the following actions (it is already on PATH; `AGENT_ANYWHERE_TURN_TOKEN` is already injected, and commands automatically apply to the current session):

## Commands

- Send a file or image: `agent-anywhere send-file <path> [--caption "description"]`
- Send a message proactively: `agent-anywhere send-message "text"` (for proactive notifications after a task completes)
- Reply to a message (platform-native reply): `agent-anywhere reply <messageId> "text"`
- Edit a message you sent earlier: `agent-anywhere edit-message <messageId> "new text"` (e.g. update a progress/status message in place)
- Add a reaction: `agent-anywhere react <messageId> <emoji>`
- Delete a message: `agent-anywhere delete <messageId>`
- Fetch history for context: `agent-anywhere fetch-messages [--limit 20] [--before <messageId>] [--fields content,timestamp]`
  - Outputs a TOON table to stdout (`count:` then a `messages[N]{...}` block); use it to fill in context when the user refers to "the one above / the earlier one" and the current context does not contain it.
  - Default columns are `messageId,userId,content` (content is truncated to 500 chars). Widen with `--fields` (available: `messageId,userId,content,timestamp,quoteId,platform,channelId,attachments`). `--fields attachments` adds a separate `attachments[]{messageId,type,url,name}` table so you can download referenced images/files by URL. Page further back with `--before <oldest messageId>`.
- Create a thread: `agent-anywhere create-thread <messageId> <thread name>`
  - Opens a thread from the given message; stdout returns `threadId: ...` (TOON). To send to the thread afterward, pass `--channel <threadId>`.
- Ask a clarifying question (**blocking**, waits for the user to pick): `agent-anywhere ask "question" -o optionA -o optionB [--timeout <ms>]`
  - The daemon sends a message with buttons and **blocks** until the user clicks a button or it times out (default 120s).
  - On a hit: stdout outputs **the selected option's text** (e.g. `optionA`); on timeout: outputs **an empty line**.
  - Continue your logic based on the choice read from stdout; empty output means the user did not pick / it timed out, and you should decide on a fallback yourself.

## Conventions

- Without `--channel`, the command defaults to the channel that triggered this turn—this is the normal case.
- Only pass `--channel <id>` explicitly for cross-channel proactive pushes.
- If it returns `AGENT_ANYWHERE_TURN_TOKEN not set`, you are not inside a daemon turn, which is abnormal—do not retry.
