import type { MessageRef, ToolEvent, ToolFinishEvent, ToolMode } from '../types.js';

/**
 * Tool bubble renderer.
 *
 * Renders tool progress as bubbles separate from the body: {emoji} {tool}: "{preview≤N}".
 * Four modes: off / all / new (dedupe consecutive same-name) / verbose (append args JSON).
 *
 * Grouping:
 * - separate: one new bubble per tool.
 * - accumulate: edit all progress into one bubble (multi-line in-place refresh);
 *   onToolFinish updates the matching line to "✓/✗ + duration".
 *
 * Note: the body is owned by StreamBuffer; this renderer only handles tool bubbles
 * and signals segment breaks. The daemon coordinates: it completes the current body
 * buffer, emits the tool bubble, then starts a fresh body buffer.
 */

export interface ToolRendererOptions {
  mode: ToolMode;
  /**
   * - 'separate': one new bubble per tool.
   * - 'accumulate': edit all progress into one bubble (needs sink.editBubble;
   *   degrades to separate when unavailable).
   * Defaults to 'accumulate' when omitted, so callers that don't pass it still compile.
   */
  grouping?: 'separate' | 'accumulate';
  previewLimit: number;
  defaultEmoji: string;
  emojiMap: Record<string, string>;
}

/**
 * Tool bubble send channel.
 * - sendBubble: send a new message, returns a ref.
 * - editBubble (optional): edit a message in place; accumulate uses it to refresh
 *   one bubble. When absent, accumulate degrades to separate.
 */
export interface BubbleSink {
  sendBubble(text: string): Promise<MessageRef>;
  editBubble?(ref: MessageRef, text: string): Promise<void>;
}

/** One tool progress line in the current segment (accumulate mode). */
interface ToolLine {
  /** Sequence number linking start/finish; undefined → located by appearance order. */
  index?: number;
  name: string;
  /** Rendered "in progress" body (emoji + name + preview). */
  body: string;
  /** verbose JSON code block under the line (once); undefined otherwise. */
  json?: string;
  /** Finish state: undefined = in progress; otherwise records ok and duration. */
  finish?: { ok: boolean; durationMs: number };
}

export class ToolRenderer {
  private lastToolName: string | null = null;

  // ---- accumulate segment state ----
  private lines: ToolLine[] = [];
  /** Bubble ref of the current segment (set after the first sendBubble). */
  private bubbleRef: MessageRef | null = null;

  constructor(
    private readonly opts: ToolRendererOptions,
    private readonly sink: BubbleSink
  ) {}

  /** Effective grouping (defaults to accumulate when omitted). */
  private get grouping(): 'separate' | 'accumulate' {
    return this.opts.grouping ?? 'accumulate';
  }

  /** Whether accumulate is actually usable: mode is accumulate and the sink supports edit. */
  private get accumulateActive(): boolean {
    return this.grouping === 'accumulate' && typeof this.sink.editBubble === 'function';
  }

  /** Called when a tool starts. Returns whether a bubble was actually sent (drives segment break). */
  async onToolStart(evt: ToolEvent): Promise<boolean> {
    if (this.opts.mode === 'off') return false;

    if (this.opts.mode === 'new' && evt.name === this.lastToolName) {
      return false; // dedupe consecutive same-name (applies under both groupings)
    }
    this.lastToolName = evt.name;

    const emoji = this.opts.emojiMap[evt.name] ?? this.opts.defaultEmoji;
    const preview = this.truncate(evt.inputPreview, this.opts.previewLimit);
    const body = `${emoji} ${evt.name}: "${preview}"`;
    const json =
      this.opts.mode === 'verbose' && evt.input !== undefined
        ? '```json\n' + safeJson(evt.input) + '\n```'
        : undefined;

    if (!this.accumulateActive) {
      // separate (incl. degraded accumulate): one new bubble per tool, no line set.
      let text = body;
      if (json) text += '\n' + json;
      await this.sink.sendBubble(text);
      return true;
    }

    // accumulate: add the tool to the line set and re-render the whole bubble.
    this.lines.push({ index: evt.index, name: evt.name, body, json });

    if (this.bubbleRef === null) {
      // First in segment: send a new bubble to get a ref.
      this.bubbleRef = await this.sink.sendBubble(this.renderBlock());
      return true; // a bubble was sent → daemon triggers a segment break
    }

    // Subsequent in segment: edit the same bubble in place (not a new bubble).
    await this.sink.editBubble!(this.bubbleRef, this.renderBlock());
    return false;
  }

  /**
   * Tool finish: locate the line by index/name, mark ok and duration, re-render.
   *
   * separate trade-off: each tool is a separate bubble with no per-index ref, so
   * its bubble can't be edited afterward → safe no-op.
   * accumulate: update the line set and editBubble to refresh the same bubble.
   */
  async onToolFinish(evt: ToolFinishEvent): Promise<void> {
    if (this.opts.mode === 'off') return;
    if (!this.accumulateActive) return; // separate: can't locate a per-tool bubble, no-op

    const line = this.findLine(evt);
    if (!line) return; // no matching line (e.g. deduped by 'new'): ignore

    line.finish = { ok: evt.ok, durationMs: evt.durationMs };

    if (this.bubbleRef === null) return; // unreachable (a line implies a ref)
    await this.sink.editBubble!(this.bubbleRef, this.renderBlock());
  }

  /**
   * Called at end of turn / body-segment switch. Clears the accumulate line set
   * and bubble ref (next segment starts a new bubble) and resets 'new' dedupe state.
   */
  resetSegment(): void {
    this.lastToolName = null;
    this.lines = [];
    this.bubbleRef = null;
  }

  /** Locate the best matching unfinished line by index (preferred) or name (fallback). */
  private findLine(evt: ToolFinishEvent): ToolLine | undefined {
    if (evt.index !== undefined) {
      const byIndex = this.lines.find((l) => l.index === evt.index);
      if (byIndex) return byIndex;
    }
    // No index or no hit: take the earliest unfinished line with the same name.
    return this.lines.find((l) => l.name === evt.name && l.finish === undefined);
  }

  /** Render the line set into one block (lines joined by \n; verbose JSON under its line). */
  private renderBlock(): string {
    const parts: string[] = [];
    for (const l of this.lines) {
      let row = l.body;
      if (l.finish) {
        const mark = l.finish.ok ? '✓' : '✗';
        row += ` ${mark} ${formatDuration(l.finish.durationMs)}`;
      }
      parts.push(row);
      if (l.json) parts.push(l.json);
    }
    return parts.join('\n');
  }

  private truncate(s: string, n: number): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length <= n ? flat : flat.slice(0, n - 1) + '…';
  }
}

/** Duration formatting: <1000ms → "832ms"; otherwise "1.2s" (one decimal). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
