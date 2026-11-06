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
  getFunctions,
  isDict,
  RuntimeError,
  type RillValue,
} from '@rcrsr/rill';
import { BUILTIN_FUNCTIONS } from '../../src/runtime/ext/builtins.js';
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
    expect(names('log')).toEqual(['message', 'extra']);
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
});
