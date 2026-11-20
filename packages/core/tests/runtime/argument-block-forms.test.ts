/**
 * Rill Runtime Tests: Block arguments across call forms
 * A block passed as a whole argument converts to a function in every call
 * form; a spread argument does not convert.
 */

import { describe, expect, it } from 'vitest';
import { anyTypeValue, isCallable, type RillValue } from '@rcrsr/rill';

import { hostFn, hostParam } from '../helpers/host.js';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

const IDENTITY = 'fn(f: fn) { $f } => $id\n';

describe('Rill Runtime: Block argument call forms', () => {
  it('converts a block passed to a host call', async () => {
    const seen: RillValue[] = [];
    await run('probe({ $ + 1 })', {
      functions: {
        probe: hostFn({
          params: [hostParam('f', { kind: 'any' })],
          fn: (args) => {
            const value = args['f'];
            if (value !== undefined) seen.push(value);
            return '';
          },
          returnType: anyTypeValue,
        }),
      },
    });
    const [fn] = seen;
    expect(fn !== undefined && isCallable(fn)).toBe(true);
    if (fn !== undefined && isCallable(fn)) {
      expect(fn.params.map((p) => p.name)).toEqual(['$']);
    }
  });

  it('converts a block passed to $f({ .. })', async () => {
    expect(
      await run(`${IDENTITY}$id({ $@ + $ }) -> :fn(any, any):any`)
    ).toBeDefined();
  });

  it('converts a block passed to $d.f({ .. })', async () => {
    const script = `${IDENTITY}dict[f: $id] => $d\n$d.f({ $ + 1 }) -> :fn(any):any`;
    expect(await run(script)).toBeDefined();
  });

  it('converts a block passed through postfix invoke', async () => {
    const script = `${IDENTITY}fn() { $id } => $make
$make()({ 5 }) -> :fn():any`;
    expect(await run(script)).toBeDefined();
  });

  it('converts a block passed through pipe invoke', async () => {
    const script = `${IDENTITY}fn(x, f: fn) { $f } => $second\n1 -> $second({ $ + 1 }) -> :fn(any):any`;
    expect(await run(script)).toBeDefined();
  });

  it('does not convert a block written as a spread argument', async () => {
    const script = `${IDENTITY}$id(...{ 5 })`;
    await expectHalt(() => run(script), {
      code: 'RILL_R001',
      messagePattern: /Spread requires a tuple, dict, or ordered value/,
    });
  });
});
