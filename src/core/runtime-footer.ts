/**
 * Platform-agnostic runtime footer (pure functions). Renders e.g.
 * `gpt-4-turbo · 45% · ~/projects/hermes`, joined by ` · `; empty string when no
 * field is available.
 *
 * Pure: no side effects, no clock, no process.env — home dir is passed in.
 */

/** Displayable footer fields. model = short model name / contextPct = context usage % / cwd = working dir. */
export type FooterField = 'model' | 'contextPct' | 'cwd';

export interface FooterInput {
  /** Full model name (may carry a vendor prefix, e.g. `anthropic/claude-opus-4-8`). */
  model?: string;
  /** Context tokens used. */
  contextTokens?: number;
  /** Context window size, for the percentage. */
  contextLength?: number;
  /** Absolute current working directory. */
  cwd?: string;
  /** User home dir; used to replace the home prefix of cwd with `~`. */
  homeDir?: string;
}

const SEPARATOR = ' · ';

/**
 * Render the footer line: assemble each field in the given order, joined by ` · `.
 * Returns '' when no part is available.
 */
export function formatRuntimeFooter(input: FooterInput, fields: FooterField[]): string {
  const parts: string[] = [];

  for (const field of fields) {
    switch (field) {
      case 'model': {
        // Short name: drop the vendor prefix at the last `/`; use as-is without `/`.
        const model = input.model;
        if (model) {
          const slash = model.lastIndexOf('/');
          const short = slash >= 0 ? model.slice(slash + 1) : model;
          // Last segment may be empty (e.g. `anthropic/`); only output if non-empty.
          if (short) parts.push(short);
        }
        break;
      }

      case 'contextPct': {
        // Requires contextLength>0 and contextTokens>=0; round(tokens/length*100), clamped to [0,100].
        const { contextTokens, contextLength } = input;
        if (
          typeof contextLength === 'number' &&
          contextLength > 0 &&
          typeof contextTokens === 'number' &&
          contextTokens >= 0
        ) {
          const raw = Math.round((contextTokens / contextLength) * 100);
          const pct = Math.min(100, Math.max(0, raw));
          parts.push(`${pct}%`);
        }
        break;
      }

      case 'cwd': {
        // When homeDir is given and cwd starts with it, replace the home prefix with `~`.
        const { cwd, homeDir } = input;
        if (cwd) {
          let display = cwd;
          if (homeDir && cwd.startsWith(homeDir)) {
            display = '~' + cwd.slice(homeDir.length);
          }
          parts.push(display);
        }
        break;
      }
    }
  }

  return parts.join(SEPARATOR);
}
