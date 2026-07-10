import { describe, it, expect } from 'vitest';
import { renderLarkMarkdown } from './lark-markdown.js';

describe('renderLarkMarkdown pass-through (Feishu-supported subset is left untouched)', () => {
  it('passes bold/italic/strikethrough/links through verbatim', () => {
    // These are in the Feishu markdown subset, so re-converting would only risk
    // breaking them — the converter must NOT touch them.
    expect(renderLarkMarkdown('**b** *i* ~~s~~ [t](https://x.com/a)')).toBe(
      '**b** *i* ~~s~~ [t](https://x.com/a)'
    );
  });

  it('passes unordered and ordered lists through verbatim', () => {
    expect(renderLarkMarkdown('- a\n- b\n1. c\n2. d')).toBe('- a\n- b\n1. c\n2. d');
  });

  it('passes fenced code blocks through verbatim (fences kept)', () => {
    const md = '```ts\nconst x = 1;\n```';
    expect(renderLarkMarkdown(md)).toBe(md);
  });

  it('does NOT rewrite heading/table-looking lines inside a fenced code block', () => {
    // Block rewrites must be suppressed inside code, or comments/pipes get mangled.
    const md = '```\n# not a heading\n| a | b |\n|---|---|\n```';
    expect(renderLarkMarkdown(md)).toBe(md);
  });

  it('treats an unclosed fence at end-of-stream as code (stream safety)', () => {
    expect(renderLarkMarkdown('```\nhalf')).toBe('```\nhalf');
  });

  it('preserves blank lines / paragraph spacing', () => {
    expect(renderLarkMarkdown('a\n\nb')).toBe('a\n\nb');
  });

  it('returns empty string for empty input', () => {
    expect(renderLarkMarkdown('')).toBe('');
  });
});

describe('renderLarkMarkdown degrades constructs Feishu does NOT render', () => {
  it('rewrites a GFM table into bold-title + bullet lines', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |';
    expect(renderLarkMarkdown(md)).toBe('**Ada**\n• Score: 95');
  });

  it('rewrites a multi-row, multi-column table', () => {
    const md =
      '| Name | Score | Rank |\n|---|---|---|\n| Ada | 95 | 1 |\n| Bob | 80 | 2 |';
    expect(renderLarkMarkdown(md)).toBe(
      '**Ada**\n• Score: 95\n• Rank: 1\n**Bob**\n• Score: 80\n• Rank: 2'
    );
  });

  it('keeps inline markdown inside table cells verbatim (subset-supported)', () => {
    const md = '| Name | Note |\n|---|---|\n| **Ada** | see [doc](https://x.com) |';
    expect(renderLarkMarkdown(md)).toBe('**Ada**\n• Note: see [doc](https://x.com)');
  });

  it('skips empty cells when degrading a table', () => {
    const md = '| Name | A | B |\n|---|---|---|\n| Ada |  | 2 |';
    expect(renderLarkMarkdown(md)).toBe('**Ada**\n• B: 2');
  });

  it('converts ATX headings to bold (Feishu has no headings)', () => {
    expect(renderLarkMarkdown('# Title')).toBe('**Title**');
    expect(renderLarkMarkdown('### Sub')).toBe('**Sub**');
  });

  it('does not treat #hashtag (no space) as a heading', () => {
    expect(renderLarkMarkdown('#hashtag stays')).toBe('#hashtag stays');
  });

  it('strips blockquote markers, keeping the content as plain text', () => {
    expect(renderLarkMarkdown('> one\n> two')).toBe('one\ntwo');
  });
});

describe('renderLarkMarkdown stream safety', () => {
  it('leaves an unclosed bold delimiter as literal text', () => {
    // Inline is passed through, so a half-streamed `**bold` is simply literal —
    // no parser state to leave dangling on a partial edit.
    expect(renderLarkMarkdown('**not closed')).toBe('**not closed');
  });

  it('treats a half-streamed table (header only, no separator yet) as plain lines', () => {
    expect(renderLarkMarkdown('| Name | Score |')).toBe('| Name | Score |');
  });
});
