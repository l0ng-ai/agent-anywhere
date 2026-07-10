import { describe, expect, it } from 'vitest';
import { agentCommandToSpec, buildUnionSpecs } from './daemon.js';
import type { AgentCommand } from '../types.js';

/**
 * Pure-function unit tests for agent dynamic command → platform slash registration spec.
 * Covers name validation, hint→param mapping, cross-session union dedup, and invalid-name dropping.
 */
describe('agentCommandToSpec', () => {
  it('valid name + no hint → plain spec (no options)', () => {
    expect(agentCommandToSpec({ name: 'review', description: 'Review code' })).toEqual({
      name: 'review',
      description: 'Review code',
    });
  });

  it('with hint → carries one optional string param input', () => {
    const spec = agentCommandToSpec({ name: 'create_plan', description: 'Create a plan', hint: 'Goal' });
    expect(spec).toEqual({
      name: 'create_plan',
      description: 'Create a plan',
      options: [{ name: 'input', description: 'Goal', type: 'string', required: false }],
    });
  });

  it('invalid name (uppercase/space/too long) → null', () => {
    expect(agentCommandToSpec({ name: 'Review', description: 'x' })).toBeNull();
    expect(agentCommandToSpec({ name: 'two words', description: 'x' })).toBeNull();
    expect(agentCommandToSpec({ name: 'a'.repeat(33), description: 'x' })).toBeNull();
  });

  it('empty description falls back to the command name; description and hint truncated to 100 chars', () => {
    const long = 'd'.repeat(150);
    const spec = agentCommandToSpec({ name: 'go', description: '', hint: long })!;
    expect(spec.description).toBe('go');
    expect(spec.options![0]!.description).toHaveLength(100);
  });
});

describe('buildUnionSpecs', () => {
  const c = (name: string, description = 'x'): AgentCommand => ({ name, description });

  it('union across sessions, dedup by name (first wins), non-built-ins sorted by name', () => {
    const { specs, dropped } = buildUnionSpecs([
      [c('docs', 'Docs A'), c('plan')],
      [c('docs', 'Docs B'), c('test')], // docs duplicate name → later one ignored
    ]);
    expect(specs.map((s) => s.name)).toEqual(['docs', 'plan', 'test']);
    expect(specs.find((s) => s.name === 'docs')!.description).toBe('Docs A');
    expect(dropped).toEqual([]);
  });

  it('built-in commands take priority (before all non-built-ins), each group sorted by name', () => {
    const { specs } = buildUnionSpecs([
      [c('apple'), c('usage'), c('banana'), c('context'), c('model')],
    ]);
    // built-ins (context/model/usage) first in alphabetical order; non-built-ins (apple/banana) after.
    expect(specs.map((s) => s.name)).toEqual(['context', 'model', 'usage', 'apple', 'banana']);
  });

  it('invalid names are collected into dropped, not silently swallowed', () => {
    const { specs, dropped } = buildUnionSpecs([[c('ok'), c('Bad Name')]]);
    expect(specs.map((s) => s.name)).toEqual(['ok']);
    expect(dropped).toEqual(['Bad Name']);
  });

  it('empty input → empty union', () => {
    expect(buildUnionSpecs([])).toEqual({ specs: [], dropped: [] });
  });
});
