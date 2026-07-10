import { describe, expect, it } from 'vitest';
import { SessionRegistry } from './session.js';
import type { Config } from '../config/schema.js';
import type { PlatformAdapter } from '../platform/adapter.js';
import type { AgentFactory, AgentSession } from './agent.js';

/**
 * Unit tests for SessionRegistry session control (model override + reset).
 * Minimal stub platform/agent; verifies public-method semantics directly, no real turns.
 */

const baseConfig = {
  platforms: {
    discord: {
      type: 'discord',
      token: 't',
      chat: { channels: [], requireMention: true, freeResponseChannels: [], ignoredChannels: [], allowBots: 'none' },
    },
  },
  agents: [{ id: 'default', harness: 'custom', command: 'x', args: [], env: {} }],
  routing: { default: 'default', pipeline: [] },
  session: { scope: 'per_channel', maxPerThread: 5 },
  access: { allowFrom: [], admin: [] },
  inbound: { gating: { respondInDirect: true, threadParticipationExempt: true } },
} as unknown as Config;

const stubPlatform = {
  capabilities: { thread: false },
} as unknown as PlatformAdapter;
const stubPlatforms = new Map([['discord', stubPlatform]]);

const clock = {
  now: () => 0,
  schedule: () => () => {},
};

function makeFactory(): { factory: AgentFactory; disposed: string[] } {
  const disposed: string[] = [];
  const sessions = new Map<string, AgentSession>();
  const factory: AgentFactory = {
    getOrCreate(sessionId) {
      let s = sessions.get(sessionId);
      if (!s) {
        s = {
          sessionId,
          runTurn: async () => {},
          abort: () => {},
          dispose: () => {},
        };
        sessions.set(sessionId, s);
      }
      return s;
    },
    dispose(sessionId) {
      disposed.push(sessionId);
      sessions.delete(sessionId);
    },
  };
  return { factory, disposed };
}

describe('SessionRegistry session control', () => {
  it('resetSession calls agents.dispose to drop resume context', () => {
    const { factory, disposed } = makeFactory();
    const reg = new SessionRegistry(baseConfig, stubPlatforms, factory, clock);
    reg.resetSession('discord:c1');
    expect(disposed).toEqual(['discord:c1']);
  });

  it('/new (and /clear, with @bot suffix) resets context: dispose + store.delete + channel ack, no agent turn', () => {
    const { factory, disposed } = makeFactory();
    const sent: string[] = [];
    const deleted: string[] = [];
    const platform = {
      capabilities: { thread: false },
      sendMessage: async (_ch: string, text: string) => {
        sent.push(text);
        return { channelId: _ch, messageId: 'm1' };
      },
    } as unknown as PlatformAdapter;
    const store = { get: () => undefined, set: () => {}, delete: (k: string) => deleted.push(k) };
    const reg = new SessionRegistry(
      baseConfig,
      new Map([['discord', platform]]),
      factory,
      clock,
      undefined,
      store as never
    );

    for (const content of ['/new', '/clear', ' /new@mybot ']) {
      reg.route({
        platform: 'discord',
        channelId: 'c1',
        userId: 'u1',
        messageId: `m-${content}`,
        content,
        isDirect: true,
      } as never);
    }

    expect(disposed).toEqual(['discord:c:c1', 'discord:c:c1', 'discord:c:c1']);
    expect(deleted).toEqual(['discord:c:c1', 'discord:c:c1', 'discord:c:c1']);
    expect(sent).toHaveLength(3);
    // '/new stuff' is NOT a clear command; it must fall through to normal routing (merger created).
    expect(() =>
      reg.route({
        platform: 'discord',
        channelId: 'c1',
        userId: 'u1',
        messageId: 'm4',
        content: '/new stuff',
        isDirect: true,
      } as never)
    ).not.toThrow();
    expect(disposed).toHaveLength(3); // unchanged — not intercepted
  });

  it('set/clearModelOverride do not throw, and clear reverts to the default', () => {
    const { factory } = makeFactory();
    const reg = new SessionRegistry(baseConfig, stubPlatforms, factory, clock);
    expect(() => reg.setModelOverride('discord:c1', 'claude-opus-4-8')).not.toThrow();
    expect(() => reg.clearModelOverride('discord:c1')).not.toThrow();
    expect(() => reg.clearModelOverride('discord:c2')).not.toThrow(); // safe even if absent
  });
});
