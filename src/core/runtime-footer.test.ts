import { describe, it, expect } from 'vitest';
import { formatRuntimeFooter, type FooterField } from './runtime-footer.js';

describe('formatRuntimeFooter', () => {
  it('all three fields present: renders in model/contextPct/cwd order', () => {
    const fields: FooterField[] = ['model', 'contextPct', 'cwd'];
    const out = formatRuntimeFooter(
      {
        model: 'anthropic/claude-opus-4-8',
        contextTokens: 4500,
        contextLength: 10000,
        cwd: '/Users/x/proj',
        homeDir: '/Users/x',
      },
      fields,
    );
    expect(out).toBe('claude-opus-4-8 · 45% · ~/proj');
  });

  it('field order follows the input argument', () => {
    const input = {
      model: 'anthropic/claude-opus-4-8',
      contextTokens: 4500,
      contextLength: 10000,
      cwd: '/Users/x/proj',
      homeDir: '/Users/x',
    };
    expect(formatRuntimeFooter(input, ['cwd', 'model'])).toBe('~/proj · claude-opus-4-8');
    expect(formatRuntimeFooter(input, ['contextPct', 'cwd', 'model'])).toBe(
      '45% · ~/proj · claude-opus-4-8',
    );
  });

  it('missing contextLength → skips the percentage', () => {
    const out = formatRuntimeFooter(
      { model: 'claude-opus-4-8', contextTokens: 4500 },
      ['model', 'contextPct'],
    );
    expect(out).toBe('claude-opus-4-8');
  });

  it('model without `/` uses the value as-is', () => {
    const out = formatRuntimeFooter({ model: 'gpt-4-turbo' }, ['model']);
    expect(out).toBe('gpt-4-turbo');
  });

  it('cwd not under home is not replaced', () => {
    const out = formatRuntimeFooter(
      { cwd: '/var/www/app', homeDir: '/Users/x' },
      ['cwd'],
    );
    expect(out).toBe('/var/www/app');
  });

  it('all empty → empty string', () => {
    expect(formatRuntimeFooter({}, ['model', 'contextPct', 'cwd'])).toBe('');
    expect(formatRuntimeFooter({}, [])).toBe('');
  });

  it('percentage clamp: tokens>length → 100%', () => {
    const out = formatRuntimeFooter(
      { contextTokens: 20000, contextLength: 10000 },
      ['contextPct'],
    );
    expect(out).toBe('100%');
  });

  it('percentage clamp lower bound: tokens=0 → 0%', () => {
    const out = formatRuntimeFooter(
      { contextTokens: 0, contextLength: 10000 },
      ['contextPct'],
    );
    expect(out).toBe('0%');
  });

  it('cwd exactly equals homeDir → ~', () => {
    const out = formatRuntimeFooter(
      { cwd: '/Users/x', homeDir: '/Users/x' },
      ['cwd'],
    );
    expect(out).toBe('~');
  });
});
