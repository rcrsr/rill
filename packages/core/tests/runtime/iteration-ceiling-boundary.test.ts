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
    params: [],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (let i = 0; i < count; i++) yield 1;
        })(),
        resolve: () => Promise.resolve(null),
      }),
  };
}

/** Host function returning a stream of `count` chunks whose values are 0..count-1. */
function makeIndexedStreamFn(count: number): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (let i = 0; i < count; i++) yield i;
        })(),
        resolve: () => Promise.resolve(null),
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
      value: () => Promise.resolve(null),
      enumerable: false,
    });
    return step as unknown as RillValue;
  };
  return {
    params: [],
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
    expect(await run('s() -> filter({ $ == 1 }) -> .len', exactStream)).toBe(
      10000
    );
  });

  it('filter with concurrency 100 over exactly 10000 chunks completes', async () => {
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

  it('acc over 10001 chunks halts with RILL-R010', async () => {
    await expectHalt(() => run('s() -> acc(0, { $@ + $ })', overStream), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('fold over 10001 chunks halts with RILL-R010', async () => {
    await expectHalt(() => run('s() -> fold(0, { $@ + $ })', overStream), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('filter over 10001 chunks halts with RILL-R010', async () => {
    await expectHalt(() => run('s() -> filter({ $ == 1 })', overStream), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
      messagePattern: /expansion exceeded 10000 iterations/,
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

describe('repeat() count validation', () => {
  it('halts with #INVALID_INPUT for a non-integer count', async () => {
    await expectHalt(() => run('repeat(1, 1.5)'), {
      code: 'INVALID_INPUT',
      messagePattern: 'repeat: count must be an integer, got 1.5',
    });
  });

  it('guard recovers a non-integer repeat count', async () => {
    expect(await run('guard { repeat(1, 1.5) } => $r\n$r.!')).toBe(true);
  });
});

describe('in-memory collection ceiling for fan, filter, and sort', () => {
  const OVER = 10001;
  const OVER_MESSAGE = (op: string): RegExp =>
    new RegExp(`${op}: iteration exceeded 10000 iterations`);

  it.each([
    ['fan', 'range(0, 10000) -> fan({ $ }) -> .len', 10000],
    ['filter', 'range(0, 10000) -> filter({ $ >= 0 }) -> .len', 10000],
    ['sort', 'range(0, 10000) -> sort -> .len', 10000],
  ])('%s over exactly 10000 elements completes', async (_op, script, len) => {
    expect(await run(script)).toBe(len);
  });

  it.each([
    ['fan', 'fan({ $ })'],
    ['filter', 'filter({ $ >= 0 })'],
    ['sort', 'sort'],
  ])('%s over 10001 elements halts fatal RILL-R010', async (op, tail) => {
    await expectHalt(
      () => run(`list_of_items() -> ${tail}`, { functions: overList() }),
      {
        code: 'RILL_R010',
        hostErrorId: 'RILL-R010',
        messagePattern: OVER_MESSAGE(op),
      }
    );
  });

  it.each([
    ['fan', 'fan({ $ })'],
    ['filter', 'filter({ $ >= 0 })'],
    ['sort', 'sort'],
  ])('guard does not recover %s over 10001 elements', async (op, tail) => {
    await expectHalt(
      () =>
        run(`guard { list_of_items() -> ${tail} } => $r\n$r`, {
          functions: overList(),
        }),
      {
        code: 'RILL_R010',
        hostErrorId: 'RILL-R010',
        messagePattern: OVER_MESSAGE(op),
      }
    );
  });

  it('halts sort over a dict with 10001 keys', async () => {
    const dictFn: RillFunction = {
      params: [],
      returnType: anyTypeValue,
      fn: (): RillValue => {
        const entries: Record<string, RillValue> = {};
        for (let i = 0; i < OVER; i++) {
          Object.defineProperty(entries, `k${i}`, {
            value: i,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return entries;
      },
    };
    await expectHalt(
      () => run('big_dict() -> sort', { functions: { big_dict: dictFn } }),
      {
        code: 'RILL_R010',
        hostErrorId: 'RILL-R010',
        messagePattern: OVER_MESSAGE('sort'),
      }
    );
  });

  it.each([
    ['fan', 'fan({ count_call($) })'],
    ['filter', 'filter({ count_call($) })'],
  ])('%s over 10001 elements runs the body 0 times', async (_op, tail) => {
    let calls = 0;
    const functions: Record<string, RillFunction> = {
      ...overList(),
      count_call: {
        params: [
          {
            name: 'x',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        fn: (): RillValue => {
          calls++;
          return true;
        },
      },
    };
    await expectHalt(() => run(`list_of_items() -> ${tail}`, { functions }), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
    expect(calls).toBe(0);
  });

  /** Host function returning a plain list of 10001 numbers. */
  function overList(): Record<string, RillFunction> {
    return {
      list_of_items: {
        params: [],
        returnType: anyTypeValue,
        fn: (): RillValue => Array.from({ length: OVER }, (_, i) => i),
      },
    };
  }
});
