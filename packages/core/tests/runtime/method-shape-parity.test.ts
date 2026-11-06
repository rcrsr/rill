/**
 * Methods that skip receiver validation share one signature per name, because
 * the dispatch fallback validates arguments against the first type that has
 * the name.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import type { RillFunction, TypeDefinition } from '@rcrsr/rill';
// Internal import: createRuntimeContext accepts no synthetic type registrations,
// so the assertion has no public path to test with injected tables.
import { BUILT_IN_TYPES } from '../../src/runtime/core/types/registrations.js';
import { assertSharedMethodShapes } from '../../src/runtime/core/context.js';

function method(
  paramName: string,
  skip: boolean,
  opts: { kind?: string; defaultValue?: unknown } = {}
): RillFunction {
  return {
    params: [
      { name: 'receiver', type: { kind: 'any' }, annotations: {} },
      {
        name: paramName,
        type: { kind: opts.kind ?? 'any' },
        annotations: {},
        ...(opts.defaultValue !== undefined
          ? { defaultValue: opts.defaultValue }
          : {}),
      },
    ],
    fn: () => 1,
    annotations: {},
    returnType: undefined,
    ...(skip ? { skipReceiverValidation: true } : {}),
  } as unknown as RillFunction;
}

function reg(
  name: string,
  methods: Record<string, RillFunction>
): TypeDefinition {
  return { name, methods } as unknown as TypeDefinition;
}

describe('skipReceiverValidation method signatures', () => {
  it('builds a context from the built-in tables', () => {
    expect(() => assertSharedMethodShapes(BUILT_IN_TYPES)).not.toThrow();
    expect(() => createRuntimeContext({})).not.toThrow();
  });

  it('throws when same-named skipping methods declare different parameter types', () => {
    expect(() =>
      assertSharedMethodShapes([
        reg('a', { add: method('dur', true, { kind: 'number' }) }),
        reg('b', { add: method('dur', true, { kind: 'string' }) }),
      ])
    ).toThrow(/Method 'add' on type 'b' declares/);
  });

  it('throws when same-named skipping methods differ in default presence', () => {
    expect(() =>
      assertSharedMethodShapes([
        reg('a', { add: method('dur', true) }),
        reg('b', { add: method('dur', true, { defaultValue: 1 }) }),
      ])
    ).toThrow(/Method 'add' on type 'b' declares/);
  });

  it('throws when same-named skipping methods declare different parameter names', () => {
    expect(() =>
      assertSharedMethodShapes([
        reg('a', { add: method('dur', true) }),
        reg('b', { add: method('other', true) }),
      ])
    ).toThrow(/Method 'add' on type 'b' declares/);
  });

  it('accepts same-named skipping methods with identical parameters', () => {
    expect(() =>
      assertSharedMethodShapes([
        reg('a', { add: method('dur', true) }),
        reg('b', { add: method('dur', true) }),
      ])
    ).not.toThrow();
  });

  it('ignores same-named methods that do not skip receiver validation', () => {
    expect(() =>
      assertSharedMethodShapes([
        reg('a', { add: method('dur', true) }),
        reg('b', { add: method('other', false) }),
      ])
    ).not.toThrow();
  });
});
