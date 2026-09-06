/**
 * Rill Runtime Tests: eager-parse safety net in createTestContext
 *
 * Verifies that a binding-generation defect (a param type or name that
 * cannot round-trip through the parser) throws ExtensionBindingError
 * synchronously at createTestContext time, and that non-identifier
 * extension keys are quoted correctly and still resolve.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createTestContext,
  execute,
  ExtensionBindingError,
  parse,
  toCallable,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';

async function execInContext(
  source: string,
  ctx: ReturnType<typeof createTestContext>
): Promise<RillValue> {
  const ast = parse(source);
  return (await execute(ast, ctx)).result;
}

function typedCallable(def: RillFunction): RillValue {
  return toCallable(def) as unknown as RillValue;
}

describe('createTestContext: eager-parse safety net', () => {
  it('throws ExtensionBindingError synchronously for a param typed as a closure signature', () => {
    const higherOrderFn = typedCallable({
      params: [
        {
          name: 'cb',
          type: {
            kind: 'closure',
            params: [{ name: 'x', type: { kind: 'number' } }],
            ret: { kind: 'number' },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: () => null,
      returnType: anyTypeValue,
    });

    expect(() =>
      createTestContext({
        myext: {
          value: { runWith: higherOrderFn } as RillValue,
        },
      })
    ).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError synchronously for a param named after a reserved keyword', () => {
    const keywordParamFn = typedCallable({
      params: [
        {
          name: 'while',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: () => null,
      returnType: anyTypeValue,
    });

    expect(() =>
      createTestContext({
        myext: {
          value: { run: keywordParamFn } as RillValue,
        },
      })
    ).toThrow(ExtensionBindingError);
  });

  it('does not surface a later RILL-R056 for a generation defect caught eagerly', async () => {
    const keywordParamFn = typedCallable({
      params: [
        {
          name: 'while',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: () => null,
      returnType: anyTypeValue,
    });

    let caught: unknown;
    try {
      createTestContext({
        myext: {
          value: { run: keywordParamFn } as RillValue,
        },
      });
      expect.fail('createTestContext should have thrown');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ExtensionBindingError);
    expect((caught as ExtensionBindingError).message).not.toContain(
      'RILL-R056'
    );
  });

  it('quotes a non-identifier extension key and resolves it via use<module:ext>', async () => {
    const ctx = createTestContext({
      'user-id': {
        value: 'abc-123' as RillValue,
      },
    });

    const result = await execInContext(
      'use<module:ext> => $m\n$m.("user-id")',
      ctx
    );
    expect(result).toBe('abc-123');
  });
});
