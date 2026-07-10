import { describe, expect, it } from 'vitest';
import { parseAskButtonId } from './daemon.js';

describe('parseAskButtonId', () => {
  it('parses a valid ask:<reqId>:<index>', () => {
    expect(parseAskButtonId('ask:ab12cd34:0')).toEqual({ reqId: 'ab12cd34', index: 0 });
    expect(parseAskButtonId('ask:ab12cd34:3')).toEqual({ reqId: 'ab12cd34', index: 3 });
  });

  it('non-ask prefix returns null (reserved for future slash/other interactions)', () => {
    expect(parseAskButtonId('input:foo:0')).toBeNull();
    expect(parseAskButtonId('other:1')).toBeNull();
    expect(parseAskButtonId('')).toBeNull();
  });

  it('missing index / invalid index returns null', () => {
    expect(parseAskButtonId('ask:ab12')).toBeNull();
    expect(parseAskButtonId('ask:ab12:')).toBeNull();
    expect(parseAskButtonId('ask:ab12:x')).toBeNull();
    expect(parseAskButtonId('ask:ab12:-1')).toBeNull();
    expect(parseAskButtonId('ask::0')).toBeNull();
  });

  it('splits on the last colon when reqId contains non-separator chars', () => {
    // reqId from randomUUID().slice(0,8) contains no colon; this conservatively checks lastIndexOf behavior.
    expect(parseAskButtonId('ask:a:b:2')).toEqual({ reqId: 'a:b', index: 2 });
  });
});
