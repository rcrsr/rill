import { describe, it, expect } from 'vitest';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import { callable } from '../../../src/runtime/core/callable-factory.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';

function mockExtensions(): Map<string, RillValue> {
  const sanitize = callable({
    fn: (args) => `sanitized(${args['0']})`,
    params: [
      {
        name: '0',
        type: undefined,
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: { kind: 'string' },
  });

  const sanitizeForPrompt = callable({
    fn: (args) => `prompt_safe(${args['0']})`,
    params: [
      {
        name: '0',
        type: undefined,
        defaultValue: undefined,
        annotations: {},
      },
    ],
    returnType: { kind: 'string' },
  });

  const filterExt: RillValue = {
    sanitize: sanitize,
    sanitize_for_prompt: sanitizeForPrompt,
  } as unknown as RillValue;

  const map = new Map<string, RillValue>();
  map.set('filter', filterExt);
  return map;
}

describe('resolvePolicy', () => {
  it('resolves a simple allow rule with no transforms', () => {
    const policy = resolvePolicy(
      { kb: { search: { access: 'allow' } } },
      new Map()
    );
    const rule = policy.rules.get('kb')?.get('search');
    expect(rule).toBeDefined();
    expect(rule!.access).toBe('allow');
    expect(rule!.inTransforms).toHaveLength(0);
    expect(rule!.outTransforms).toHaveLength(0);
  });

  it('resolves a deny rule', () => {
    const policy = resolvePolicy(
      { kb: { delete: { access: 'deny' } } },
      new Map()
    );
    const rule = policy.rules.get('kb')?.get('delete');
    expect(rule!.access).toBe('deny');
  });

  it('resolves out transforms to callables', () => {
    const policy = resolvePolicy(
      { kb: { search: { access: 'allow', out: ['filter.sanitize'] } } },
      mockExtensions()
    );
    const rule = policy.rules.get('kb')?.get('search');
    expect(rule!.outTransforms).toHaveLength(1);
    expect(rule!.outTransforms[0]!.kind).toBeDefined();
  });

  it('resolves in transforms to callables', () => {
    const policy = resolvePolicy(
      {
        llm: {
          summarize: {
            access: 'allow',
            in: ['filter.sanitize_for_prompt'],
          },
        },
      },
      mockExtensions()
    );
    const rule = policy.rules.get('llm')?.get('summarize');
    expect(rule!.inTransforms).toHaveLength(1);
  });

  it('resolves wildcard as default (access-control only)', () => {
    const policy = resolvePolicy(
      { kb: { '*': { access: 'deny' }, search: { access: 'allow' } } },
      new Map()
    );
    expect(policy.defaults.get('kb')?.access).toBe('deny');
    expect(policy.rules.get('kb')?.get('search')?.access).toBe('allow');
  });

  it('throws on wildcard with transforms', () => {
    expect(() =>
      resolvePolicy(
        { kb: { '*': { access: 'deny', out: ['filter.sanitize'] } } },
        mockExtensions()
      )
    ).toThrow(/Wildcard/);
  });

  it('throws on unresolvable transform reference', () => {
    expect(() =>
      resolvePolicy(
        {
          kb: {
            search: { access: 'allow', out: ['nonexistent.method'] },
          },
        },
        new Map()
      )
    ).toThrow(/not found/);
  });

  it('throws on bad transform format', () => {
    expect(() =>
      resolvePolicy(
        { kb: { search: { access: 'allow', out: ['no_dot'] } } },
        new Map()
      )
    ).toThrow(/expected.*format/);
  });

  it('returns empty policy for empty config', () => {
    const policy = resolvePolicy({}, new Map());
    expect(policy.rules.size).toBe(0);
    expect(policy.defaults.size).toBe(0);
  });

  it('resolves multiple transforms in order', () => {
    const policy = resolvePolicy(
      {
        kb: {
          search: {
            access: 'allow',
            out: ['filter.sanitize', 'filter.sanitize_for_prompt'],
          },
        },
      },
      mockExtensions()
    );
    const rule = policy.rules.get('kb')?.get('search');
    expect(rule!.outTransforms).toHaveLength(2);
  });

  it('resolves multiple extensions independently', () => {
    const policy = resolvePolicy(
      {
        kb: { search: { access: 'allow' } },
        llm: { summarize: { access: 'allow' } },
      },
      new Map()
    );
    expect(policy.rules.get('kb')?.get('search')?.access).toBe('allow');
    expect(policy.rules.get('llm')?.get('summarize')?.access).toBe(
      'allow'
    );
  });
});