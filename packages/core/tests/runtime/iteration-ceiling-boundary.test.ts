/**
 * Rill Runtime Tests: iteration-ceiling boundary (issue #297)
 *
 * The materialising expanders (expandIterator / expandStream) stop iterating
 * once `count` reaches MAX_ITER (10,000). The overrun halt (RILL-R010) must
 * fire only when elements remain past the ceiling — i.e. the (limit+1)th
 * element — not when exactly 10,000 elements fully drain the iterator.
 *
 * Regression guard for the off-by-one that rejected exactly-10,000-element
 * sequences.
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

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('iteration ceiling boundary (issue #297)', () => {
  it('range of exactly 10000 elements expands without halting', async () => {
    const result = (await run(
      'range(0, 10000) -> seq({ $ }) -> .len'
    )) as number;
    expect(result).toBe(10000);
  });

  it('repeat of exactly 10000 elements folds without halting', async () => {
    const result = (await run(
      'repeat(1, 10000) -> fold(0, { $@ + $ })'
    )) as number;
    expect(result).toBe(10000);
  });

  it('range of 9999 elements still expands (below the ceiling)', async () => {
    const result = (await run(
      'range(0, 9999) -> seq({ $ }) -> .len'
    )) as number;
    expect(result).toBe(9999);
  });

  it('range of 10001 elements halts with RILL-R010', async () => {
    await expectHalt(() => run('range(0, 10001) -> seq({ $ })'), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });
});

/** Host function returning a fresh RillStream of `count` chunks, each 1. */
function makeCountedStreamFn(count: number): RillFunction {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (let i = 0; i < count; i++) yield 1;
        })(),
        resolve: async () => null,
      }),
  };
}

/** Host function returning a stream of `count` chunks whose values are 0..count-1. */
function makeIndexedStreamFn(count: number): RillFunction {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (let i = 0; i < count; i++) yield i;
        })(),
        resolve: async () => null,
      }),
  };
}

/**
 * Host function returning a branded stream whose every step is a value-less
 * head (`{done: false, next: ...}` with the stream head markers), forever.
 * Only an exemption limited to the walk's first step lets a walk over it
 * terminate at the ceiling.
 */
function makeEndlessValuelessStreamFn(): RillFunction {
  const makeStep = (): RillValue => {
    const step: Record<string, unknown> = {
      __rill_stream: true,
      done: false,
      next: callable(() => makeStep()),
    };
    Object.defineProperty(step, '__rill_stream_head', {
      value: true,
      enumerable: false,
    });
    Object.defineProperty(step, '__rill_stream_resolve', {
      value: async () => null,
      enumerable: false,
    });
    return step as unknown as RillValue;
  };
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: makeStep,
  };
}

const exactStream = { functions: { s: makeCountedStreamFn(10000) } };
const overStream = { functions: { s: makeCountedStreamFn(10001) } };
const indexedExactStream = { functions: { s: makeIndexedStreamFn(10000) } };
const endlessValueless = {
  functions: { endless: makeEndlessValuelessStreamFn() },
};

describe('stream ceiling boundary on host streams (issue #464)', () => {
  it('seq over exactly 10000 chunks completes', async () => {
    expect(await run('s() -> seq({ $ }) -> .len', exactStream)).toBe(10000);
  });

  it('acc over exactly 10000 chunks completes', async () => {
    expect(await run('s() -> acc(0, { $@ + $ }) -> .len', exactStream)).toBe(
      10000
    );
  });

  it('fold over exactly 10000 chunks completes', async () => {
    expect(await run('s() -> fold(0, { $@ + $ })', exactStream)).toBe(10000);
  });

  it('filter over exactly 10000 chunks completes', async () => {
    expect(
      await run(
        's() -> filter({ $ == 1 }, dict[concurrency: 100]) -> .len',
        exactStream
      )
    ).toBe(10000);
  });

  it('seq over 10001 chunks halts with RILL-R010', async () => {
    await expectHalt(() => run('s() -> seq({ $ })', overStream), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('guard does not recover the seq overrun on 10001 chunks (fatal)', async () => {
    await expectHalt(
      () =>
        run(
          `
            guard {
              s() -> seq({ $ })
            } => $r
            $r
          `,
          overStream
        ),
      { code: 'RILL_R010', hostErrorId: 'RILL-R010' }
    );
  });

  it('take(10000) over exactly 10000 chunks returns 10000 elements', async () => {
    expect(await run('s() -> take(10000) -> .len', exactStream)).toBe(10000);
  });

  it('skip(9999) over exactly 10000 chunks returns the last element', async () => {
    expect(await run('s() -> skip(9999)', indexedExactStream)).toEqual([9999]);
  });
});

describe('stream ceiling termination guard for value-less heads (issue #464)', () => {
  it('seq over an endless value-less stream halts with RILL-R010', async () => {
    await expectHalt(() => run('endless() -> seq({ $ })', endlessValueless), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('take(5) over an endless value-less stream recovers via guard as #RILL_R010', async () => {
    const result = await run(
      `
        guard {
          endless() -> take(5)
        } => $r
        $r.! ? ($r.!code == #RILL_R010) ! false
      `,
      endlessValueless
    );
    expect(result).toBe(true);
  });
});
