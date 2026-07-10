import { describe, it, expect } from 'vitest';
import { isLegacyConfig, migrateLegacyConfig } from './migrate.js';
import { ConfigSchema, parseConfig, platformInstances, type Config } from './schema.js';

/** Single-instance convenience for these tests (every v0 file migrates to exactly one instance). */
function soleInstance(cfg: Pick<Config, 'platforms'>) {
  const insts = platformInstances(cfg);
  expect(insts).toHaveLength(1);
  return insts[0]!;
}

/**
 * v0 → v1 migration. The contract that matters: every wizard-written v0 file migrates
 * to a config that (a) VALIDATES against the v1 schema and (b) keeps routing/allowFrom
 * matching unchanged (instance id = old platform type).
 */

const V0_BASE = {
  agents: [{ id: 'default', harness: 'claude' }],
  routing: { default: 'default', pipeline: [] },
  session: { scope: 'per_channel' },
  access: { allowFrom: ['discord:123'] },
};

describe('isLegacyConfig', () => {
  it('true for a v0 single-platform file, false for v1 / rubbish', () => {
    expect(isLegacyConfig({ platform: { type: 'discord' } })).toBe(true);
    expect(isLegacyConfig({ platforms: { d: {} } })).toBe(false);
    expect(isLegacyConfig({ platform: {}, platforms: {} })).toBe(false); // already has v1 map
    expect(isLegacyConfig(null)).toBe(false);
    expect(isLegacyConfig('x')).toBe(false);
  });
});

describe('migrateLegacyConfig', () => {
  it('discord: top-level fields move into the instance; channels → chat.channels; validates', () => {
    const { config } = migrateLegacyConfig({
      ...V0_BASE,
      platform: {
        type: 'discord',
        token: 't',
        channels: ['c1'],
        slash: false,
        intents: 512,
        autoThread: 'perTurn',
        commandGuildId: 'g1',
      },
    });
    const cfg = parseConfig(config);
    const inst = soleInstance(cfg);
    expect(inst.id).toBe('discord'); // instance id = type → allowFrom/routing keep matching
    expect(inst).toMatchObject({
      type: 'discord',
      token: 't',
      slash: false,
      intents: 512,
      autoThread: 'perTurn',
      commandGuildId: 'g1',
      chat: { channels: ['c1'] },
    });
    expect(cfg.version).toBe(1);
    expect(cfg.access.allowFrom).toEqual(['discord:123']);
  });

  it('lark: options credentials become typed fields, placeholder token is dropped, platform → endpoint', () => {
    const { config, notes } = migrateLegacyConfig({
      ...V0_BASE,
      platform: {
        type: 'lark',
        token: 'cli_app1', // setup's placeholder backfill (== appId)
        options: { appId: 'cli_app1', appSecret: 's3cret', platform: 'lark' },
      },
    });
    const cfg = parseConfig(config);
    const inst = soleInstance(cfg);
    expect(inst).toMatchObject({ type: 'lark', appId: 'cli_app1', appSecret: 's3cret', endpoint: 'lark' });
    expect('token' in inst).toBe(false);
    expect(notes.join('\n')).toContain('placeholder token');
  });

  it('qq: id/secret/type → appId/secret/botType', () => {
    const { config } = migrateLegacyConfig({
      ...V0_BASE,
      platform: { type: 'qq', token: 'appid1', options: { id: 'appid1', secret: 's', type: 'public' } },
    });
    const inst = soleInstance(parseConfig(config));
    expect(inst).toMatchObject({ type: 'qq', appId: 'appid1', secret: 's', botType: 'public' });
  });

  it('slack: token → appToken, botToken carried; validates', () => {
    const { config } = migrateLegacyConfig({
      ...V0_BASE,
      platform: { type: 'slack', token: 'xapp-1', options: { botToken: 'xoxb-1' } },
    });
    const inst = soleInstance(parseConfig(config));
    expect(inst).toMatchObject({ type: 'slack', appToken: 'xapp-1', botToken: 'xoxb-1', protocol: 'ws' });
  });

  it('wecom: options flatten; top-level token stays the callback token', () => {
    const { config } = migrateLegacyConfig({
      ...V0_BASE,
      platform: {
        type: 'wecom',
        token: 'cb-token',
        options: { corpId: 'c', agentId: 'a', secret: 's', aesKey: 'k', selfUrl: 'https://x' },
      },
    });
    const inst = soleInstance(parseConfig(config));
    expect(inst).toMatchObject({
      type: 'wecom',
      token: 'cb-token',
      corpId: 'c',
      agentId: 'a',
      secret: 's',
      aesKey: 'k',
      selfUrl: 'https://x',
    });
  });

  it('unknown options keys are dropped with a note (not silently)', () => {
    const { notes } = migrateLegacyConfig({
      ...V0_BASE,
      platform: { type: 'telegram', token: 't', options: { mystery: 1 } },
    });
    expect(notes.join('\n')).toContain('mystery');
  });
});

describe('v1 schema cross-field rules', () => {
  const base = {
    agents: [{ id: 'a', harness: 'claude' }],
    routing: { default: 'a', pipeline: [] },
  };

  it('rejects an empty platforms map', () => {
    expect(() => ConfigSchema.parse({ ...base, platforms: {} })).toThrowError(/at least one platform/);
  });

  it('rejects pipeline when.platform referencing a non-existent instance id', () => {
    expect(() =>
      ConfigSchema.parse({
        ...base,
        platforms: { d: { type: 'discord', token: 't' } },
        routing: { default: 'a', pipeline: [{ when: { platform: 'slack' }, use: { agent: 'a' } }] },
      })
    ).toThrowError(/non-existent platform instance .{0,2}slack/);
  });

  it('rejects slack protocol=http without signing', () => {
    expect(() =>
      ConfigSchema.parse({
        ...base,
        platforms: { s: { type: 'slack', appToken: 'x', botToken: 'y', protocol: 'http' } },
      })
    ).toThrowError(/signing/);
  });

  it('platformInstances exposes each entry with its map key as the instance id', () => {
    const two = parseConfig({
      ...base,
      platforms: {
        a1: { type: 'discord', token: 't' },
        a2: { type: 'telegram', token: 't2' },
      },
    });
    expect(platformInstances(two).map((i) => `${i.id}:${i.type}`)).toEqual(['a1:discord', 'a2:telegram']);
  });
});
