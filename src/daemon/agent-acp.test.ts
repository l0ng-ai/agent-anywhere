import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { translateUpdate, type TurnState } from './agent-acp.js';

/** Recording TurnState: capture handler calls as an event string for order assertions. */
function recorder(): { st: TurnState; events: string[]; commands: unknown[] } {
  const events: string[] = [];
  const commands: unknown[] = [];
  const st: TurnState = {
    handlers: {
      onText: (d) => events.push(`text:${d}`),
      onToolStart: (e) => events.push(`start:${e.name}|${e.inputPreview}`),
      onToolFinish: (e) => events.push(`finish:${e.name}|${e.ok}`),
      onSegmentBreak: () => events.push('seg'),
      onAvailableCommands: (c) => commands.push(c),
    },
    lastSegment: 'none',
    toolLedger: new Map(),
    toolIndexSeq: 0,
  };
  return { st, events, commands };
}

const feed = (st: TurnState, u: unknown) => translateUpdate(u as SessionUpdate, st);

describe('translateUpdate tool state machine (ACP generic)', () => {
  it('params arrive late: pending empty input not rendered, then rendered once with kind short name + truncated params', () => {
    const { st, events } = recorder();
    // 1) first pending, empty input, placeholder title → not rendered
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Terminal', kind: 'execute', rawInput: {}, status: 'pending' });
    expect(events).toEqual([]);
    // 2) params streamed (same id overwrites) → render: name from kind (execute→Bash), preview from rawInput.command
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', title: '`gh ...`', kind: 'execute', rawInput: { command: 'gh ...' }, status: 'pending' });
    expect(events).toEqual(['start:Bash|gh ...']);
    // 3) completed
    feed(st, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(events).toEqual(['start:Bash|gh ...', 'finish:Bash|true']);
  });

  it('always-empty input but status advances: still renders, preview degrades to title (does not show "{}")', () => {
    const { st, events } = recorder();
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Terminal', kind: 'execute', rawInput: {}, status: 'pending' });
    expect(events).toEqual([]);
    feed(st, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });
    expect(events).toEqual(['start:Bash|Terminal']); // empty rawInput → preview degrades to title
    feed(st, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(events).toEqual(['start:Bash|Terminal', 'finish:Bash|true']);
  });

  it('terminal arrives first (no in_progress): synthesize one start then finish', () => {
    const { st, events } = recorder();
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read x', kind: 'read', rawInput: { file_path: 'src/x.ts' }, status: 'completed' });
    expect(events).toEqual(['start:Read|src/x.ts', 'finish:Read|true']);
  });

  it('failed → onToolFinish ok=false', () => {
    const { st, events } = recorder();
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', rawInput: { command: 'boom' }, status: 'in_progress' });
    feed(st, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed' });
    expect(events).toEqual(['start:Bash|boom', 'finish:Bash|false']);
  });

  it('text→tool boundary triggers onSegmentBreak once', () => {
    const { st, events } = recorder();
    feed(st, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "I'll run it" } });
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', rawInput: { command: 'ls' }, status: 'in_progress' });
    expect(events).toEqual(["text:I'll run it", 'seg', 'start:Bash|ls']);
  });

  it('falls back to the truncated title (backticks stripped) when there is no kind', () => {
    const { st, events } = recorder();
    feed(st, { sessionUpdate: 'tool_call', toolCallId: 't1', title: '`do-thing`', rawInput: { x: 1 }, status: 'in_progress' });
    // no kind → name uses stripCode(title)='do-thing'; preview from rawInput summary
    expect(events[0]).toBe('start:do-thing|{"x":1}');
  });

  it('available_commands_update normalizes to {name,description,hint} for onAvailableCommands', () => {
    const { st, commands, events } = recorder();
    feed(st, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'create_plan', description: 'Create a plan', input: { hint: 'Describe the goal' } },
        { name: 'review', description: 'Review' }, // no input → hint undefined
      ],
    });
    expect(events).toEqual([]); // doesn't pollute the text/tool event stream
    expect(commands).toEqual([
      [
        { name: 'create_plan', description: 'Create a plan', hint: 'Describe the goal' },
        { name: 'review', description: 'Review', hint: undefined },
      ],
    ]);
  });
});
