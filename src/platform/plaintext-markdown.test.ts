import { describe, it, expect } from 'vitest';
import { flattenInline, flattenMarkdown } from './plaintext-markdown.js';

describe('flattenInline', () => {
  it('strips bold/italic/strikethrough markers and keeps the word', () => {
    expect(flattenInline('**b**')).toBe('b');
    expect(flattenInline('__b__')).toBe('b');
    expect(flattenInline('*i*')).toBe('i');
    expect(flattenInline('_i_')).toBe('i');
    expect(flattenInline('~~x~~')).toBe('x');
  });

  it('strips inline-code backticks but keeps the content', () => {
    expect(flattenInline('`code`')).toBe('code');
    expect(flattenInline('run `npm test` now')).toBe('run npm test now');
  });

  it('rewrites a link to `text (url)` so the target is not lost', () => {
    expect(flattenInline('[docs](https://x.com/a)')).toBe('docs (https://x.com/a)');
  });

  it('recurses into link display text and emphasis', () => {
    expect(flattenInline('[**hi**](https://x.com/a)')).toBe('hi (https://x.com/a)');
    expect(flattenInline('**a _b_ c**')).toBe('a b c');
  });

  it('leaves an unclosed delimiter as literal text (stream safety)', () => {
    expect(flattenInline('**not closed')).toBe('**not closed');
  });

  it('does not flatten underscores inside a word (file_name stays literal)', () => {
    expect(flattenInline('file_name_here')).toBe('file_name_here');
  });

  it('does not parse markdown inside inline code', () => {
    expect(flattenInline('`a **b** c`')).toBe('a **b** c');
  });

  it('leaves plain text untouched', () => {
    expect(flattenInline('just plain words')).toBe('just plain words');
  });
});

describe('flattenMarkdown blocks', () => {
  it('strips ATX heading markers', () => {
    expect(flattenMarkdown('# Title')).toBe('Title');
    expect(flattenMarkdown('### Deeper **bold** head')).toBe('Deeper bold head');
  });

  it('keeps a fenced code block body verbatim, dropping the fences and language', () => {
    expect(flattenMarkdown('```ts\nconst x = 1;\nfoo();\n```')).toBe('const x = 1;\nfoo();');
  });

  it('does not flatten markdown-looking characters inside a code block', () => {
    expect(flattenMarkdown('```\n**not bold** | a | b\n```')).toBe('**not bold** | a | b');
  });

  it('treats an unclosed fence at end-of-stream as a code block (stream safety)', () => {
    expect(flattenMarkdown('```\nhalf')).toBe('half');
  });

  it('rewrites a GFM table into title + bullet groups with no pipes', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |';
    expect(flattenMarkdown(md)).toBe('Ada\n• Score: 95');
  });

  it('rewrites a multi-row table into back-to-back groups', () => {
    const md = '| Name | Score |\n|------|-------|\n| Ada | 95 |\n| Bob | 88 |';
    expect(flattenMarkdown(md)).toBe('Ada\n• Score: 95\nBob\n• Score: 88');
  });

  it('converts unordered list markers to bullets, keeping inline text clean', () => {
    expect(flattenMarkdown('- **a**\n* b\n+ c')).toBe('• a\n• b\n• c');
  });

  it('keeps ordered list numbers', () => {
    expect(flattenMarkdown('1. first\n2. **second**')).toBe('1. first\n2. second');
  });

  it('strips blockquote markers, keeping the quoted text plain', () => {
    expect(flattenMarkdown('> one\n> two')).toBe('one\ntwo');
  });

  it('preserves blank lines between paragraphs', () => {
    expect(flattenMarkdown('a\n\nb')).toBe('a\n\nb');
  });

  it('trims trailing blank lines (no dangling newline)', () => {
    expect(flattenMarkdown('text\n\n')).toBe('text');
  });

  it('returns empty string for empty input', () => {
    expect(flattenMarkdown('')).toBe('');
  });

  it('leaves no stray markdown chars across a mixed document', () => {
    const md = [
      '# Report',
      '',
      'Status is **green** and uses `cache`.',
      '',
      '- item *one*',
      '- [link](https://x.com/a)',
      '',
      '| Col A | Col B |',
      '|-------|-------|',
      '| 1 | 2 |',
      '',
      '```js',
      'const k = 1;',
      '```',
      '',
      '> quoted note',
    ].join('\n');
    const out = flattenMarkdown(md);
    // No emphasis markers, heading hashes, or raw table pipes survive.
    expect(out).not.toMatch(/\*\*/);
    expect(out).not.toMatch(/^#/m);
    expect(out).not.toContain('|');
    // The link target is preserved as `text (url)`.
    expect(out).toContain('link (https://x.com/a)');
    // The code body survives, the fences do not.
    expect(out).toContain('const k = 1;');
    expect(out).not.toContain('```');
  });
});
