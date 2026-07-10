// Shared GFM-table degrade for STRING-emitting markdown converters.
//
// Agents emit GFM pipe tables, but none of the CJK-IM markdown dialects served
// here (Feishu/Lark card markdown, DingTalk robot markdown) render a table
// primitive — the pipes would reach the user as literal noise. Both converters
// degrade a table to "bold row title + `• Label: Value` bullets", byte-identical
// logic, so it lives here (same collapse rule as profile-helpers.ts: extract only
// IDENTICAL decisions). telegram-markdown.ts has the same table shape but emits
// Satori h-nodes, not strings, so it keeps its own renderer.

/** GFM table separator row, e.g. `|---|:--:|`. At least one dash per cell. */
export const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Split a GFM table row into trimmed cell strings (drops the leading/trailing empty cells from edge pipes). */
export function splitTableRow(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * Render a GFM table (header + body rows) as markdown-friendly bullet lines.
 * Each body row becomes a bold title (first cell) followed by `• Header: Value`
 * bullets for the remaining cells. Mirrors telegram-markdown.ts' renderTableBlock
 * and hermes' _render_table_block, but emits STRINGS (one element per output
 * line) since these surfaces consume markdown text, not h-nodes.
 *
 * Cell text is emitted verbatim: any inline markdown inside a cell (`**x**`,
 * `[a](b)`) is in the supported subset, so re-parsing would only risk breaking it.
 */
export function renderTableBlock(header: string[], rows: string[][]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    // First cell is the row title (bold). Empty first cell → skip the title line.
    // Don't re-wrap a cell that is already fully bold (`**x**`/`__x__`), or we'd
    // emit broken `****x****`.
    const title = row[0] ?? '';
    if (title) {
      const alreadyBold = /^(\*\*|__)[\s\S]+\1$/.test(title);
      lines.push(alreadyBold ? title : `**${title}**`);
    }
    for (let c = 1; c < row.length; c++) {
      const label = header[c] ?? '';
      const value = row[c] ?? '';
      if (!value) continue;
      lines.push(label ? `• ${label}: ${value}` : `• ${value}`);
    }
  }
  return lines;
}
