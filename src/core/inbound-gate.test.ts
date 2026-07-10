import { describe, it, expect } from 'vitest';
import type { InboundMessage } from '../types.js';
import {
  shouldRespond,
  type GateConfig,
  type GateContext,
} from './inbound-gate.js';

/** Minimal InboundMessage; overrides set gating-relevant fields. */
function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'discord',
    channelId: 'C1',
    userId: 'U1',
    messageId: 'M1',
    content: 'hello',
    timestamp: 0,
    ...overrides,
  };
}

/** Default gating config (mirrors schema defaults). */
function makeCfg(overrides: Partial<GateConfig> = {}): GateConfig {
  return {
    requireMentionInGuild: true,
    respondInDirect: true,
    allowBots: 'none',
    freeResponseChannels: [],
    ignoredChannels: [],
    threadParticipationExempt: true,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return { hasActiveSession: false, ...overrides };
}

describe('shouldRespond · blocklisted channel', () => {
  it('matches ignoredChannels → false ignored-channel (highest priority)', () => {
    const d = shouldRespond(
      makeMsg({ channelId: 'C1', mentionedSelf: true, isDirect: true }),
      makeCfg({ ignoredChannels: ['C1'] }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'ignored-channel' });
  });
});

describe('shouldRespond · bot author', () => {
  it("allowBots='none' → false bot-blocked", () => {
    const d = shouldRespond(
      makeMsg({ authorIsBot: true, mentionedSelf: true }),
      makeCfg({ allowBots: 'none' }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'bot-blocked' });
  });

  it("allowBots='mentions' and not mentioned → false bot-no-mention", () => {
    const d = shouldRespond(
      makeMsg({ authorIsBot: true, mentionedSelf: false }),
      makeCfg({ allowBots: 'mentions' }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'bot-no-mention' });
  });

  it("allowBots='mentions' and mentioned → continues to later checks (guild require-mention met → default)", () => {
    const d = shouldRespond(
      makeMsg({ authorIsBot: true, mentionedSelf: true }),
      makeCfg({ allowBots: 'mentions' }),
      makeCtx()
    );
    expect(d).toEqual({ respond: true, reason: 'default' });
  });

  it("allowBots='all' continues to later checks even when not mentioned (guild not mentioned → no-mention)", () => {
    const d = shouldRespond(
      makeMsg({ authorIsBot: true, mentionedSelf: false }),
      makeCfg({ allowBots: 'all' }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'no-mention' });
  });
});

describe('shouldRespond · direct message (DM)', () => {
  it('respondInDirect=true → true dm', () => {
    const d = shouldRespond(
      makeMsg({ isDirect: true }),
      makeCfg({ respondInDirect: true }),
      makeCtx()
    );
    expect(d).toEqual({ respond: true, reason: 'dm' });
  });

  it('respondInDirect=false → false dm-disabled', () => {
    const d = shouldRespond(
      makeMsg({ isDirect: true }),
      makeCfg({ respondInDirect: false }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'dm-disabled' });
  });
});

describe('shouldRespond · free-response channel', () => {
  it('matches freeResponseChannels and not mentioned → true free-response', () => {
    const d = shouldRespond(
      makeMsg({ channelId: 'C2', mentionedSelf: false }),
      makeCfg({ freeResponseChannels: ['C2'] }),
      makeCtx()
    );
    expect(d).toEqual({ respond: true, reason: 'free-response' });
  });
});

describe('shouldRespond · thread-participation exemption', () => {
  it('thread + exemption on + active session + not mentioned → true thread-participated', () => {
    const d = shouldRespond(
      makeMsg({ isThread: true, mentionedSelf: false }),
      makeCfg({ threadParticipationExempt: true }),
      makeCtx({ hasActiveSession: true })
    );
    expect(d).toEqual({ respond: true, reason: 'thread-participated' });
  });

  it('thread but no active session (not participated) and not mentioned → false no-mention', () => {
    const d = shouldRespond(
      makeMsg({ isThread: true, mentionedSelf: false }),
      makeCfg({ threadParticipationExempt: true }),
      makeCtx({ hasActiveSession: false })
    );
    expect(d).toEqual({ respond: false, reason: 'no-mention' });
  });

  it('exemption off: even if participated it is not exempt, not mentioned → false no-mention', () => {
    const d = shouldRespond(
      makeMsg({ isThread: true, mentionedSelf: false }),
      makeCfg({ threadParticipationExempt: false }),
      makeCtx({ hasActiveSession: true })
    );
    expect(d).toEqual({ respond: false, reason: 'no-mention' });
  });
});

describe('shouldRespond · guild channel require-mention', () => {
  it('mention required and mentioned → true default', () => {
    const d = shouldRespond(
      makeMsg({ mentionedSelf: true }),
      makeCfg({ requireMentionInGuild: true }),
      makeCtx()
    );
    expect(d).toEqual({ respond: true, reason: 'default' });
  });

  it('mention required and not mentioned (undefined treated as not mentioned) → false no-mention', () => {
    const d = shouldRespond(
      makeMsg({}),
      makeCfg({ requireMentionInGuild: true }),
      makeCtx()
    );
    expect(d).toEqual({ respond: false, reason: 'no-mention' });
  });
});

describe('shouldRespond · default allow', () => {
  it('guild channel that does not require a mention → true default', () => {
    const d = shouldRespond(
      makeMsg({ mentionedSelf: false }),
      makeCfg({ requireMentionInGuild: false }),
      makeCtx()
    );
    expect(d).toEqual({ respond: true, reason: 'default' });
  });
});
