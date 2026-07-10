// CommonMark → DingTalk robot-markdown STRING.
//
// Why this exists: agents emit standard CommonMark, but DingTalk robot messages
// (msgKey `sampleMarkdown`, the delivery path in profiles/dingtalk.ts) render a
// documented SUBSET with one famous quirk: a single `\n` is NOT a line break —
// consecutive lines run together unless separated by a blank line.
//
// Evidence for the supported subset (open.dingtalk.com "机器人发送消息的消息类型
// 和数据格式" robot markdown doc, verified 2026-07):
//   SUPPORTED  — `#`..`######` headings, `> ` blockquotes, `**bold**`/`*italic*`,
//                `[t](url)` links, `![alt](url)` images, `- ` unordered and
//                `1. ` ordered lists.
//   NOT SUPPORTED — GFM pipe tables (degraded to bold-title + bullets below).
//   UNCONFIRMED — fenced/inline code and `~~strike~~` are absent from the doc,
//                but @satorijs/adapter-dingtalk's escape() treats `` ` `` and `~`
//                as markdown-active characters (it escapes them), so clients
//                plausibly render them. Passed THROUGH: worst case the user sees
//                literal backticks/tildes — acceptable, never "broken".
//
// Design contrast with lark-markdown.ts (same line-based shape): Lark preserves
// original `\n`s because its `md` segment treats them as breaks. DingTalk ignores
// them, so this converter regroups lines into BLOCKS and joins blocks with
// `\n\n`. Lines that markdown itself parses line-by-line (list items, quote
// lines) are grouped into one tight block; everything else becomes its own
// block so each source line stays a visible line. This deliberately replaces the
// adapter encoder's blanket `\n`→`\n\n` (which double-spaces code blocks).
//
// Stream safety: inline constructs pass through verbatim (an unclosed `**bold`
// stays literal characters), and block detection is monotonic — a half-streamed
// table without its separator row is emitted as ordinary `|`-bearing lines until
// the separator arrives; an unclosed fence at end-of-stream is emitted as-is.
import { TABLE_SEPARATOR_RE, splitTableRow, renderTableBlock } from './markdown-tables.js';

/** List item (`- `/`* `/`1. `) — grouped tight so the list parses as one block. */
const LIST_ITEM_RE = /^\s*(?:[-*]|\d+\.)\s+/;
/** Blockquote line — grouped tight so the quote stays one block. */
const QUOTE_RE = /^\s*>\s?/;

/**
 * Convert a full CommonMark string into a DingTalk markdown-subset string.
 *
 * Line-based: fenced code and tables are handled as multi-line constructs; every
 * other line is classified (list / quote / other) and regrouped into blocks per
 * the header comment. Inline emphasis/links/code are passed through verbatim.
 */
export function renderDingtalkMarkdown(input: string): string {
  if (!input) return '';
  const lines = input.split('\n');
  // Blocks joined with '\n\n' at the end; a multi-line block keeps '\n' inside.
  const blocks: string[] = [];
  let i = 0;

  /** Append `line` to the previous block (tight) when `tight`, else start a new block. */
  const push = (line: string, tight: boolean): void => {
    if (tight && blocks.length > 0) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
  };
  // Whether the previous emitted line may be joined tightly with the next one
  // (both list items, or both quote lines). Reset on blank lines and block ends.
  let prevKind: 'list' | 'quote' | null = null;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line: pure separator. The '\n\n' block join already provides the
    // paragraph gap, so it is dropped — but it does end any tight list/quote run.
    if (line.trim() === '') {
      prevKind = null;
      i++;
      continue;
    }

    // Fenced code block: kept verbatim as ONE block with single '\n's inside
    // (DingTalk preserves newlines inside a rendered fence; the encoder's blanket
    // \n→\n\n would double-space it). Also skips the rewrites below so a
    // `# comment` or `| a | b |` line inside code is never mistaken for a
    // heading/table. An unclosed fence at end-of-stream is emitted as-is.
    if (/^\s*```/.test(line)) {
      const fence: string[] = [line];
      i++;
      while (i < lines.length) {
        fence.push(lines[i]!);
        const closed = /^\s*```\s*$/.test(lines[i]!);
        i++;
        if (closed) break;
      }
      blocks.push(fence.join('\n'));
      prevKind = null;
      continue;
    }

    // GFM table: a pipe-bearing header row immediately followed by a separator
    // row. NOT supported by DingTalk → degrade to bold-title + `• Label: Value`
    // bullets (shared renderTableBlock). Each output line becomes its own block:
    // the `•` lines are plain text, so they need the blank-line separation to
    // stay on separate rendered lines.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]!)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.includes('|') && lines[j]!.trim() !== '') {
        rows.push(splitTableRow(lines[j]!));
        j++;
      }
      blocks.push(...renderTableBlock(header, rows));
      prevKind = null;
      i = j;
      continue;
    }

    // List items and quote lines: markdown parses these line-by-line, so
    // consecutive ones are grouped into one tight block (single '\n') and render
    // as one list / one quote instead of paragraph-spaced fragments.
    const kind: 'list' | 'quote' | null = LIST_ITEM_RE.test(line)
      ? 'list'
      : QUOTE_RE.test(line)
        ? 'quote'
        : null;
    if (kind) {
      push(line, prevKind === kind);
      prevKind = kind;
      i++;
      continue;
    }

    // Everything else — headings, plain text, `---` rules, and all inline
    // emphasis/links/code — is in (or harmless to) the supported subset: pass the
    // line through as its own block, so each source line stays a visible line
    // despite DingTalk ignoring single '\n's.
    blocks.push(line);
    prevKind = null;
    i++;
  }

  return blocks.join('\n\n');
}
