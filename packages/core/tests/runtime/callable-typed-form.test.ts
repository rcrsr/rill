/**
 * Rill Runtime Tests: typed-only callable form
 *
 * Every callable carries a real params declaration and receives its
 * arguments as a name-keyed record.
 */

import { describe, expect, it } from 'vitest';
import {
  callable,
  createRuntimeContext,
  generateManifest,
  getFunctions,
  inferStructure,
  isDict,
  structureMatches,
  anyTypeValue,
  RuntimeError,
  RuntimeHaltSignal,
  type RillFunction,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { BUILTIN_FUNCTIONS } from '../../src/runtime/ext/builtins.js';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: typed-only callable form', () => {
  it('halts with an excess-arguments error when a zero-param callable receives an argument', async () => {
    let caught: unknown;
    try {
      await run('$fn("x")', { variables: { fn: callable(() => 1) } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R045');
  });

  it('delivers a record with the bound dict as self to a property-style callable', async () => {
    let received: unknown;
    const prop = callable((args) => {
      received = args;
      return 'ok';
    }, true);

    await run('$obj.name', {
      variables: { obj: { first: 'a', name: prop } },
    });

    expect(Array.isArray(received)).toBe(false);
    const record = received as Record<string, RillValue>;
    const self = record['self'];
    expect(isDict(self ?? null)).toBe(true);
    expect((self as Record<string, RillValue>)['first']).toBe('a');
  });

  it('registers every built-in with the params declared in the built-in table', () => {
    const ctx = createRuntimeContext();
    for (const [name, entry] of Object.entries(BUILTIN_FUNCTIONS)) {
      expect(ctx.functions.get(name)?.params, name).toEqual(entry.params);
    }
  });

  it('reports chain, iterate, and log parameter names in declaration order', () => {
    const metadata = getFunctions(createRuntimeContext());
    const names = (fn: string): string[] =>
      (metadata.find((m) => m.name === fn)?.params ?? []).map((p) => p.name);

    expect(names('chain')).toEqual(['value', 'transform']);
    expect(names('iterate')).toEqual(['seed', 'closure']);
    expect(names('log')).toEqual(['message']);
  });

  it('rejects a bare function in the functions map at compile time', () => {
    const ctx = createRuntimeContext();
    // @ts-expect-error a bare function is not an ApplicationCallable
    ctx.functions.set('x', () => null);
    expect(ctx.functions.has('x')).toBe(true);
  });

  it('binds a spread tuple into chain and returns the transformed value', async () => {
    const result = await run('|x| ($x * 2) => $f\ntuple[5, $f] -> chain(...)');
    expect(result).toBe(10);
  });

  describe('property-style callables used as pipe and dispatch targets', () => {
    const makeDict = (): {
      dict: Record<string, RillValue>;
      calls: Record<string, RillValue>[];
    } => {
      const calls: Record<string, RillValue>[] = [];
      const prop = callable((args) => {
        calls.push(args);
        return 'ok';
      }, true);
      return { dict: { first: 'a', name: prop }, calls };
    };

    const expectSelfIsBoundDict = (
      calls: Record<string, RillValue>[]
    ): void => {
      expect(calls).toHaveLength(1);
      const self = calls[0]?.['self'];
      expect(isDict(self ?? null)).toBe(true);
      expect((self as Record<string, RillValue>)['first']).toBe('a');
    };

    it('binds the dict as self when a string key dispatches to a property-style callable', async () => {
      const { dict, calls } = makeDict();
      await run('"name" -> $d', { variables: { d: dict } });
      expectSelfIsBoundDict(calls);
    });

    it('binds the dict as self when a list path dispatches to a property-style callable', async () => {
      const { dict, calls } = makeDict();
      await run('list["name"] -> $d', { variables: { d: dict } });
      expectSelfIsBoundDict(calls);
    });

    it('binds the dict as self when a piped value calls a property-style callable with parens', async () => {
      const { dict, calls } = makeDict();
      await run('5 -> $d.name()', { variables: { d: dict } });
      expectSelfIsBoundDict(calls);
    });

    it('binds the dict as self for plain property access and call', async () => {
      const first = makeDict();
      await run('$d.name', { variables: { d: first.dict } });
      expectSelfIsBoundDict(first.calls);

      const second = makeDict();
      await run('$d.name()', { variables: { d: second.dict } });
      expectSelfIsBoundDict(second.calls);
    });
  });

  it('lists a host function that overrides a built-in name as a host function', () => {
    const hostLog = callable(() => 'host');
    const ctx = createRuntimeContext({ functions: { log: hostLog } });
    const metadata = getFunctions(ctx);
    const names = metadata.map((m) => m.name);
    expect(names.filter((n) => n === 'log')).toHaveLength(1);
    expect(metadata.find((m) => m.name === 'log')?.params).toEqual([]);
    // Host functions are listed before every built-in, so an overriding host
    // function is first; a built-in classification would place it after
    // earlier built-ins such as identity.
    expect(names.indexOf('log')).toBe(0);
    expect(names).toContain('chain');
  });

  it('includes a host function that overrides a built-in name in the manifest', () => {
    const hostLog = callable(() => 'host');
    const ctx = createRuntimeContext({ functions: { log: hostLog } });
    expect(generateManifest(ctx)).toContain('"log"');
  });

  describe('callable without a parameter declaration', () => {
    const undeclared = {
      __type: 'callable',
      kind: 'application',
      isProperty: false,
      fn: () => 'x',
    } as unknown as RillValue;
    const pattern = /'\$f'.*toCallable or callable\(\)/;

    it('halts with a host-contract atom when called directly', async () => {
      await expectHalt(() => run('$f(1)', { variables: { f: undeclared } }), {
        code: 'RILL_R085',
        messagePattern: pattern,
      });
    });

    it('halts with a host-contract atom when called through a pipe', async () => {
      await expectHalt(() => run('1 -> $f', { variables: { f: undeclared } }), {
        code: 'RILL_R085',
        messagePattern: pattern,
      });
    });

    it.each([
      ['a pipe into a call', '1 -> $f()'],
      ['a spread call', '$f(...list[1])'],
      ['dict dispatch', '"a" -> dict[a: $f]'],
      ['a dispatch literal', 'dict[a: $f] => $d\n"a" -> $d'],
      ['.params access', '$f.params'],
      ['.^input reflection', '$f.^input'],
    ])('halts with a host-contract atom for %s', async (_label, source) => {
      await expectHalt(() => run(source, { variables: { f: undeclared } }), {
        code: 'RILL_R085',
        messagePattern:
          /Host function '[^']+' has no parameter declaration.*toCallable or callable\(\)/,
      });
    });

    const undeclaredTyped = {
      __type: 'callable',
      kind: 'application',
      isProperty: false,
      fn: () => 'x',
      returnType: anyTypeValue,
    } as unknown as RillValue;
    it('halts when a closure type check reads its params', () => {
      const closureType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      expect(() => structureMatches(undeclaredTyped, closureType)).toThrow(
        /has no parameter declaration/
      );
    });

    it('halts when type inference reads its params', () => {
      expect(() => inferStructure(undeclaredTyped)).toThrow(
        /has no parameter declaration/
      );
    });

    it('halts from createRuntimeContext when a functions entry lacks params', () => {
      const bad = { fn: () => 'x', annotations: {} } as unknown as RillFunction;
      expect(() => createRuntimeContext({ functions: { bad } })).toThrow(
        /Host function 'bad' has no parameter declaration.*toCallable or callable\(\)/
      );
      expect(() => createRuntimeContext({ functions: { bad } })).toThrow(
        expect.objectContaining({ errorId: 'RILL-R085' })
      );
    });

    it('throws a RuntimeError, not a halt, from createRuntimeContext setup', () => {
      const bad = { fn: () => 'x', annotations: {} } as unknown as RillFunction;
      let caught: unknown;
      try {
        createRuntimeContext({ functions: { bad } });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect(caught).not.toBeInstanceOf(RuntimeHaltSignal);
    });

    it('omits a params-less function from getFunctions instead of halting', () => {
      const ctx = createRuntimeContext();
      ctx.functions.set('broken', undeclared as never);
      const names = getFunctions(ctx).map((m) => m.name);
      expect(names).not.toContain('broken');
      expect(names).toContain('log');
    });

    it('leaves a callable built with callable() unaffected', async () => {
      const result = await run('$f()', {
        variables: { f: callable(() => 'ok') },
      });
      expect(result).toBe('ok');
    });
  });
});
