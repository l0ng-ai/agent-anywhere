import { describe, it, expect } from 'vitest';
import { redactProxyUrl } from './proxy.js';

describe('redactProxyUrl', () => {
  it('masks embedded credentials', () => {
    expect(redactProxyUrl('http://user:pass@proxy.local:8080')).toBe('http://***@proxy.local:8080/');
    expect(redactProxyUrl('http://user:pass@proxy.local:8080')).not.toContain('pass');
  });
  it('leaves a credential-free URL intact (modulo normalization)', () => {
    expect(redactProxyUrl('http://proxy.local:8080')).toBe('http://proxy.local:8080/');
  });
  it('masks a username-only URL', () => {
    expect(redactProxyUrl('http://tokenuser@proxy.local')).not.toContain('tokenuser');
  });
  it('falls back to a constant for an unparseable URL', () => {
    expect(redactProxyUrl('::not a url::')).toBe('(unparseable proxy URL, redacted)');
  });
});
