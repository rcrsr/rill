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
  isCallable,
  ExtensionBindingError,
  parse,
  structureToTypeValue,
  toCallable,
  type RillFunction,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';

async function execInContext(
  source: string,
  ctx: ReturnType<typeof createTestContext>
): Promise<RillValue> {
  const ast = parse(source);
  return (await execute(ast, ctx)).result;
}

function typedCallable(def: RillFunction): RillValue {
  return toCallable(def);
}

describe('createTestContext: eager-parse safety net', () => {
  it('accepts a param typed as a fn signature because it round-trips through the parser', () => {
    const higherOrderFn = typedCallable({
      params: [
        {
          name: 'cb',
          type: {
            kind: 'fn',
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
          value: { runWith: higherOrderFn },
        },
      })
    ).not.toThrow();
  });

  it('throws ExtensionBindingError synchronously for a param named after a reserved type keyword', () => {
    const keywordParamFn = typedCallable({
      params: [
        {
          name: 'number',
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
          value: { run: keywordParamFn },
        },
      })
    ).toThrow(ExtensionBindingError);
  });

  it('does not surface a later RILL-R056 for a generation defect caught eagerly', () => {
    const keywordParamFn = typedCallable({
      params: [
        {
          name: 'number',
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
          value: { run: keywordParamFn },
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
        value: 'abc-123',
      },
    });

    const result = await execInContext(
      'use<module:ext> => $m\n$m["user-id"]',
      ctx
    );
    expect(result).toBe('abc-123');
  });
});

describe('createTestContext: generated bindings round-trip', () => {
  const param = (
    name: string,
    type: TypeStructure,
    defaultValue?: RillValue
  ): RillFunction['params'][number] => ({
    name,
    type,
    defaultValue,
    annotations: {},
  });

  const fixtures: Record<string, RillFunction> = {
    typed: {
      params: [param('text', { kind: 'string' })],
      fn: () => 'x',
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    defaulted: {
      params: [param('count', { kind: 'number' }, 3)],
      fn: () => 1,
      returnType: structureToTypeValue({ kind: 'number' }),
    },
    untyped: {
      params: [],
      fn: () => null,
      returnType: anyTypeValue,
    },
    dictParam: {
      params: [
        param('options', {
          kind: 'dict',
          fields: { max: { type: { kind: 'number' }, defaultValue: 0 } },
        }),
      ],
      fn: () => 'x',
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: { content: { type: { kind: 'string' } } },
      }),
    },
    collectionParams: {
      params: [
        param('items', { kind: 'list', element: { kind: 'number' } }),
        param('mode', {
          kind: 'union',
          members: [{ kind: 'string' }, { kind: 'number' }],
        }),
      ],
      fn: () => 'x',
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    fnParam: {
      params: [
        param('cb', {
          kind: 'fn',
          params: [{ name: 'x', type: { kind: 'number' } }],
          ret: { kind: 'number' },
        }),
      ],
      fn: () => null,
      returnType: anyTypeValue,
    },
  };

  for (const [name, def] of Object.entries(fixtures)) {
    it(`runs the generated binding for the ${name} callable without a halt`, async () => {
      const ctx = createTestContext({
        myext: { value: { run: toCallable(def) } },
      });

      const result = await execInContext(
        'use<module:ext> => $m\n$m.myext.run',
        ctx
      );

      expect(isCallable(result)).toBe(true);
    });
  }
});
