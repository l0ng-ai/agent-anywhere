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
  /** Command name (no leading /) when triggered by a slash command. */
  command?: string;
}

export interface RouteResult {
  agentId: string;
  scope: SessionScope;
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
  };
}

/** Normalize a command name: strip leading /, lowercase. */
function normCommand(c: string): string {
  return c.replace(/^\//, '').toLowerCase();
}

/**
 * Whether text "looks like a slash command" (starts with `/name`, name of alnum/_/-/:).
 *
 * Rationale: whether the agent (claude-code-acp / SDK) executes input as a native slash command depends
 * on whether the first text block starts with `/`. So when agent-anywhere assembles the prompt, a message
 * matching this must stay clean `/cmd args` — no `[author]` identity prefix, no quote prefix, no
 * reverse-command hint. The colon admits MCP command names like `/mcp:server:command`.
 */
export function looksLikeCommand(text: string): boolean {
  return /^\/[a-zA-Z0-9_:-]+(\s|$)/.test(text.trimStart());
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
  // command: matches only when actually triggered by that command (message routing has empty input.command → no match).
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
      };
    }
  }
  return { agentId: cfg.routing.default, scope: cfg.session.scope };
}

/**
 * Compute the session key per scope.
 * - shared: one global session.
 * - per_user: isolated by sender.
 * - per_channel: isolated by channel (inside a thread, channelId is the thread id).
 * - per_thread: isolated by thread; for non-thread contexts channelId is the channel id, same as
 *   per_channel (true parent-channel distinction needs a platform parent id, left to adapters).
 */
export function sessionKey(
  scope: SessionScope,
  input: { platform: string; channelId: string; userId: string }
): SessionId {
  switch (scope) {
    case 'shared':
      return 'shared';
    case 'per_user':
      return `${input.platform}:u:${input.userId}`;
    case 'per_channel':
      return `${input.platform}:c:${input.channelId}`;
    case 'per_thread':
      return `${input.platform}:t:${input.channelId}`;
  }
}
