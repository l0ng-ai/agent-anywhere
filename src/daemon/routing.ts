import type { Config, SessionScope } from '../config/schema.js';
import type { InboundMessage, SessionId } from '../types.js';

/**
 * Routing and session assignment: map an inbound (or slash command) to "which agent + which session key".
 *
 * - resolveRoute: match routing.pipeline in order; first rule whose `when` fully matches uses its `use`, else routing.default.
 * - sessionKey: compute a stable session key per scope (same key = same agent session, context across turns).
 */

/** Route-match input (both InboundMessage and slash commands normalize to this minimal shape). */
export interface RouteInput {
  platform: string;
  channelId: string;
  userId: string;
  guildId?: string;
  isDirect?: boolean;
  isThread?: boolean;
  isBot?: boolean;
  /**
   * Leading `/name` of the message text, if any. Native slash commands also arrive here: the
   * daemon synthesizes them into `/name input` text (daemon.onCommand), so text parsing covers
   * both — `when.command` rules work on every platform, native slash support or not.
   */
  command?: string;
}

export interface RouteResult {
  agentId: string;
  scope: SessionScope;
  /**
   * True when the winning rule matched via `when.command`: the router consumed the `/name`
   * prefix, and the caller must strip it from the content so the target agent doesn't try to
   * interpret it as one of its own slash commands.
   */
  consumedCommand: boolean;
}

/** Normalize a RouteInput from an InboundMessage. */
export function routeInputFromMessage(msg: InboundMessage): RouteInput {
  return {
    platform: msg.platform,
    channelId: msg.channelId,
    userId: msg.userId,
    guildId: msg.guildId,
    isDirect: msg.isDirect,
    isThread: msg.isThread,
    isBot: msg.authorIsBot,
    command: parseTextCommand(msg.content)?.name,
  };
}

/** Normalize a command name: strip leading /, lowercase. */
function normCommand(c: string): string {
  return c.replace(/^\//, '').toLowerCase();
}

/** Leading `/name` + rest-of-text (name of alnum/_/-/:; colon admits MCP names like /mcp:server:cmd). */
const TEXT_COMMAND_RE = /^\/([a-zA-Z0-9_:-]+)(?:\s+([\s\S]*))?$/;

/**
 * Parse a leading `/name` off message text: `{ name, rest }`, or null when the text isn't
 * command-shaped. `rest` is the text after the command (trimmed; '' for a bare `/name`).
 */
export function parseTextCommand(text: string): { name: string; rest: string } | null {
  const m = TEXT_COMMAND_RE.exec(text.trim());
  if (!m) return null;
  const [, name = '', rest = ''] = m;
  return { name, rest: rest.trim() };
}

/**
 * Whether text "looks like a slash command" (starts with `/name`, name of alnum/_/-/:).
 *
 * Rationale: whether the agent (claude-code-acp / SDK) executes input as a native slash command depends
 * on whether the first text block starts with `/`. So when agent-anywhere assembles the prompt, a message
 * matching this must stay clean `/cmd args` — no `[author]` identity prefix, no quote prefix, no
 * reverse-command hint.
 */
export function looksLikeCommand(text: string): boolean {
  return parseTextCommand(text) !== null;
}

/** Chat kind (for when.chat matching). */
function chatKind(input: RouteInput): 'private' | 'group' | 'thread' {
  if (input.isDirect) return 'private';
  if (input.isThread) return 'thread';
  return 'group';
}

/** Whether a rule's `when` fully matches. Provided fields must all match; omitted = unrestricted. */
function matchesWhen(when: Config['routing']['pipeline'][number]['when'], input: RouteInput): boolean {
  if (when.platform !== undefined && when.platform !== input.platform) return false;
  // serverId: a rule with a serverId condition never matches when the message has no guildId (avoid false global match).
  if (when.serverId !== undefined && when.serverId !== input.guildId) return false;
  if (when.channelId !== undefined && when.channelId !== input.channelId) return false;
  if (when.userId !== undefined && when.userId !== input.userId) return false;
  if (when.chat !== undefined && when.chat !== chatKind(input)) return false;
  if (when.isBot !== undefined && when.isBot !== Boolean(input.isBot)) return false;
  // command: matches the message's leading /name (native slash commands arrive as `/name input` text too).
  if (when.command !== undefined) {
    if (!input.command) return false;
    if (normCommand(when.command) !== normCommand(input.command)) return false;
  }
  return true;
}

/** Resolve the route: return the chosen agentId / scope. */
export function resolveRoute(cfg: Config, input: RouteInput): RouteResult {
  for (const rule of cfg.routing.pipeline) {
    if (matchesWhen(rule.when, input)) {
      return {
        agentId: rule.use.agent,
        scope: rule.use.scope ?? cfg.session.scope,
        consumedCommand: rule.when.command !== undefined,
      };
    }
  }
  return { agentId: cfg.routing.default, scope: cfg.session.scope, consumedCommand: false };
}

/**
 * Compute the session key per scope, qualified by the routed agent — two agents addressed in the
 * same place (e.g. `/codex …` next to default-agent chat in one channel) keep separate sessions
 * instead of the first-created agent capturing the key forever.
 * - shared: one global session (per agent).
 * - per_user: isolated by sender.
 * - per_channel: isolated by channel (inside a thread, channelId is the thread id).
 * - per_thread: isolated by thread; for non-thread contexts channelId is the channel id, same as
 *   per_channel (true parent-channel distinction needs a platform parent id, left to adapters).
 */
export function sessionKey(
  scope: SessionScope,
  agentId: string,
  input: { platform: string; channelId: string; userId: string }
): SessionId {
  switch (scope) {
    case 'shared':
      return `${agentId}:shared`;
    case 'per_user':
      return `${agentId}:${input.platform}:u:${input.userId}`;
    case 'per_channel':
      return `${agentId}:${input.platform}:c:${input.channelId}`;
    case 'per_thread':
      return `${agentId}:${input.platform}:t:${input.channelId}`;
  }
}
