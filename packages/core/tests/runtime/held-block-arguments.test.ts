/**
 * Rill Runtime Tests: held blocks as call arguments
 *
 * A collection that holds a block cannot reach a host function or a
 * non-selecting built-in as a value. A whole-argument block is a function
 * and still passes.
 */

import { describe, expect, it } from 'vitest';
import type { RillValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { hostFn, hostParam } from '../helpers/host.js';

function sinkOptions(seen: RillValue[]) {
  return {
    functions: {
      sink: hostFn({
        params: [hostParam('value', { kind: 'any' })],
        fn: (args) => {
          seen.push(args['value'] ?? null);
          return 'ok';
        },
      }),
    },
  };
}

describe('held blocks as host function arguments', () => {
  it.each([
    ['a dict entry', 'sink(dict[a: { 1 }])', "'a'"],
    ['a list element', 'sink(list[{ 1 }])', 'index 0'],
    ['a nested entry', 'sink(list[dict[a: { 1 }]])', "'a'"],
  ])(
    'halts #TYPE_MISMATCH when %s holds a block',
    async (_name, src, entry) => {
      const seen: RillValue[] = [];
      await expectHalt(() => run(src, sinkOptions(seen)), {
        code: 'TYPE_MISMATCH',
        messagePattern: entry,
      });
      expect(seen).toEqual([]);
    }
  );

  it('passes a collection that holds no block', async () => {
    const seen: RillValue[] = [];
    expect(await run('sink(dict[a: 1])', sinkOptions(seen))).toBe('ok');
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('passes a whole-argument block as a function', async () => {
    const seen: RillValue[] = [];
    expect(await run('sink({ 1 })', sinkOptions(seen))).toBe('ok');
    expect(seen).toHaveLength(1);
  });

  it('passes an fn entry held in a collection', async () => {
    const seen: RillValue[] = [];
    expect(await run('sink(dict[a: fn { 1 }])', sinkOptions(seen))).toBe('ok');
    expect(seen).toHaveLength(1);
  });
});

describe('enumerate with held blocks', () => {
  it.each([
    ['a list element', 'enumerate(list[{ 1 }])', 'index 0'],
    ['a dict entry', 'enumerate(dict[a: { 1 }])', "'a'"],
  ])(
    'halts #TYPE_MISMATCH when %s holds a block',
    async (_name, src, entry) => {
      await expectHalt(() => run(src), {
        code: 'TYPE_MISMATCH',
        messagePattern: entry,
      });
    }
  );

  it('enumerates a list without blocks', async () => {
    expect(await run('enumerate(list[7])')).toEqual([{ index: 0, value: 7 }]);
  });
});
