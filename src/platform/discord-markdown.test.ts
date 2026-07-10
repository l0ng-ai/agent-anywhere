import { describe, it, expect } from 'vitest';
import { renderDiscordMarkdown } from './discord-markdown.js';

describe('renderDiscordMarkdown — table rewriting', () => {
  it('rewrites a GFM table into bold-title + Header: Value bullets', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |';
    expect(renderDiscordMarkdown(md)).toBe('**Ada**\n• Score: 95');
  });

  it('rewrites a multi-row table with a blank line between row groups', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |\n| Bob | 80 |';
    expect(renderDiscordMarkdown(md)).toBe('**Ada**\n• Score: 95\n\n**Bob**\n• Score: 80');
  });

  it('rewrites a wide table emitting one bullet per non-title column', () => {
    const md = '| Name | Age | City |\n|------|-----|------|\n| Ada | 36 | London |';
    expect(renderDiscordMarkdown(md)).toBe('**Ada**\n• Age: 36\n• City: London');
  });

  it('keeps surrounding text intact around a rewritten table', () => {
    const md = 'Results:\n\n| Name | Score |\n|------|-------|\n| Ada | 95 |\n\nDone.';
    expect(renderDiscordMarkdown(md)).toBe('Results:\n\n**Ada**\n• Score: 95\n\nDone.');
  });
});

describe('renderDiscordMarkdown — non-table content is returned UNCHANGED', () => {
  it('leaves bold/italic/inline-code untouched (Discord renders them natively)', () => {
    const md = 'This is **bold**, *italic*, and `code`.';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('leaves links and headings and lists untouched', () => {
    const md = '# Title\n\n- item one\n- [link](https://example.com)\n\n> quoted';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('leaves a lone pipe that is not part of a table untouched', () => {
    const md = 'run `a | b` or choose this | that';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('returns empty/whitespace input unchanged', () => {
    expect(renderDiscordMarkdown('')).toBe('');
    expect(renderDiscordMarkdown('   ')).toBe('   ');
  });
});

describe('renderDiscordMarkdown — code fences are never rewritten', () => {
  it('does NOT rewrite a table that lives inside a ``` fenced block', () => {
    const md = '```\n| Name | Score |\n|------|-------|\n| Ada | 95 |\n```';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('does NOT rewrite a table inside a ~~~ fenced block', () => {
    const md = '~~~md\n| Name | Score |\n|------|-------|\n| Ada | 95 |\n~~~';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('rewrites a real table but leaves an identical-looking one inside a later fence alone', () => {
    const md =
      '| Name | Score |\n|------|-------|\n| Ada | 95 |\n\n```\n| Name | Score |\n|------|-------|\n| Ada | 95 |\n```';
    expect(renderDiscordMarkdown(md)).toBe(
      '**Ada**\n• Score: 95\n\n```\n| Name | Score |\n|------|-------|\n| Ada | 95 |\n```'
    );
  });
});

describe('renderDiscordMarkdown — stream safety (partial / mid-stream)', () => {
  it('passes a header row through unchanged while its separator has not arrived yet', () => {
    const md = '| Name | Score |';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });

  it('passes a header row followed by non-separator text through unchanged', () => {
    const md = '| Name | Score |\nstill thinking...';
    expect(renderDiscordMarkdown(md)).toBe(md);
  });
});
