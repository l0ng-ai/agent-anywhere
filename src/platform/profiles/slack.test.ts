import { describe, it, expect } from 'vitest';
import { decodeChannel, buildButtonBlocks, createSlackProfile } from './slack.js';

// ── Fake bot for delivery-contract tests ──────────────────────────────────────
// These tests capture what the profile ACTUALLY sends to Slack's Web API, not just what the
// converter returns. This matters because @satorijs/adapter-slack's MessageEncoder.escape()
// zero-width-spaces every `*`/`_`/`~` and rewrites `<...>` → `&lt;...&gt;` — so if the profile ever
// routed pre-rendered mrkdwn back through bot.sendMessage/bot.editMessage, our `*bold*` and
// `<url|text>` links would be mangled and a pure-converter unit test would never catch it (the
// Telegram <br/> lesson). The fake therefore guards bot.sendMessage/editMessage with a throw and
// only allows internal.chatPostMessage / internal.chatUpdate, asserting send AND edit deliver
// identical valid mrkdwn via the Bot OAuth token.

type Profile = ReturnType<typeof createSlackProfile>;
type SendBot = Parameters<NonNullable<Profile['sendMessage']>>[0];

interface Captured {
  post: Array<{ token: string; params: Record<string, unknown> }>;
  update: Array<{ token: string; params: Record<string, unknown> }>;
}

function fakeBot(): { bot: SendBot; calls: Captured } {
  const calls: Captured = { post: [], update: [] };
  const internal = {
    chatPostMessage: (token: string, params: Record<string, unknown>) => {
      calls.post.push({ token, params });
      return Promise.resolve({ channel: String(params.channel), ts: '111.222', ok: true });
    },
    chatUpdate: (token: string, params: Record<string, unknown>) => {
      calls.update.push({ token, params });
      return Promise.resolve({ ok: true });
    },
  };
  const guard = (): never => {
    throw new Error('profile must route send/edit through internal.chat*, not bot.*');
  };
  const bot = {
    internal,
    config: { botToken: 'xoxb-test' },
    sendMessage: guard,
    editMessage: guard,
  } as unknown as SendBot;
  return { bot, calls };
}

describe('decodeChannel', () => {
  it('splits a composite channelId into channel and thread_ts on the first :', () => {
    expect(decodeChannel('C0123ABCD:1234567890.123456')).toEqual({
      channel: 'C0123ABCD',
      threadTs: '1234567890.123456',
    });
  });

  it('treats a non-composite channelId as the channel verbatim, with threadTs undefined', () => {
    expect(decodeChannel('C0123ABCD')).toEqual({ channel: 'C0123ABCD' });
    expect(decodeChannel('C0123ABCD').threadTs).toBeUndefined();
  });

  it('splits only on the first : (the thread_ts segment has no :, but this is defensive)', () => {
    expect(decodeChannel('C1:1.2:3')).toEqual({ channel: 'C1', threadTs: '1.2:3' });
  });
});

describe('buildButtonBlocks', () => {
  it('produces both a section and an actions block when text is present', () => {
    const blocks = buildButtonBlocks('Pick one', [
      { id: 'ask:abc:0', label: 'Yes' },
      { id: 'ask:abc:1', label: 'No' },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn', text: 'Pick one' } });
    expect(blocks[1]).toMatchObject({ type: 'actions' });
  });

  it('produces only an actions block when text is empty', () => {
    const blocks = buildButtonBlocks('', [{ id: 'x', label: 'X' }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'actions' });
  });

  it('encodes id into both button.action_id and value (round-trip consistency)', () => {
    const blocks = buildButtonBlocks('', [{ id: 'ask:r:2', label: 'L' }]);
    const actions = blocks[0] as { elements: Array<Record<string, unknown>> };
    expect(actions.elements[0]).toMatchObject({
      type: 'button',
      action_id: 'ask:r:2',
      value: 'ask:r:2',
      text: { type: 'plain_text', text: 'L' },
    });
  });

  it('passes through only primary/danger as style, leaving others unset (avoids a Slack 400)', () => {
    const blocks = buildButtonBlocks('', [
      { id: 'a', label: 'A', style: 'primary' },
      { id: 'b', label: 'B', style: 'danger' },
      { id: 'c', label: 'C', style: 'secondary' },
      { id: 'd', label: 'D' },
    ]);
    const els = (blocks[0] as { elements: Array<Record<string, unknown>> }).elements;
    expect(els[0]!.style).toBe('primary');
    expect(els[1]!.style).toBe('danger');
    expect(els[2]!.style).toBeUndefined();
    expect(els[3]!.style).toBeUndefined();
  });
});

describe('slack profile delivery contract (send/edit reach Slack as valid mrkdwn)', () => {
  const profile = createSlackProfile();

  it('sendMessage posts rendered mrkdwn via internal.chatPostMessage with the bot token', async () => {
    const { bot, calls } = fakeBot();
    const ref = await profile.sendMessage!(bot, 'C0123ABCD', '**hi** [x](https://x.com/a)');
    expect(calls.post).toHaveLength(1);
    expect(calls.post[0]!.token).toBe('xoxb-test');
    expect(calls.post[0]!.params).toMatchObject({
      channel: 'C0123ABCD',
      text: '*hi* <https://x.com/a|x>',
    });
    expect(calls.post[0]!.params.thread_ts).toBeUndefined();
    expect(ref).toEqual({ channelId: 'C0123ABCD', messageId: '111.222' });
  });

  it('composite channelId routes thread_ts and returns the real channel', async () => {
    const { bot, calls } = fakeBot();
    const ref = await profile.sendMessage!(bot, 'C0123ABCD:1700000000.0001', 'plain');
    expect(calls.post[0]!.params).toMatchObject({
      channel: 'C0123ABCD',
      thread_ts: '1700000000.0001',
      text: 'plain',
    });
    expect(ref).toEqual({ channelId: 'C0123ABCD', messageId: '111.222' });
  });

  it('editMessage posts rendered mrkdwn via internal.chatUpdate (never bot.editMessage)', async () => {
    const { bot, calls } = fakeBot();
    await profile.editMessage!(bot, { channelId: 'C0123ABCD', messageId: '7.7' }, '# Title\n- a');
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]!.token).toBe('xoxb-test');
    expect(calls.update[0]!.params).toMatchObject({
      channel: 'C0123ABCD',
      ts: '7.7',
      text: '*Title*\n• a',
    });
  });

  it('send and edit render byte-identical mrkdwn for the same input (no streaming flicker)', async () => {
    const md = '**bold**\n- a\n- b\n```js\nconst x = 1;\n```\n> quote\n[l](https://x.com/a)';
    const a = fakeBot();
    const b = fakeBot();
    await profile.sendMessage!(a.bot, 'C1', md);
    await profile.editMessage!(b.bot, { channelId: 'C1', messageId: '1.1' }, md);
    expect(a.calls.post[0]!.params.text).toBe(b.calls.update[0]!.params.text);
  });

  it('reply posts into the thread (thread_ts = ref.messageId) with rendered mrkdwn', async () => {
    const { bot, calls } = fakeBot();
    const ref = await profile.reply!(bot, { channelId: 'C0123ABCD', messageId: '5.5' }, '*emph*');
    expect(calls.post[0]!.params).toMatchObject({
      channel: 'C0123ABCD',
      thread_ts: '5.5',
      text: '_emph_',
    });
    expect(ref).toEqual({ channelId: 'C0123ABCD', messageId: '111.222' });
  });

  it('sendButtons renders the section text to mrkdwn (mrkdwn section block must convert)', async () => {
    const { bot, calls } = fakeBot();
    await profile.sendButtons!(bot, 'C0123ABCD', 'Pick **one**', [{ id: 'ask:r:0', label: 'Yes' }]);
    const params = calls.post[0]!.params;
    expect(params.text).toBe('Pick *one*');
    const blocks = params.blocks as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn', text: 'Pick *one*' } });
  });

  it('never delivers a literal CommonMark bold marker (the asterisk bug this fixes)', async () => {
    const { bot, calls } = fakeBot();
    await profile.sendMessage!(bot, 'C1', 'this is **important**');
    const text = String(calls.post[0]!.params.text);
    expect(text).not.toContain('**'); // would have shown literal asterisks pre-fix
    expect(text).toBe('this is *important*');
  });
});
