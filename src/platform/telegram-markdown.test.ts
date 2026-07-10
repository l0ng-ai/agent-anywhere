import { describe, it, expect } from 'vitest';
import type { h } from '@satorijs/core';
import {
  parseInline,
  renderTelegramMarkdown,
  fragmentToTelegramHtml,
} from './telegram-markdown.js';

/** Serialize a fragment to its Satori-markup string (what the adapter's encoder consumes). */
function s(nodes: h[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : n.toString())).join('');
}

describe('parseInline', () => {
  it('converts bold/italic/strikethrough/inline-code to Satori elements', () => {
    expect(s(parseInline('**b**'))).toBe('<b>b</b>');
    expect(s(parseInline('*i*'))).toBe('<i>i</i>');
    expect(s(parseInline('~~x~~'))).toBe('<s>x</s>');
    expect(s(parseInline('`c`'))).toBe('<code>c</code>');
  });

  it('renders links with the url in href and recurses into the display text', () => {
    expect(s(parseInline('[**hi**](https://x.com/a)'))).toBe(
      '<a href="https://x.com/a"><b>hi</b></a>'
    );
  });

  it('nests emphasis: bold containing italic', () => {
    expect(s(parseInline('**a _b_ c**'))).toBe('<b>a <i>b</i> c</b>');
  });

  it('leaves an unclosed delimiter as literal text (stream safety)', () => {
    expect(s(parseInline('**not closed'))).toBe('**not closed');
  });

  it('does not italicize underscores inside a word (file_name stays literal)', () => {
    expect(s(parseInline('file_name_here'))).toBe('file_name_here');
  });

  it('HTML-escapes literal angle brackets and ampersands in text', () => {
    expect(s(parseInline('Array<T> & U'))).toBe('Array&lt;T&gt; &amp; U');
  });

  it('does not parse markdown inside inline code', () => {
    expect(s(parseInline('`a **b** c`'))).toBe('<code>a **b** c</code>');
  });
});

describe('renderTelegramMarkdown blocks', () => {
  it('renders an ATX heading as bold', () => {
    expect(s(renderTelegramMarkdown('# Title'))).toBe('<b>Title</b>');
  });

  it('renders a fenced code block with language and escapes its body', () => {
    expect(s(renderTelegramMarkdown('```ts\na<b && c>d\n```'))).toBe(
      '<code-block lang="ts">a&lt;b &amp;&amp; c&gt;d</code-block>'
    );
  });

  it('treats an unclosed fence at end-of-stream as a code block (stream safety)', () => {
    expect(s(renderTelegramMarkdown('```\nhalf'))).toBe('<code-block>half</code-block>');
  });

  it('rewrites a GFM table into bold-title + bullet groups', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |';
    expect(s(renderTelegramMarkdown(md))).toBe(
      '<b>Ada</b><br/>• Score: 95'
    );
  });

  it('converts unordered list markers to bullets and keeps inline formatting', () => {
    expect(s(renderTelegramMarkdown('- **a**\n- b'))).toBe(
      '• <b>a</b><br/>• b'
    );
  });

  it('collapses consecutive blockquote lines into one blockquote', () => {
    expect(s(renderTelegramMarkdown('> one\n> two'))).toBe(
      '<quote>one<br/>two</quote>'
    );
  });

  it('preserves blank lines between paragraphs as breaks', () => {
    expect(s(renderTelegramMarkdown('a\n\nb'))).toBe('a<br/><br/>b');
  });

  it('returns an empty fragment for empty input', () => {
    expect(renderTelegramMarkdown('')).toEqual([]);
  });
});

describe('fragmentToTelegramHtml stays within Telegram-supported HTML tags', () => {
  // Telegram's HTML parse_mode accepts only this tag set. Anything else — notably the Satori-only
  // br / code-block / quote / p / button tags — is a 400 ("Unsupported start tag ..."). This is the
  // invariant the original streaming bug violated, so we assert it across representative inputs.
  const ALLOWED = new Set([
    'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'blockquote',
    'tg-spoiler', 'span', 'tg-emoji',
  ]);
  const samples = [
    'plain text, no markup',
    '# Heading\n\nparagraph with **bold**, *italic*, `code`, [link](https://x.com/a).',
    '```python\ndef f(x):\n    return a < b and c > d\n```',
    '| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n| 3 | 4 |',
    '- item one\n- item two **bold**\n- item three',
    '> quoted line one\n> quoted line two',
    'mixed <html> & ampersand, plus Array<T> generics',
    'unclosed **bold and an unfinished `code',
  ];
  it.each(samples)('emits only whitelisted tags for: %j', (md) => {
    const html = fragmentToTelegramHtml(renderTelegramMarkdown(md));
    const tags = [...html.matchAll(/<\/?([a-z0-9-]+)/gi)].map((m) => m[1]!.toLowerCase());
    for (const tag of tags) {
      expect(ALLOWED.has(tag), `tag <${tag}> is not a Telegram-supported HTML tag (input: ${md})`).toBe(true);
    }
  });
});

describe('fragmentToTelegramHtml (forum-topic path)', () => {
  it('serializes Satori nodes to raw Telegram HTML with code-block → pre/code', () => {
    const nodes = renderTelegramMarkdown('# H\n`c`\n```py\nx<y\n```');
    expect(fragmentToTelegramHtml(nodes)).toBe(
      '<b>H</b>\n<code>c</code>\n<pre><code class="language-py">x&lt;y</code></pre>'
    );
  });

  it('serializes a blockquote to <blockquote> with newline-joined lines', () => {
    expect(fragmentToTelegramHtml(renderTelegramMarkdown('> a\n> b'))).toBe(
      '<blockquote>a\nb</blockquote>'
    );
  });

  it('escapes angle brackets in plain text', () => {
    expect(fragmentToTelegramHtml(renderTelegramMarkdown('a<b'))).toBe('a&lt;b');
  });
});
