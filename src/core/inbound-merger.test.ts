import { describe, expect, it, vi } from 'vitest';
import { InboundMerger, type MergerDeps } from './inbound-merger.js';
import type { InboundMessage } from '../types.js';

/**
 * Unit tests for the interrupt path (interruptOnNewMessage): a message arriving while a turn runs
 * cancels the in-flight turn (abortTurn + trips the turn's AbortSignal) and runs the queued message
 * as a fresh batch; with the flag off, the message is queued and waits for the natural turn end.
 */

function msg(id: string): InboundMessage {
  return { platform: 'discord', channelId: 'c', userId: 'u', messageId: id, content: id, timestamp: 0 };
}

const reactions = { received: '👀', done: '✅', error: '❌' };

/** Minimal manual scheduler: schedule() records timers; advance() fires those past due. */
function makeClock() {
  let t = 0;
  const timers: Array<{ fn: () => void; at: number }> = [];
  return {
    now: () => t,
    schedule(fn: () => void, ms: number) {
      const entry = { fn, at: t + ms };
      timers.push(entry);
      return () => {
        const i = timers.indexOf(entry);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    advance(ms: number) {
      t += ms;
      for (const e of timers.filter((e) => e.at <= t).sort((a, b) => a.at - b.at)) {
        const i = timers.indexOf(e);
        if (i >= 0) timers.splice(i, 1);
        e.fn();
      }
    },
  };
}

/** Flush pending microtasks/macrotasks (real timers, separate from the mocked clock). */
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(interruptOnNewMessage: boolean) {
  const clock = makeClock();
  const batches: string[][] = [];
  const signals: Array<AbortSignal | undefined> = [];
  let resolveFirst!: () => void;
  let n = 0;
  const abortTurn = vi.fn();
  const deps: MergerDeps = {
    now: clock.now,
    schedule: clock.schedule,
    addReaction: vi.fn().mockResolvedValue(undefined),
    runTurn: vi.fn((batch: InboundMessage[], signal?: AbortSignal) => {
      batches.push(batch.map((m) => m.messageId));
      signals.push(signal);
      n += 1;
      // First turn stays pending until the test resolves it (so a second message lands mid-run).
      if (n === 1) return new Promise<void>((res) => (resolveFirst = res));
      return Promise.resolve();
    }),
    abortTurn,
  };
  const merger = new InboundMerger(
    { mergeWindowMs: 1500, maxMergeWindowMs: 5000, interruptOnNewMessage, reactions },
    deps
  );
  return { merger, clock, deps, batches, signals, abortTurn, resolveFirst: () => resolveFirst() };
}

describe('InboundMerger interrupt', () => {
  it('interruptOnNewMessage=true: aborts the running turn and runs the new message as a fresh batch', async () => {
    const h = harness(true);

    await h.merger.ingest(msg('m1'));
    h.clock.advance(1500); // merge window elapses → first turn dispatched (stays pending)
    expect(h.deps.runTurn).toHaveBeenCalledTimes(1);
    expect(h.merger.isIdle()).toBe(false);

    // New message during the running turn → cancel the agent + trip the turn's abort signal.
    await h.merger.ingest(msg('m2'));
    expect(h.abortTurn).toHaveBeenCalledTimes(1);
    expect(h.signals[0]?.aborted).toBe(true);
    expect(h.deps.runTurn).toHaveBeenCalledTimes(1); // not yet — waits for the interrupted turn to settle

    // Interrupted turn settles → queued m2 runs as a fresh, un-aborted batch.
    h.resolveFirst();
    await tick();
    expect(h.deps.runTurn).toHaveBeenCalledTimes(2);
    expect(h.batches[1]).toEqual(['m2']);
    expect(h.signals[1]?.aborted).toBe(false);
    expect(h.merger.isIdle()).toBe(true);
  });

  it('interruptOnNewMessage=false: queues the new message and waits for the natural turn end', async () => {
    const h = harness(false);

    await h.merger.ingest(msg('m1'));
    h.clock.advance(1500);
    expect(h.deps.runTurn).toHaveBeenCalledTimes(1);

    await h.merger.ingest(msg('m2'));
    expect(h.abortTurn).not.toHaveBeenCalled();
    expect(h.signals[0]?.aborted).toBe(false);
    expect(h.deps.runTurn).toHaveBeenCalledTimes(1);

    h.resolveFirst();
    await tick();
    expect(h.deps.runTurn).toHaveBeenCalledTimes(2);
    expect(h.batches[1]).toEqual(['m2']);
  });
});
