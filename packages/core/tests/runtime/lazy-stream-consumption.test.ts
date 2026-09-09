/**
 * Lazy stream/iterator consumption in seq/acc.
 *
 * seq and acc drive stream and iterator inputs one raw step at a time
 * instead of materializing the whole sequence via getIterableElements up
 * front. A `break` in the body must bound how many steps are pulled from
 * an infinite source (rather than hanging or overrunning the iteration
 * ceiling), and disposal of a host stream's resources must still happen
 * exactly once.
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

/**
 * Host function returning an infinite RillStream (chunks 0, 1, 2, ...).
 * `observedChunks` records every chunk the generator actually produced, so
 * a test can assert the walker stopped pulling once the body broke instead
 * of draining forever.
 */
function makeInfiniteCountingStreamFn(
  observedChunks: number[],
  disposeCounter: { count: number }
): RillFunction {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          let n = 0;
          for (;;) {
            observedChunks.push(n);
            yield n;
            n++;
          }
        })(),
        resolve: async () => null,
        dispose: () => {
          disposeCounter.count++;
        },
      }),
  };
}

/**
 * Host function returning an infinite custom iterator ({ value, done: false,
 * next }, never done). `pullCounter` counts every step produced, i.e. every
 * time a step object is constructed (the head plus every subsequent .next()
 * call).
 */
function makeInfiniteCountingIterFn(pullCounter: {
  count: number;
}): RillFunction {
  const step = (n: number): RillValue => {
    pullCounter.count++;
    return {
      value: n,
      done: false,
      next: callable(() => step(n + 1)),
    } as unknown as RillValue;
  };
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: () => step(0),
  };
}

describe('seq lazily walks an infinite stream, bounding pulls at break (#419)', () => {
  it('break stops the walk after only the chunks the body consumed', async () => {
    const observedChunks: number[] = [];
    const disposeCounter = { count: 0 };
    const result = await run('s() -> seq({ ($ > 2) ? break ! $ })', {
      functions: {
        s: makeInfiniteCountingStreamFn(observedChunks, disposeCounter),
      },
    });

    expect(result).toEqual([0, 1, 2]);
    // Only the chunks up to and including the one that triggered break (3)
    // were ever pulled from the generator; an eager materialization would
    // never terminate.
    expect(observedChunks).toEqual([0, 1, 2, 3]);
  });

  it('disposes the host stream exactly once when break stops an infinite source', async () => {
    const observedChunks: number[] = [];
    const disposeCounter = { count: 0 };
    await run('s() -> seq({ ($ > 2) ? break ! $ })', {
      functions: {
        s: makeInfiniteCountingStreamFn(observedChunks, disposeCounter),
      },
    });

    expect(disposeCounter.count).toBe(1);
  });
});

describe('seq lazily walks an infinite iterator, bounding pulls at break (#419)', () => {
  it('break on a custom infinite iterator stops pulling further steps', async () => {
    const pullCounter = { count: 0 };
    const result = await run('it() -> seq({ ($ > 2) ? break ! $ })', {
      functions: { it: makeInfiniteCountingIterFn(pullCounter) },
    });

    expect(result).toEqual([0, 1, 2]);
    // 4 steps produced: 0, 1, 2, then 3 (which triggers break). Nowhere
    // near the 10000-step MAX_ITER ceiling an eager expandIterator would
    // have to hit before halting on a truly infinite source.
    expect(pullCounter.count).toBe(4);
  });

  it('break on an infinite cycle() bounds the number of pulls', async () => {
    const calls: number[] = [];
    const result = await run(
      `
        list[1, 2, 3] -> cycle -> seq({
          probe() => $n
          ($n >= 4) ? break ! $
        })
      `,
      {
        functions: {
          probe: {
            params: [] as { name: string; type: TypeStructure }[],
            returnType: anyTypeValue,
            fn: () => {
              calls.push(calls.length + 1);
              return calls.length;
            },
          },
        },
      }
    );

    expect(result).toEqual([1, 2, 3]);
    expect(calls.length).toBe(4);
  });
});

describe('acc disposes an infinite stream exactly once on break (#419)', () => {
  it('acc breaking early still stops pulling and disposes exactly once', async () => {
    const observedChunks: number[] = [];
    const disposeCounter = { count: 0 };
    const result = await run('s() -> acc(0, { ($ > 2) ? break ! ($@ + $) })', {
      functions: {
        s: makeInfiniteCountingStreamFn(observedChunks, disposeCounter),
      },
    });

    // acc: 0+0=0, 0+1=1, 1+2=3, then break at $==3 (>2) with no further add.
    expect(result).toEqual([0, 1, 3]);
    expect(observedChunks).toEqual([0, 1, 2, 3]);
    expect(disposeCounter.count).toBe(1);
  });

  it('a subsequent host-stream dispose call is a no-op (idempotent)', async () => {
    const observedChunks: number[] = [];
    const disposeCounter = { count: 0 };
    await run('s() -> acc(0, { ($ > 2) ? break ! ($@ + $) })', {
      functions: {
        s: makeInfiniteCountingStreamFn(observedChunks, disposeCounter),
      },
    });
    expect(disposeCounter.count).toBe(1);
  });
});
