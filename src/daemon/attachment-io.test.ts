import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS resolution so the domain-path SSRF tests are deterministic and offline.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { isPrivateAddress, sanitizeFilename, assertSafeAttachmentUrl } from './attachment-io.js';

const mockLookup = vi.mocked(lookup);

/**
 * Security-critical pure functions guarding SSRF (isPrivateAddress / assertSafeAttachmentUrl) and
 * path traversal (sanitizeFilename). These are the entire enforcement layer for attacker-controlled
 * attachment URLs and filenames, so they're tested boundary-by-boundary against regressions.
 */
describe('isPrivateAddress', () => {
  const blocked = [
    '127.0.0.1', // loopback
    '127.255.255.255',
    '10.0.0.1', // private /8
    '172.16.0.1', // private /12 low boundary
    '172.31.255.255', // private /12 high boundary
    '192.168.0.1', // private /16
    '169.254.169.254', // cloud metadata link-local
    '169.254.0.1',
    '0.0.0.0', // unspecified
    '::1', // IPv6 loopback
    '::', // IPv6 unspecified
    'fc00::1', // ULA
    'fd12:3456::1', // ULA
    'fe80::1', // link-local
    'feab::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1', // IPv4-mapped private
  ];
  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255', // just below the private /12 range
    '172.32.0.1', // just above the private /12 range
    '192.169.0.1', // just outside 192.168/16
    '169.253.0.1', // just outside 169.254/16
    '2606:4700:4700::1111', // public IPv6 (cloudflare)
    '::ffff:8.8.8.8', // IPv4-mapped public
  ];
  const invalid = ['not-an-ip', '999.1.1.1', '', '1.2.3', '256.256.256.256'];

  it.each(blocked)('blocks private/loopback/link-local %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(allowed)('allows public address %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it.each(invalid)('returns false for non-IP input %s (left to URL/DNS validation)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  const cases: [string, string][] = [
    ['../../etc/passwd', 'passwd'],
    ['a/b/c.png', 'c.png'],
    ['..\\..\\windows\\system32', 'system32'],
    ['...hidden', 'hidden'], // leading dots stripped
    ['.', 'file'], // dot-only collapses to fallback
    ['', 'file'], // empty -> fallback
    ['   ', 'file'], // whitespace-only -> fallback
    ['file\x00name', 'file_name'], // NUL replaced
    ['a<b>c:d"e|f?g*h', 'a_b_c_d_e_f_g_h'], // illegal chars replaced
    ['normal.txt', 'normal.txt'],
    ['/absolute/path/to/file.bin', 'file.bin'],
  ];
  it.each(cases)('sanitizes %j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });
  it('never returns a value containing a path separator', () => {
    for (const [input] of cases) {
      const out = sanitizeFilename(input);
      expect(out.includes('/')).toBe(false);
      expect(out.includes('\\')).toBe(false);
    }
  });
});

describe('assertSafeAttachmentUrl', () => {
  beforeEach(() => mockLookup.mockReset());

  it('rejects non-http(s) schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://host/x', 'data:text/plain,hi', 'gopher://h']) {
      await expect(assertSafeAttachmentUrl(url)).rejects.toThrow();
    }
  });

  it('rejects literal private/loopback IP hosts without any DNS lookup', async () => {
    await expect(assertSafeAttachmentUrl('http://127.0.0.1/x')).rejects.toThrow(/private|loopback/i);
    await expect(assertSafeAttachmentUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertSafeAttachmentUrl('http://[::1]/x')).rejects.toThrow();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('allows a literal public IP host without DNS lookup', async () => {
    await expect(assertSafeAttachmentUrl('https://8.8.8.8/file.png')).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects a domain that resolves to a private address (DNS-to-internal bypass)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(assertSafeAttachmentUrl('https://evil.example.com/x')).rejects.toThrow(/private|loopback/i);
  });

  it('rejects when ANY resolved record is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never);
    await expect(assertSafeAttachmentUrl('https://mixed.example.com/x')).rejects.toThrow();
  });

  it('allows a domain that resolves only to public addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(assertSafeAttachmentUrl('https://cdn.example.com/file.png')).resolves.toBeUndefined();
  });

  it('rejects a malformed URL', async () => {
    await expect(assertSafeAttachmentUrl('not a url')).rejects.toThrow(/invalid attachment URL/i);
  });
});
