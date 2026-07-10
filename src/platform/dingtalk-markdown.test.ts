import { describe, it, expect } from 'vitest';
import { renderDingtalkMarkdown } from './dingtalk-markdown.js';

// DingTalk's markdown renderer ignores a single '\n' (lines run together), so the
// converter's core job is regrouping: every plain line becomes its own \n\n-joined
// block, while constructs markdown parses line-by-line (lists, quotes, fences)
// stay tight. These tests pin that contract plus the table degrade.

describe('renderDingtalkMarkdown block regrouping (single \\n is not a line break)', () => {
  it('separates consecutive plain lines with a blank line', () => {
    expect(renderDingtalkMarkdown('line one\nline two')).toBe('line one\n\nline two');
  });

  it('drops source blank lines (the block join already provides the gap)', () => {
    expect(renderDingtalkMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('keeps consecutive list items tight so they render as one list', () => {
    expect(renderDingtalkMarkdown('- a\n- b\n1. c\n2. d')).toBe('- a\n- b\n1. c\n2. d');
    expect(renderDingtalkMarkdown('para\n- a\n- b\ntail')).toBe('para\n\n- a\n- b\n\ntail');
  });

  it('keeps consecutive quote lines tight', () => {
    expect(renderDingtalkMarkdown('> a\n> b\n\ntext')).toBe('> a\n> b\n\ntext');
  });

  it('separates a heading from the following paragraph', () => {
    expect(renderDingtalkMarkdown('# Title\nbody')).toBe('# Title\n\nbody');
  });
});

describe('renderDingtalkMarkdown code fences (verbatim, single \\n inside)', () => {
  it('keeps a fenced block as one tight block and does not rewrite its contents', () => {
    const src = 'before\n```py\n# not a heading\n| not | a table |\n|---|---|\n```\nafter';
    const out = renderDingtalkMarkdown(src);
    expect(out).toBe('before\n\n```py\n# not a heading\n| not | a table |\n|---|---|\n```\n\nafter');
  });

  it('emits an unclosed fence at end-of-stream as-is (stream safety)', () => {
    expect(renderDingtalkMarkdown('```\ncode line')).toBe('```\ncode line');
  });
});

describe('renderDingtalkMarkdown table degrade (DingTalk renders no tables)', () => {
  it('renders rows as bold title + bullet blocks, no pipes survive', () => {
    const src = '| Name | Score |\n|------|-------|\n| Ada | 95 |\n| Bob | 82 |';
    const out = renderDingtalkMarkdown(src);
    expect(out).toBe('**Ada**\n\n• Score: 95\n\n**Bob**\n\n• Score: 82');
    expect(out).not.toContain('|');
  });

  it('leaves a pipe-bearing line alone until the separator row arrives (stream safety)', () => {
    expect(renderDingtalkMarkdown('| a | b |')).toBe('| a | b |');
  });
});

describe('renderDingtalkMarkdown inline pass-through', () => {
  it('passes supported/harmless inline constructs verbatim', () => {
    const src = '**bold** *it* `code` [t](https://x.com) ![img](https://x.com/a.png)';
    expect(renderDingtalkMarkdown(src)).toBe(src);
  });

  it('returns empty string for empty input', () => {
    expect(renderDingtalkMarkdown('')).toBe('');
  });
});
