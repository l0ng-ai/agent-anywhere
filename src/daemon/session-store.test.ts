import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './session-store.js';

/**
 * SessionStore: the persistent sessionKey → ACP sessionId map behind restart-surviving context.
 * Covers write-through persistence, reload in a new instance, delete, and corrupt-file tolerance.
 */

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-anywhere-store-'));
  file = path.join(dir, 'sessions.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('set persists write-through and a new instance reloads it', () => {
    const a = new SessionStore(file);
    a.set('telegram:c:1', 'acp-111');
    a.set('feishu-main:c:oc_2', 'acp-222');

    const b = new SessionStore(file);
    expect(b.get('telegram:c:1')).toBe('acp-111');
    expect(b.get('feishu-main:c:oc_2')).toBe('acp-222');
  });

  it('delete removes the entry from disk too', () => {
    const a = new SessionStore(file);
    a.set('telegram:c:1', 'acp-111');
    a.delete('telegram:c:1');

    expect(a.get('telegram:c:1')).toBeUndefined();
    expect(new SessionStore(file).get('telegram:c:1')).toBeUndefined();
  });

  it('missing or corrupt file degrades to empty instead of throwing', () => {
    expect(new SessionStore(file).get('x')).toBeUndefined();

    fs.writeFileSync(file, '{ not json');
    const s = new SessionStore(file);
    expect(s.get('x')).toBeUndefined();
    s.set('x', 'acp-1'); // still writable after corrupt load
    expect(new SessionStore(file).get('x')).toBe('acp-1');
  });

  it('non-string values in the file are ignored on load', () => {
    fs.writeFileSync(file, JSON.stringify({ good: 'acp-1', bad: 42 }));
    const s = new SessionStore(file);
    expect(s.get('good')).toBe('acp-1');
    expect(s.get('bad')).toBeUndefined();
  });
});
