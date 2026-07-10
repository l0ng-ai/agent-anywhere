import { describe, expect, it } from 'vitest';
import { parseConfig, type Config } from '../config/schema.js';
import { looksLikeCommand, resolveRoute, sessionKey, type RouteInput } from './routing.js';

/** Build a minimal valid config with a customizable routing.pipeline. */
function makeConfig(pipeline: unknown[], scope = 'per_channel'): Config {
  return parseConfig({
    // Two instances: pipeline rules reference "slack" and superRefine now validates
    // when.platform against the platforms map keys.
    platforms: {
      discord: { type: 'discord', token: 't' },
      slack: { type: 'slack', appToken: 'xapp-t', botToken: 'xoxb-t' },
    },
    agents: [
      { id: 'claude', harness: 'claude' },
      { id: 'codex', harness: 'codex' },
    ],
    routing: { default: 'claude', pipeline },
    session: { scope },
  });
}

const base: RouteInput = { platform: 'discord', channelId: 'c1', userId: 'u1' };

describe('resolveRoute', () => {
  it('falls back to routing.default + global scope when no pipeline', () => {
    const cfg = makeConfig([], 'per_user');
    const r = resolveRoute(cfg, base);
    expect(r).toEqual({ agentId: 'claude', scope: 'per_user' });
  });

  it('the first fully-matching rule wins (platform + serverId)', () => {
    const cfg = makeConfig([
      { when: { platform: 'slack', serverId: 'T_BIZ' }, use: { agent: 'codex' } },
    ]);
    expect(resolveRoute(cfg, { ...base, platform: 'slack', guildId: 'T_BIZ' }).agentId).toBe('codex');
    // platform mismatch → no match, fall back to default
    expect(resolveRoute(cfg, { ...base, platform: 'discord', guildId: 'T_BIZ' }).agentId).toBe('claude');
  });

  it('a serverId condition does not match when the message has no guildId (no false global match)', () => {
    const cfg = makeConfig([{ when: { serverId: 'T_BIZ' }, use: { agent: 'codex' } }]);
    expect(resolveRoute(cfg, base).agentId).toBe('claude');
  });

  it('use.scope overrides the global scope', () => {
    const cfg = makeConfig([
      { when: { chat: 'private' }, use: { agent: 'codex', scope: 'per_user' } },
    ]);
    const r = resolveRoute(cfg, { ...base, isDirect: true });
    expect(r).toEqual({ agentId: 'codex', scope: 'per_user' });
  });

  it('chat kind matches private/thread/group', () => {
    const cfg = makeConfig([
      { when: { chat: 'thread' }, use: { agent: 'codex' } },
    ]);
    expect(resolveRoute(cfg, { ...base, isThread: true }).agentId).toBe('codex');
    expect(resolveRoute(cfg, { ...base, isDirect: true }).agentId).toBe('claude'); // private ≠ thread
    expect(resolveRoute(cfg, base).agentId).toBe('claude'); // group ≠ thread
  });

  it('a command condition matches only when triggered by that command (message routing does not match)', () => {
    const cfg = makeConfig([
      { when: { command: '/review' }, use: { agent: 'codex' } },
    ]);
    expect(resolveRoute(cfg, { ...base, command: 'review' }).agentId).toBe('codex'); // leading / stripped before match
    expect(resolveRoute(cfg, base).agentId).toBe('claude'); // no command → no match
  });

  it('an isBot condition distinguishes bots', () => {
    const cfg = makeConfig([{ when: { isBot: true }, use: { agent: 'codex' } }]);
    expect(resolveRoute(cfg, { ...base, isBot: true }).agentId).toBe('codex');
    expect(resolveRoute(cfg, base).agentId).toBe('claude');
  });
});

describe('sessionKey', () => {
  const m = { platform: 'discord', channelId: 'c1', userId: 'u1' };
  it('generates stable, mutually distinct keys per scope', () => {
    expect(sessionKey('shared', m)).toBe('shared');
    expect(sessionKey('per_user', m)).toBe('discord:u:u1');
    expect(sessionKey('per_channel', m)).toBe('discord:c:c1');
    expect(sessionKey('per_thread', m)).toBe('discord:t:c1');
  });
});

describe('looksLikeCommand', () => {
  it('matches text starting with /name (with args, mcp colon, leading whitespace)', () => {
    expect(looksLikeCommand('/new')).toBe(true);
    expect(looksLikeCommand('/review the PR')).toBe(true);
    expect(looksLikeCommand('/mcp:server:cmd args')).toBe(true);
    expect(looksLikeCommand('  /clear')).toBe(true);
  });

  it('does not match: non-slash start / slash only / path-like still treated cautiously', () => {
    expect(looksLikeCommand('hello /new')).toBe(false);
    expect(looksLikeCommand('/')).toBe(false);
    expect(looksLikeCommand('/ space')).toBe(false);
    expect(looksLikeCommand('please take a look for me')).toBe(false);
  });
});
