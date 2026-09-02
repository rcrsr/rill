/**
 * take() / skip() head-step counting on host streams and stream closures.
 *
 * A stream from createRillStream begins with a value-less "pending" head step
 * (done:false, no `value`); the first .next pulls the first chunk. walkIteratorSteps
 * must not count that head step as a produced element, or take() returns one chunk
 * short and skip() keeps one too many. Iterators (range/cycle) carry a value in their
 * head step and must stay correct.
 */

import {
  anyTypeValue,
  createRillStream,
  type RillFunction,
  type RillStream,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

/** Host function returning a fresh RillStream over the given chunks. */
function makeStreamFn(chunks: RillValue[]): RillFunction {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (const v of chunks) yield v;
        })(),
        resolve: async () => null,
      }),
  };
}

const streamOf12345 = { functions: { s: makeStreamFn([1, 2, 3, 4, 5]) } };

describe('take/skip head-step counting on host streams (#274)', () => {
  it('take(2) yields the first two chunks', async () => {
    expect(await run('s() -> take(2)', streamOf12345)).toEqual([1, 2]);
  });

  it('take(1) yields the first chunk', async () => {
    expect(await run('s() -> take(1)', streamOf12345)).toEqual([1]);
  });

  it('skip(2) drops the first two chunks', async () => {
    expect(await run('s() -> skip(2)', streamOf12345)).toEqual([3, 4, 5]);
  });

  it('skip(5) drops all chunks, yielding []', async () => {
    expect(await run('s() -> skip(5)', streamOf12345)).toEqual([]);
  });

  it('take(5) yields every chunk', async () => {
    expect(await run('s() -> take(5)', streamOf12345)).toEqual([1, 2, 3, 4, 5]);
  });

  it('take(9) beyond length yields every chunk', async () => {
    expect(await run('s() -> take(9)', streamOf12345)).toEqual([1, 2, 3, 4, 5]);
  });

  it('skip(0) yields every chunk', async () => {
    expect(await run('s() -> skip(0)', streamOf12345)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('take/skip on stream closures (#274)', () => {
  it('take(2) on a :stream(number) closure yields the first two chunks', async () => {
    const result = await run(
      `
        || {
          1 -> yield
          2 -> yield
          3 -> yield
        } :stream(number) => $gen
        $gen() -> take(2)
      `
    );
    expect(result).toEqual([1, 2]);
  });

  it('skip(1) on a :stream(number) closure drops the first chunk', async () => {
    const result = await run(
      `
        || {
          1 -> yield
          2 -> yield
          3 -> yield
        } :stream(number) => $gen
        $gen() -> skip(1)
      `
    );
    expect(result).toEqual([2, 3]);
  });
});

describe('take/skip on iterators stay correct (#274 regression guard)', () => {
  it('range(0,5) -> take(2) yields [0,1]', async () => {
    expect(await run('range(0, 5) -> take(2)')).toEqual([0, 1]);
  });

  it('range(0,5) -> skip(2) yields [2,3,4]', async () => {
    expect(await run('range(0, 5) -> skip(2)')).toEqual([2, 3, 4]);
  });

  it('list[1,2] -> cycle -> take(4) yields [1,2,1,2]', async () => {
    expect(await run('list[1, 2] -> cycle -> take(4)')).toEqual([1, 2, 1, 2]);
  });
});
