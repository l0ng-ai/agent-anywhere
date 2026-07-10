// CommonMark → Feishu/Lark markdown-subset STRING.
//
// Why this exists: agents emit standard CommonMark (`**bold**`, `# heading`,
// `| tables |`, ``` ```fences``` ```). Feishu does NOT render full CommonMark —
// both delivery surfaces this profile uses render only a documented SUBSET:
//   1) Plain agent text is handed to the satori adapter, which (see
//      @satorijs/adapter-lark LarkMessageEncoder.flushText) wraps it as a post
//      `{ tag: 'md', text }` segment.
//   2) Button cards put text in an interactive-card `{ tag: 'markdown', content }`
//      element (see buildLarkButtonCard in profiles/lark.ts).
// Both consume the same Lark markdown dialect.
//
// Evidence for the supported subset (open.feishu.cn message-card "Using markdown
// tags" doc, verified 2026-06):
//   SUPPORTED  — `**bold**`/`__bold__`, `*italic*`, `~~strike~~`, `[t](url)`,
//                fenced ``` code blocks ```, `- ` unordered and `1. ` ordered
//                lists, `---` horizontal rules, plus Feishu-specific `<at>`,
//                `<text_tag color=...>` and `:emoji:` tags.
//   NOT SUPPORTED — GFM pipe tables, ATX headings (`# H`), blockquotes (`> q`).
//                Inline backtick code is NOT listed in the doc (only fenced
//                blocks are) — treated as "unconfirmed", see below.
//
// Design contrast with telegram-markdown.ts: Telegram renders a DIFFERENT dialect,
// so that converter must rewrite every inline construct into Satori h-nodes. Here
// the inline constructs Feishu supports (bold/italic/strike/links) are passed
// through UNTOUCHED — we only rewrite the BLOCK-level constructs Feishu can't
// render. Passing inline through verbatim is also what makes this stream-safe: an
// unclosed `**bold` is simply left as the literal characters `*` `*` `b`...; there
// is no parser state to leave dangling on a partial streaming edit. (Block
// detection is likewise monotonic: a half-streamed table without its separator row
// is just emitted as ordinary `|`-bearing lines until the separator arrives.)
//
// Inline backtick code: the card-markdown doc lists fenced code blocks but NOT
// inline `` `code` ``. Rather than mangle it (lossy) we PASS IT THROUGH: Lark
// commonly does render inline backticks, and in the worst case the user sees
// literal backticks — acceptable, never "broken". Flagged as an uncertainty for
// the orchestrator at integration.

// Table degrade (separator regex, row split, bold-title + bullets rendering) is
// shared with dingtalk-markdown.ts — see markdown-tables.ts.
import { TABLE_SEPARATOR_RE, splitTableRow, renderTableBlock } from './markdown-tables.js';

/**
 * Convert a full CommonMark string into a Feishu markdown-subset string.
 *
 * Block handling is line-based and only the UNSUPPORTED blocks are rewritten;
 * everything else (lists, emphasis, links, fenced code, horizontal rules, blank
 * lines) is passed through verbatim so we never double-convert what Feishu already
 * renders. Original line breaks are preserved (Lark `md` treats `\n` as a line
 * break), so paragraph spacing survives unchanged.
 */
export function renderLarkMarkdown(input: string): string {
  if (!input) return '';
  const lines = input.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block: ```lang ... ``` — SUPPORTED, so pass through verbatim
    // (fences included). Critically, this also SKIPS the block rewrites below for
    // the body, so a `# comment` or a `| a | b |` line inside code is never
    // mistaken for a heading/table. An unclosed fence at end-of-stream is emitted
    // as-is (stream safety: Lark renders it as an open code block, not an error).
    if (/^\s*```/.test(line)) {
      out.push(line);
      i++;
      while (i < lines.length) {
        out.push(lines[i]!);
        const closed = /^\s*```\s*$/.test(lines[i]!);
        i++;
        if (closed) break;
      }
      continue;
    }

    // GFM table: a pipe-bearing header row immediately followed by a separator
    // row. NOT SUPPORTED by Feishu → degrade to bold-title + `• Label: Value`
    // bullets (the primary reason this converter exists).
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]!)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.includes('|') && lines[j]!.trim() !== '') {
        rows.push(splitTableRow(lines[j]!));
        j++;
      }
      out.push(...renderTableBlock(header, rows));
      i = j;
      continue;
    }

    // ATX heading `#`..`######` → bold. NOT SUPPORTED by Feishu (a literal `#`
    // would show), and bold is the closest in-subset equivalent (matches the
    // Telegram degrade). Requires whitespace after the hashes so `#hashtag` is
    // left alone.
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(`**${heading[1]!}**`);
      i++;
      continue;
    }

    // Blockquote `> text` → strip the marker, keep the content as a plain line.
    // NOT documented as supported, and `>` is one of the special characters
    // Feishu's doc says must be HTML-escaped when literal — so a raw `>` prefix
    // risks rendering oddly. Plain text always renders. (Uncertainty flagged for
    // the orchestrator: if Lark turns out to support `>`, this loses the quote
    // styling — but never breaks.)
    if (/^\s*>\s?/.test(line)) {
      out.push(line.replace(/^\s*>\s?/, ''));
      i++;
      continue;
    }

    // Everything else — plain text, `- `/`1. ` lists, `---` rules, and all inline
    // emphasis/links/inline-code — is in (or harmless to) the supported subset, so
    // pass through verbatim. This verbatim path is the stream-safety guarantee:
    // unclosed inline delimiters stay literal, never a dangling construct.
    out.push(line);
    i++;
  }

  return out.join('\n');
}
