/**
 * Inbound response gating (pure functions).
 *
 * Platform-agnostic "should we respond to this message?" decision tree. No side
 * effects: no clock, no env, no IO — a deterministic decision from its inputs
 * (message / config / context), for unit tests and log tracing.
 */

import type { InboundMessage } from '../types.js';

/** Gating config (mirrors config.inbound.gating). */
export interface GateConfig {
  /** Whether guild channels require an @mention to respond. */
  requireMentionInGuild: boolean;
  /** Whether to always respond in DMs. */
  respondInDirect: boolean;
  /** Responding to other bots: none / mentions (only when @-ed) / all. */
  allowBots: 'none' | 'mentions' | 'all';
  /** Allowlist: these channels trigger without a mention. */
  freeResponseChannels: string[];
  /** Blocklist: these channels are fully ignored. */
  ignoredChannels: string[];
  /** Whether already-participated threads are exempt from the mention requirement. */
  threadParticipationExempt: boolean;
}

/** Runtime context for gating (injected by the caller; this module queries nothing). */
export interface GateContext {
  /** Whether this routing key has an active session — proxy for "bot already in this thread". */
  hasActiveSession: boolean;
}

/** Gating outcome: whether to respond + a stable reason string (for logs/test asserts). */
export interface GateDecision {
  respond: boolean;
  reason: string;
}

/**
 * Decide whether to respond to an inbound message.
 *
 * Strict order, short-circuiting on the first hit; each branch yields a stable `reason`:
 *  1. blocklisted channel    → false 'ignored-channel'
 *  2. bot author filter      → 'bot-blocked' / 'bot-no-mention' (else continue)
 *  3. DM                     → 'dm' / 'dm-disabled'
 *  4. free-response allowlist → true 'free-response'
 *  5. participated thread     → true 'thread-participated'
 *  6. guild requires mention  → false 'no-mention' (when not mentioned)
 *  7. default allow           → true 'default'
 *
 * `authorIsBot/isDirect/isThread/mentionedSelf` are optional and tested with
 * `=== true`; undefined is treated as false (i.e. a missing mention counts as
 * "not mentioned", per step 6).
 */
export function shouldRespond(
  msg: InboundMessage,
  cfg: GateConfig,
  ctx: GateContext
): GateDecision {
  // 1) Blocklisted channel: highest priority, ignore outright.
  if (cfg.ignoredChannels.includes(msg.channelId)) {
    return { respond: false, reason: 'ignored-channel' };
  }

  // 2) Bot author: filter by allowBots; continue to later checks if it passes.
  if (msg.authorIsBot === true) {
    if (cfg.allowBots === 'none') {
      return { respond: false, reason: 'bot-blocked' };
    }
    if (cfg.allowBots === 'mentions' && msg.mentionedSelf !== true) {
      // Respond to a bot only when it @-ed us; not mentioned here, reject.
      return { respond: false, reason: 'bot-no-mention' };
    }
    // allowBots==='all', or ==='mentions' and mentioned → continue to later gating.
  }

  // 3) DM: separate switch, usually no mention required.
  if (msg.isDirect === true) {
    return cfg.respondInDirect
      ? { respond: true, reason: 'dm' }
      : { respond: false, reason: 'dm-disabled' };
  }

  // 4) Free-response channel: allowlisted, respond without a mention.
  if (cfg.freeResponseChannels.includes(msg.channelId)) {
    return { respond: true, reason: 'free-response' };
  }

  // 5) Participated-thread exemption: in a thread with an active session, treat as
  // "already participated" and skip the mention requirement.
  if (
    msg.isThread === true &&
    cfg.threadParticipationExempt &&
    ctx.hasActiveSession
  ) {
    return { respond: true, reason: 'thread-participated' };
  }

  // 6) Guild requires mention: enabled and this message didn't @ us → no response.
  if (cfg.requireMentionInGuild && msg.mentionedSelf !== true) {
    return { respond: false, reason: 'no-mention' };
  }

  // 7) Default: nothing blocked → allow.
  return { respond: true, reason: 'default' };
}
