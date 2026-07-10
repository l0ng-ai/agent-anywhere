import { describe, it, expect, vi } from 'vitest';
import {
  ingestAttachments,
  isReadableText,
  type AttachmentInput,
  type AttachmentIngestConfig,
  type AttachmentIngestDeps,
} from './attachment-ingest.js';

const CFG: AttachmentIngestConfig = {
  maxInjectBytes: 100,
  maxDownloadBytes: 1000,
};

/** Build downloaded bytes from a string. */
function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Mock deps: download returns by url→content map; save returns a fake path and records the call. */
function makeDeps(opts: {
  contents?: Record<string, { text: string; contentType?: string }>;
  downloadError?: Record<string, boolean>;
} = {}): AttachmentIngestDeps & { saveCalls: Array<{ name: string; bytes: Uint8Array }> } {
  const saveCalls: Array<{ name: string; bytes: Uint8Array }> = [];
  return {
    saveCalls,
    download: vi.fn(async (url: string) => {
      if (opts.downloadError?.[url]) throw new Error('network error');
      const c = opts.contents?.[url];
      if (!c) throw new Error(`mock not configured for url: ${url}`);
      return { bytes: bytesOf(c.text), contentType: c.contentType };
    }),
    save: vi.fn(async (name: string, bytes: Uint8Array) => {
      saveCalls.push({ name, bytes });
      return `/cache/${name}`;
    }),
  };
}

describe('isReadableText', () => {
  it('matches text/*, json/xml, and structured suffixes by mime', () => {
    expect(isReadableText('text/plain', undefined)).toBe(true);
    expect(isReadableText('text/markdown; charset=utf-8', undefined)).toBe(true);
    expect(isReadableText('application/json', undefined)).toBe(true);
    expect(isReadableText('application/xml', undefined)).toBe(true);
    expect(isReadableText('application/ld+json', undefined)).toBe(true);
    expect(isReadableText('image/svg+xml', undefined)).toBe(true);
  });

  it('matches common text/code files by extension', () => {
    expect(isReadableText(undefined, 'notes.md')).toBe(true);
    expect(isReadableText(undefined, 'main.ts')).toBe(true);
    expect(isReadableText(undefined, 'data.csv')).toBe(true);
  });

  it('binary mime / unknown extension → false', () => {
    expect(isReadableText('image/png', 'pic.png')).toBe(false);
    expect(isReadableText('application/octet-stream', 'blob.bin')).toBe(false);
    expect(isReadableText(undefined, undefined)).toBe(false);
  });
});

describe('ingestAttachments', () => {
  it('empty array → empty promptText, no files', async () => {
    const deps = makeDeps();
    const res = await ingestAttachments([], CFG, deps);
    expect(res.promptText).toBe('');
    expect(res.files).toEqual([]);
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('readable text document → inlined fenced block + content, not persisted', async () => {
    const att: AttachmentInput = { type: 'file', url: 'u1', name: 'a.md', mime: 'text/markdown', size: 10 };
    const deps = makeDeps({ contents: { u1: { text: '# Hello\nworld' } } });
    const res = await ingestAttachments([att], CFG, deps);

    expect(res.promptText).toContain('Attachment a.md');
    expect(res.promptText).toContain('```md');
    expect(res.promptText).toContain('# Hello\nworld');
    expect(res.promptText).toContain('```');
    expect(deps.save).not.toHaveBeenCalled();
    expect(res.files).toEqual([]);
  });

  it('text over maxInjectBytes → not inlined, persisted with a path', async () => {
    const big = 'x'.repeat(200); // > maxInjectBytes(100)
    // Unknown size exercises the "download then decide by byte length" path.
    const att: AttachmentInput = { type: 'file', url: 'u2', name: 'big.log', mime: 'text/plain' };
    const deps = makeDeps({ contents: { u2: { text: big } } });
    const res = await ingestAttachments([att], CFG, deps);

    expect(res.promptText).not.toContain('```');
    expect(res.promptText).toContain('big.log saved to /cache/big.log');
    expect(deps.save).toHaveBeenCalledOnce();
    expect(res.files).toEqual([{ path: '/cache/big.log', name: 'big.log', mime: 'text/plain' }]);
  });

  it('binary/image → persisted path line', async () => {
    const att: AttachmentInput = { type: 'image', url: 'u3', name: 'pic.png', mime: 'image/png', size: 500 };
    const deps = makeDeps({ contents: { u3: { text: 'PNGDATA' } } });
    const res = await ingestAttachments([att], CFG, deps);

    expect(res.promptText).toContain('Attachment pic.png saved to /cache/pic.png');
    expect(res.promptText).toContain('(image/png)');
    expect(res.promptText).toContain('Read tool');
    expect(deps.save).toHaveBeenCalledOnce();
    expect(res.files[0]).toEqual({ path: '/cache/pic.png', name: 'pic.png', mime: 'image/png' });
  });

  it('over maxDownloadBytes → not downloaded, metadata line only', async () => {
    const att: AttachmentInput = { type: 'file', url: 'u4', name: 'huge.zip', mime: 'application/zip', size: 5000 };
    const deps = makeDeps();
    const res = await ingestAttachments([att], CFG, deps);

    expect(res.promptText).toContain('huge.zip is too large (5000 bytes), not downloaded');
    expect(res.promptText).toContain('URL: u4');
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(res.files).toEqual([]);
  });

  it('one attachment download throws → degraded line, others unaffected', async () => {
    const bad: AttachmentInput = { type: 'image', url: 'bad', name: 'x.png', mime: 'image/png', size: 100 };
    const good: AttachmentInput = { type: 'file', url: 'good', name: 'ok.txt', mime: 'text/plain', size: 5 };
    const deps = makeDeps({
      contents: { good: { text: 'hi' } },
      downloadError: { bad: true },
    });
    const res = await ingestAttachments([bad, good], CFG, deps);

    expect(res.promptText).toContain('[Attachment x.png failed to download. URL: bad]');
    // good is still inlined (readable text ≤ maxInjectBytes).
    expect(res.promptText).toContain('Attachment ok.txt');
    expect(res.promptText).toContain('hi');
  });

  it('multiple attachments processed individually then joined', async () => {
    const a: AttachmentInput = { type: 'file', url: 'a', name: 'a.txt', mime: 'text/plain', size: 2 };
    const b: AttachmentInput = { type: 'image', url: 'b', name: 'b.png', mime: 'image/png', size: 3 };
    const deps = makeDeps({ contents: { a: { text: 'hi' }, b: { text: 'png' } } });
    const res = await ingestAttachments([a, b], CFG, deps);

    expect(res.promptText).toContain('a.txt');
    expect(res.promptText).toContain('b.png saved to');
    expect(res.files).toHaveLength(1); // only b persisted
  });
});
