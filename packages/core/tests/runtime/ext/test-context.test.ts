/**
 * Rill Runtime Tests: createTestContext and ExtensionBindingError
 *
 * Tests for the test context factory that wires extension values into
 * a RuntimeContext with ext and module resolvers.
 *
 * Specification Mapping:
 * - AC-9: createTestContext returns context where use<ext:name.leaf> resolves
 * - AC-2: Context resolves scalar string via use<ext:name.version>
 * - AC-3: Context resolves list leaf via use<ext:name.items>
 * - AC-4: Context resolves tuple leaf via use<ext:name.args>
 * - AC-12: createRuntimeContext with Record<string, RillFunction> works (legacy)
 * - AC-20: Empty value dict {} produces [:] bindings
 * - AC-21: 3+ level nesting generates correct dot-paths
 * - AC-22: Extension with dispose closure in value dict coexists with lifecycle dispose
 * - EC-9: Extension with undefined value throws TypeError
 * - EC-10: Binding generation failure propagates ExtensionBindingError
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  callable,
  createRuntimeContext,
  createTestContext,
  createTuple,
  execute,
  ExtensionBindingError,
  parse,
  RuntimeError,
  toCallable,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';

// Helper: parse and execute a script in a given context
async function execInContext(
  source: string,
  ctx: ReturnType<typeof createTestContext>
): Promise<RillValue> {
  const ast = parse(source);
  return (await execute(ast, ctx)).result;
}

// Helper: build a typed callable from a RillFunction definition
function typedCallable(def: RillFunction): RillValue {
  return toCallable(def) as unknown as RillValue;
}

describe('createTestContext', () => {
  describe('AC-9: resolves closure leaves via use<ext:name.leaf>', () => {
    it('resolves a callable leaf through the ext resolver', async () => {
      const greetFn = typedCallable({
        params: [
          {
            name: 'name',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => `Hello, ${args['name']}!`,
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        myext: {
          value: {
            greet: greetFn,
          } as RillValue,
        },
      });

      const result = await execInContext('use<ext:myext.greet>("world")', ctx);
      expect(result).toBe('Hello, world!');
    });
  });

  describe('AC-2: resolves scalar string via use<ext:name.version>', () => {
    it('resolves a string value at a nested path', async () => {
      const ctx = createTestContext({
        myext: {
          value: {
            version: '1.2.3',
          } as RillValue,
        },
      });

      const result = await execInContext('use<ext:myext.version>', ctx);
      expect(result).toBe('1.2.3');
    });
  });

  describe('AC-3: resolves list leaf via use<ext:name.items>', () => {
    it('resolves an array value at a nested path', async () => {
      const ctx = createTestContext({
        myext: {
          value: {
            items: ['a', 'b', 'c'],
          } as RillValue,
        },
      });

      const result = await execInContext('use<ext:myext.items>', ctx);
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('AC-4: resolves tuple leaf via use<ext:name.args>', () => {
    it('resolves a tuple value at a nested path', async () => {
      const tuple = createTuple([1, 2, 3]);

      const ctx = createTestContext({
        myext: {
          value: {
            args: tuple,
          } as RillValue,
        },
      });

      const result = await execInContext('use<ext:myext.args>', ctx);
      expect(result).toEqual(tuple);
    });
  });

  describe('AC-20: empty value dict produces [:] bindings', () => {
    it('creates context from extension with empty dict value', async () => {
      const ctx = createTestContext({
        myext: {
          value: {} as RillValue,
        },
      });

      // The empty dict extension produces [:] binding; accessing via ext
      // resolver returns the empty dict itself.
      const result = await execInContext('use<ext:myext>', ctx);
      expect(result).toEqual({});
    });
  });

  describe('AC-21: 3+ level nesting generates correct dot-paths', () => {
    it('resolves deeply nested values through dot-path traversal', async () => {
      const ctx = createTestContext({
        myext: {
          value: {
            level1: {
              level2: {
                level3: 'deep-value',
              },
            },
          } as RillValue,
        },
      });

      const result = await execInContext(
        'use<ext:myext.level1.level2.level3>',
        ctx
      );
      expect(result).toBe('deep-value');
    });

    it('resolves callable at 3+ level depth', async () => {
      const deepFn = typedCallable({
        params: [],
        fn: () => 'from-deep',
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        myext: {
          value: {
            a: {
              b: {
                run: deepFn,
              },
            },
          } as RillValue,
        },
      });

      const result = await execInContext('use<ext:myext.a.b.run>()', ctx);
      expect(result).toBe('from-deep');
    });
  });

  describe('AC-22: dispose closure in value dict coexists with lifecycle dispose', () => {
    it('keeps dispose in value dict separate from lifecycle dispose', async () => {
      let lifecycleDisposed = false;
      const disposeFn = typedCallable({
        params: [],
        fn: () => 'disposed-result',
        returnType: anyTypeValue,
      });
      const runFn = typedCallable({
        params: [],
        fn: () => 'run-result',
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        myext: {
          value: {
            dispose: disposeFn,
            run: runFn,
          } as RillValue,
          dispose: () => {
            lifecycleDisposed = true;
          },
        },
      });

      // Value dict dispose is accessible as an extension function
      const disposeResult = await execInContext(
        'use<ext:myext.dispose>()',
        ctx
      );
      expect(disposeResult).toBe('disposed-result');

      // Lifecycle dispose was not triggered by accessing value dict dispose
      expect(lifecycleDisposed).toBe(false);
    });
  });

  describe('EC-9: undefined extension value throws TypeError', () => {
    it('throws TypeError with extension name in message', () => {
      expect(() =>
        createTestContext({
          badext: {
            value: undefined as unknown as RillValue,
          },
        })
      ).toThrow(TypeError);

      expect(() =>
        createTestContext({
          badext: {
            value: undefined as unknown as RillValue,
          },
        })
      ).toThrow("Extension 'badext' has undefined value");
    });
  });

  describe('EC-10: binding generation failure propagates ExtensionBindingError', () => {
    it('throws ExtensionBindingError when binding generation fails', () => {
      // callable() creates untyped callables with params=undefined.
      // The binding generator calls c.params.map() which throws on undefined.
      // This triggers the catch block that wraps errors in ExtensionBindingError.
      const untypedCallable = callable(() => null);

      expect(() =>
        createTestContext({
          broken: {
            value: untypedCallable as RillValue,
          },
        })
      ).toThrow(ExtensionBindingError);
    });

    it('has the correct code property', () => {
      const err = new ExtensionBindingError('test message');
      expect(err.code).toBe('EXTENSION_BINDING');
      expect(err.name).toBe('ExtensionBindingError');
      expect(err.message).toBe('test message');
    });

    it('is an instance of Error', () => {
      const err = new ExtensionBindingError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });
});

// ============================================================
// AC-15: use<ext:name.sub> where name is scalar throws RILL-R053
// ============================================================

describe('AC-15: traversal into scalar extension value throws RILL-R053', () => {
  it('throws RILL-R053 when dot-path traverses into a string value', async () => {
    const ctx = createTestContext({
      myext: {
        value: 'just-a-string' as RillValue,
      },
    });

    await expect(execInContext('use<ext:myext.sub>', ctx)).rejects.toThrow(
      "Member 'sub' not found in extension 'myext'"
    );
  });

  it('throws RILL-R053 when dot-path traverses into a number value', async () => {
    const ctx = createTestContext({
      myext: {
        value: 42 as RillValue,
      },
    });

    await expect(execInContext('use<ext:myext.sub>', ctx)).rejects.toThrow(
      "Member 'sub' not found in extension 'myext'"
    );
  });

  it('error is wrapped as RILL-R056 by the use<> resolver', async () => {
    const ctx = createTestContext({
      myext: {
        value: 'scalar' as RillValue,
      },
    });

    try {
      await execInContext('use<ext:myext.sub>', ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as RuntimeError).errorId).toBe('RILL-R056');
    }
  });
});

// ============================================================
// AC-16: use<ext:name.sub> where name is a list throws RILL-R053
// ============================================================

describe('AC-16: traversal into list extension value throws RILL-R053', () => {
  it('throws RILL-R053 when dot-path traverses into a list value', async () => {
    const ctx = createTestContext({
      myext: {
        value: ['a', 'b', 'c'] as RillValue,
      },
    });

    await expect(execInContext('use<ext:myext.sub>', ctx)).rejects.toThrow(
      "Member 'sub' not found in extension 'myext'"
    );
  });

  it('error is wrapped as RILL-R056 by the use<> resolver', async () => {
    const ctx = createTestContext({
      myext: {
        value: [1, 2, 3] as RillValue,
      },
    });

    try {
      await execInContext('use<ext:myext.sub>', ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as RuntimeError).errorId).toBe('RILL-R056');
    }
  });
});

// ============================================================
// AC-17: use<ext:name.nonexistent> where dict property absent
// ============================================================

describe('AC-17: traversal into missing dict property throws RILL-R053', () => {
  it('throws RILL-R053 when dict has no matching property', async () => {
    const ctx = createTestContext({
      myext: {
        value: {
          existing: 'value',
        } as RillValue,
      },
    });

    await expect(
      execInContext('use<ext:myext.nonexistent>', ctx)
    ).rejects.toThrow("Member 'nonexistent' not found in extension 'myext'");
  });

  it('error is wrapped as RILL-R056 by the use<> resolver', async () => {
    const ctx = createTestContext({
      myext: {
        value: {
          existing: 'value',
        } as RillValue,
      },
    });

    try {
      await execInContext('use<ext:myext.nonexistent>', ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as RuntimeError).errorId).toBe('RILL-R056');
    }
  });

  it('handles deeply nested missing property', async () => {
    const ctx = createTestContext({
      myext: {
        value: {
          level1: {
            level2: 'leaf',
          },
        } as RillValue,
      },
    });

    await expect(
      execInContext('use<ext:myext.level1.missing>', ctx)
    ).rejects.toThrow("Member 'level1.missing' not found in extension 'myext'");
  });
});

// ============================================================
// AC-5: Mutating dict property, subsequent resolution returns updated value
// ============================================================

describe('AC-5: extension dict mutation reflected in subsequent resolution', () => {
  it('returns updated value after dict property mutation', async () => {
    const extDict: Record<string, RillValue> = {
      version: '1.0.0' as RillValue,
    };

    const ctx = createTestContext({
      myext: {
        value: extDict as RillValue,
      },
    });

    // First resolution returns original value
    const result1 = await execInContext('use<ext:myext.version>', ctx);
    expect(result1).toBe('1.0.0');

    // Mutate the dict (host-side mutation)
    extDict['version'] = '2.0.0' as RillValue;

    // Second resolution returns updated value
    const result2 = await execInContext('use<ext:myext.version>', ctx);
    expect(result2).toBe('2.0.0');
  });

  it('returns new property added after initial registration', async () => {
    const extDict: Record<string, RillValue> = {
      original: 'yes' as RillValue,
    };

    const ctx = createTestContext({
      myext: {
        value: extDict as RillValue,
      },
    });

    // Add new property
    extDict['added'] = 'new-value' as RillValue;

    const result = await execInContext('use<ext:myext.added>', ctx);
    expect(result).toBe('new-value');
  });
});

// ============================================================
// AC-1: Nested dict with closures at leaves resolves all paths
// ============================================================

describe('AC-1: nested dict with closures at all leaves resolves via use<ext:>', () => {
  it('resolves all leaf closures in a nested dict', async () => {
    const searchFn = typedCallable({
      params: [
        {
          name: 'query',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args) => `search:${args['query']}`,
      returnType: anyTypeValue,
    });

    const upsertFn = typedCallable({
      params: [
        {
          name: 'data',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args) => `upsert:${args['data']}`,
      returnType: anyTypeValue,
    });

    const deleteFn = typedCallable({
      params: [],
      fn: () => 'deleted',
      returnType: anyTypeValue,
    });

    const ctx = createTestContext({
      db: {
        value: {
          queries: {
            search: searchFn,
          },
          mutations: {
            upsert: upsertFn,
            delete: deleteFn,
          },
        } as RillValue,
      },
    });

    const searchResult = await execInContext(
      'use<ext:db.queries.search>("test")',
      ctx
    );
    expect(searchResult).toBe('search:test');

    const upsertResult = await execInContext(
      'use<ext:db.mutations.upsert>("data")',
      ctx
    );
    expect(upsertResult).toBe('upsert:data');

    const deleteResult = await execInContext(
      'use<ext:db.mutations.delete>()',
      ctx
    );
    expect(deleteResult).toBe('deleted');
  });

  it('resolves mixed scalar and closure leaves', async () => {
    const runFn = typedCallable({
      params: [],
      fn: () => 'executed',
      returnType: anyTypeValue,
    });

    const ctx = createTestContext({
      myext: {
        value: {
          version: '1.0.0',
          config: {
            timeout: 5000,
            run: runFn,
          },
        } as RillValue,
      },
    });

    const versionResult = await execInContext('use<ext:myext.version>', ctx);
    expect(versionResult).toBe('1.0.0');

    const timeoutResult = await execInContext(
      'use<ext:myext.config.timeout>',
      ctx
    );
    expect(timeoutResult).toBe(5000);

    const runResult = await execInContext('use<ext:myext.config.run>()', ctx);
    expect(runResult).toBe('executed');
  });
});

describe('AC-12: legacy direct registration with createRuntimeContext', () => {
  it('registers functions via Record<string, RillFunction>', async () => {
    const greet: RillFunction = {
      params: [
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args) => `Hello, ${args['name']}!`,
      returnType: anyTypeValue,
    };

    const ctx = createRuntimeContext({
      functions: { greet },
    });

    const ast = parse('"world" -> greet()');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('Hello, world!');
  });

  it('registers multiple functions that work together', async () => {
    const add: RillFunction = {
      params: [
        {
          name: 'a',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'b',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args) => (args['a'] as number) + (args['b'] as number),
      returnType: anyTypeValue,
    };

    const double: RillFunction = {
      params: [
        {
          name: 'x',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args) => (args['x'] as number) * 2,
      returnType: anyTypeValue,
    };

    const ctx = createRuntimeContext({
      functions: { add, double },
    });

    const ast = parse('add(3, 4) -> double()');
    const result = await execute(ast, ctx);
    expect(result.result).toBe(14);
  });
});
