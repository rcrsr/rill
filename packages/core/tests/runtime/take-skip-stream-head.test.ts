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
  callable,
  createRillStream,
  type RillFunction,
  type RillStream,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run, runWithContext } from '../helpers/runtime.js';

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
const mixedTypeStream = { functions: { s: makeStreamFn([1, 'a', 2]) } };

/**
 * Host function returning a custom iterator that never carries a `value`
 * (every step is `{done: false, value: undefined, next: ...}`, looping
 * forever). walkIteratorSteps counts raw steps taken as well as produced
 * elements, so this must halt with a catchable #RILL_R010 instead of
 * spinning forever or crashing uncatchably.
 */
function makeValuelessIterFn(): RillFunction {
  const step = (): RillValue =>
    ({
      done: false,
      value: undefined,
      next: callable(step),
    }) as unknown as RillValue;
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: step,
  };
}

const valuelessIter = { functions: { valueless_iter: makeValuelessIterFn() } };

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

describe('take/skip on a value-less custom iterator halts recoverably at MAX_ITER', () => {
  it('guard { ... take(5) } recovers the raw-step overrun as #RILL_R010', async () => {
    const result = await run(
      `
        guard {
          valueless_iter() -> take(5)
        } => $r
        $r.! ? ($r.!code == #RILL_R010) ! false
      `,
      valuelessIter
    );
    expect(result).toBe(true);
  });

  it('guard { ... skip(5) } recovers the raw-step overrun as #RILL_R010', async () => {
    const result = await run(
      `
        guard {
          valueless_iter() -> skip(5)
        } => $r
        $r.! ? ($r.!code == #RILL_R010) ! false
      `,
      valuelessIter
    );
    expect(result).toBe(true);
  });

  it('take(5) on a value-less iterator halts (not swallowed, not fatal) when unguarded', async () => {
    await expect(
      run('valueless_iter() -> take(5)', valuelessIter)
    ).rejects.toThrow(/exceeded.*step limit/);
  });
});

describe('take/skip enforce stream chunk-type homogeneity (#342)', () => {
  it('take over a mixed number/string stream halts #TYPE_MISMATCH', async () => {
    const result = await run(
      `
        guard {
          s() -> take(3)
        } => $r
        $r.! ? ($r.!code == #TYPE_MISMATCH) ! false
      `,
      mixedTypeStream
    );
    expect(result).toBe(true);
  });

  it('skip over a mixed number/string stream halts #TYPE_MISMATCH', async () => {
    const result = await run(
      `
        guard {
          s() -> skip(1)
        } => $r
        $r.! ? ($r.!code == #TYPE_MISMATCH) ! false
      `,
      mixedTypeStream
    );
    expect(result).toBe(true);
  });

  it('take over a homogeneous stream returns the expected head', async () => {
    expect(await run('s() -> take(2)', streamOf12345)).toEqual([1, 2]);
  });

  it('skip over a homogeneous stream returns the expected tail', async () => {
    expect(await run('s() -> skip(2)', streamOf12345)).toEqual([3, 4, 5]);
  });

  it('seq over the same mixed stream halts with the same #TYPE_MISMATCH', async () => {
    const result = await run(
      `
        guard {
          s() -> seq({ $ })
        } => $r
        $r.! ? ($r.!code == #TYPE_MISMATCH) ! false
      `,
      mixedTypeStream
    );
    expect(result).toBe(true);
  });
});

/** Host function returning a fresh RillStream over 5 chunks, whose dispose
 * hook increments a shared counter. createRillStream's own `disposed` guard
 * makes the hook idempotent, so any code path that calls it more than once
 * (e.g. a subsequent runtime ctx.dispose()) must not move the counter. */
function makeCountingStreamFn(counter: { count: number }): RillFunction {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (const v of [1, 2, 3, 4, 5]) yield v;
        })(),
        resolve: async () => null,
        dispose: () => {
          counter.count++;
        },
      }),
  };
}

describe('take() disposes a host stream exactly once (#391)', () => {
  it('take(1) disposes exactly once on early stop', async () => {
    const counter = { count: 0 };
    await run('s() -> take(1)', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('take(2) disposes exactly once on early stop', async () => {
    const counter = { count: 0 };
    await run('s() -> take(2)', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('take(2) -> seq({ $ }) disposes exactly once', async () => {
    const counter = { count: 0 };
    await run('s() -> take(2) -> seq({ $ })', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('take(10) beyond length disposes exactly once on full drain', async () => {
    const counter = { count: 0 };
    await run('s() -> take(10)', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('stop_when disposes exactly once (unchanged by this fix)', async () => {
    const counter = { count: 0 };
    await run('s() -> stop_when({ $ > 1 })', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('seq with an early break disposes exactly once (unchanged by this fix)', async () => {
    const counter = { count: 0 };
    await run('s() -> seq({ ($ > 2) ? break ! $ })', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
  });

  it('a subsequent ctx.dispose() does not increment the counter again', async () => {
    const counter = { count: 0 };
    const { context } = await runWithContext('s() -> take(1)', {
      functions: { s: makeCountingStreamFn(counter) },
    });
    expect(counter.count).toBe(1);
    await context.dispose();
    expect(counter.count).toBe(1);
  });
});

const emptyStream = { functions: { e: makeStreamFn([]) } };

describe('.first() and sort() on a fresh host stream (#354)', () => {
  it('.first() steps the stream once instead of routing through isDict', async () => {
    expect(await run('s() -> .first() -> .value', streamOf12345)).toBe(1);
  });

  it('.first() -> .next() steps to the second chunk', async () => {
    expect(
      await run('s() -> .first() -> .next() -> .value', streamOf12345)
    ).toBe(2);
  });

  it('.first() on an empty stream reports done', async () => {
    expect(await run('e() -> .first() -> .done', emptyStream)).toBe(true);
  });

  it('sort materializes stream chunks via the list path', async () => {
    const result = await run('s() -> sort', streamOf12345);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});
