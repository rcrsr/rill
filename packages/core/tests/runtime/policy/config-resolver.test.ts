import { describe, it, expect } from 'vitest';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import { toCallable } from '../../../src/runtime/core/callable.js';
import { anyTypeValue } from '../../../src/runtime/core/values.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';

/** A single-argument transform callable returning a tagged string. */
function transform(tag: string): RillValue {
  return toCallable({
    fn: (args) => `${tag}(${String(args['0'])})`,
    params: [
      { name: '0', type: undefined, defaultValue: undefined, annotations: {} },
    ],
    returnType: anyTypeValue,
  }) as unknown as RillValue;
}

function mockExtensions(): Map<string, RillValue> {
  const filterExt: RillValue = {
    sanitize: transform('sanitized'),
    sanitize_for_prompt: transform('prompt_safe'),
    version: '1.0',
  } as unknown as RillValue;

  return new Map<string, RillValue>([['filter', filterExt]]);
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
    expect(policy.rules.get('kb')?.get('delete')!.access).toBe('deny');
  });

  it('resolves out transforms to callables', () => {
    const policy = resolvePolicy(
      { kb: { search: { access: 'allow', out: ['filter.sanitize'] } } },
      mockExtensions()
    );
    const rule = policy.rules.get('kb')?.get('search');
    expect(rule!.outTransforms).toHaveLength(1);
    expect(rule!.outTransforms[0]!.kind).toBe('application');
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
    expect(
      policy.rules.get('llm')?.get('summarize')!.inTransforms
    ).toHaveLength(1);
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

  it('reports a malformed wildcard as a wildcard problem, not a bad reference', () => {
    // Resolving transforms before validating the wildcard would surface
    // RILL-R085 for the unresolvable reference and hide the real defect.
    expect(() =>
      resolvePolicy(
        { kb: { '*': { access: 'deny', out: ['nonexistent.method'] } } },
        new Map()
      )
    ).toThrow(/Wildcard/);
  });

  it('accepts a wildcard carrying empty transform arrays', () => {
    // `rule.in || rule.out` would treat [] as present and reject this.
    const policy = resolvePolicy(
      { kb: { '*': { access: 'deny', in: [], out: [] } } },
      new Map()
    );
    expect(policy.defaults.get('kb')?.access).toBe('deny');
  });

  it('throws on unresolvable transform reference', () => {
    expect(() =>
      resolvePolicy(
        { kb: { search: { access: 'allow', out: ['nonexistent.method'] } } },
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

  it('rejects a transform reference into a non-dict extension', () => {
    const extensions = new Map<string, RillValue>([
      ['list_ext', [1, 2, 3] as unknown as RillValue],
    ]);
    expect(() =>
      resolvePolicy(
        { kb: { search: { access: 'allow', out: ['list_ext.sanitize'] } } },
        extensions
      )
    ).toThrow(/not a dict/);
  });

  it('rejects a transform reference naming a non-callable member', () => {
    expect(() =>
      resolvePolicy(
        { kb: { search: { access: 'allow', out: ['filter.version'] } } },
        mockExtensions()
      )
    ).toThrow(/not callable/);
  });

  it('does not reach Object.prototype for inherited names', () => {
    expect(() =>
      resolvePolicy(
        { kb: { search: { access: 'allow', out: ['filter.constructor'] } } },
        mockExtensions()
      )
    ).toThrow(/not found/);
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
    expect(policy.rules.get('kb')?.get('search')!.outTransforms).toHaveLength(
      2
    );
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
    expect(policy.rules.get('llm')?.get('summarize')?.access).toBe('allow');
  });

  it('seals the resolved policy against mutation', () => {
    // The dispatch boundary reads this on every call, and host functions
    // run in the same process. Object.freeze alone leaves Map.clear live.
    const policy = resolvePolicy(
      { kb: { search: { access: 'allow' }, '*': { access: 'deny' } } },
      new Map()
    );
    const mutable = policy.rules as Map<string, unknown>;
    expect(() => mutable.clear()).toThrow(/immutable/);
    expect(() => mutable.delete('kb')).toThrow(/immutable/);
    expect(() => (policy.defaults as Map<string, unknown>).clear()).toThrow(
      /immutable/
    );

    const rule = policy.rules.get('kb')!.get('search')!;
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(rule.outTransforms)).toBe(true);
    expect(policy.rules.get('kb')?.get('search')?.access).toBe('allow');
  });
});
