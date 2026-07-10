import { describe, it, expect } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { decidePermission } from './agent-acp.js';

/**
 * decidePermission is the client-side answer to the agent's session/request_permission. The daemon
 * is a headless ACP client that auto-approves every tool call (agents run with full tool access) —
 * so it always selects an allow option, preferring allow_once, and only cancels if the agent
 * offered no allow option at all.
 */
function reqWith(kinds: string[]): RequestPermissionRequest {
  return {
    sessionId: 's1',
    toolCall: { toolCallId: 't1', title: 'x' },
    options: kinds.map((kind, i) => ({ optionId: `${kind}-${i}`, name: kind, kind })),
  } as unknown as RequestPermissionRequest;
}

describe('decidePermission (always auto-approve)', () => {
  it('selects allow_once when present', () => {
    expect(decidePermission(reqWith(['allow_once', 'allow_always', 'reject_once']))).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once-0' },
    });
  });

  it('falls back to any allow_* when allow_once absent', () => {
    expect(decidePermission(reqWith(['allow_always', 'reject_once']))).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_always-0' },
    });
  });

  it('cancels only when the agent offers no allow option', () => {
    expect(decidePermission(reqWith(['reject_once', 'reject_always']))).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });
});
