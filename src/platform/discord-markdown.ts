// GFM-table → bullet rewriter for Discord outbound text.
//
// WHY THIS IS SO NARROW (only tables):
// Discord renders standard CommonMark NATIVELY in message content — **bold**, *italic*,
// `inline code`, ```fenced code blocks```, [links](url), > quotes, # headings, - lists all
// display correctly when posted as raw text. So the Discord profile deliberately sends the
// agent's RAW markdown via the raw Discord API (bypassing Satori's escaping; see discord.ts
// sendMessage/editMessage). The ONE CommonMark construct Discord does NOT render is the GFM
// pipe table (`| a | b |` + `|---|---|`): it shows up as literal pipe characters and dashes,
// which is ugly and unreadable. Therefore this module rewrites ONLY tables into Discord-native
// bullet form (`**Title**` + `• Header: Value`) and leaves EVERYTHING else byte-for-byte
// untouched — rewriting anything Discord already renders would be redundant at best and would
// corrupt the agent's formatting at worst.
//
// STREAM SAFETY: renderDiscordMarkdown runs on EVERY streaming edit, not just the final
// message. A table is only rewritten once BOTH its header row and the `|---|` separator row
// have been received; a header that has arrived without its separator yet (the common
// mid-stream state) passes through unchanged. Code fences are tracked so a table-looking line
// inside a ``` block is never rewritten.

/**
 * GFM table separator row, e.g. `|---|:--:|`. At least two dashes per cell, optional alignment
 * colons, optional edge pipes. Borrowed from telegram-markdown.ts so detection stays identical.
 */
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Opening/closing line of a fenced code block: ``` or ~~~ (with optional language/indent). */
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Split a GFM table row into trimmed cell strings, dropping the empty cells created by the
 * leading/trailing edge pipes (`| a | b |` → ['a','b']). Mirrors telegram-markdown.ts.
 */
function splitTableRow(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * Render one GFM table (already-split header + body rows) as Discord-native markdown lines.
 *
 * Each body row becomes a bold title (its first cell) followed by one `• Header: Value` bullet
 * per remaining cell. Empty cells are skipped; an empty first cell skips the title line. Rows are
 * separated by a blank line for readability. Returns an array of output lines (no trailing blank).
 * Mirrors telegram-markdown.ts's renderTableBlock, but emits a plain string instead of Satori nodes
 * because Discord wants raw markdown text out (it renders **bold** and `•` natively).
 */
function renderTableBlock(header: string[], rows: string[][]): string[] {
  const out: string[] = [];
  rows.forEach((row, ri) => {
    if (ri > 0) out.push(''); // blank line between row groups
    const title = row[0] ?? '';
    if (title) out.push(`**${title}**`);
    for (let c = 1; c < row.length; c++) {
      const label = header[c] ?? '';
      const value = row[c] ?? '';
      if (!value) continue;
      out.push(label ? `• ${label}: ${value}` : `• ${value}`);
    }
  });
  return out;
}

/**
 * Rewrite GFM tables in `text` to Discord-native bullet form, leaving all other content
 * (and content inside code fences) exactly as-is.
 *
 * Line-based scan:
 *  - Inside a ``` / ~~~ fence: pass every line through verbatim (never rewrite a table here).
 *  - A line containing `|` immediately followed by a separator row → consume the contiguous
 *    pipe-bearing body rows and emit bullet lines.
 *  - Everything else: emit the line unchanged.
 *
 * Because non-table lines are reproduced verbatim and rejoined with '\n', output is byte-identical
 * to input whenever there is no complete table (the no-op / stream-safe case).
 */
export function renderDiscordMarkdown(text: string): string {
  // Fast path / nothing to do.
  if (!text) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Toggle fenced-code-block state; fence delimiter lines and their bodies pass through untouched.
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    // GFM table: a pipe-bearing header row immediately followed by a `|---|` separator row.
    // Requiring the separator to be present is what makes this stream-safe — a header that has
    // streamed in without its separator yet is just a normal line and passes through unchanged.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]!)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      // Body rows: contiguous, pipe-bearing, non-blank lines.
      while (j < lines.length && lines[j]!.includes('|') && lines[j]!.trim() !== '') {
        rows.push(splitTableRow(lines[j]!));
        j++;
      }
      out.push(...renderTableBlock(header, rows));
      i = j;
      continue;
    }

    // Any other line: Discord renders it natively, so emit it verbatim.
    out.push(line);
    i++;
  }

  return out.join('\n');
}
