/**
 * Rill Language Tests: Throttling Operators — debounce, throttle, sample
 * (Phase 2, Task 2.4)
 *
 * Covers:
 * - AC-3  / IR-4  : debounce static-clock semantics: emits only the last chunk
 * - AC-4  / IR-5  : throttle static-clock semantics: emits only the first chunk
 * - AC-5  / IR-6  : sample static-clock semantics: emits only the last chunk
 * - AC-10 / EC-10 : list input to debounce/throttle/sample raises #INVALID_INPUT
 * - AC-16 / EC-11 : non-duration argument raises #TYPE_MISMATCH
 * - AC-25         : per-operator distinct semantics documented
 * - EC-12         : iteration ceiling for debounce/throttle/sample (documented below)
 * - EC-13         : upstream halt propagation (documented below)
 *
 * [SPEC] AC-3, AC-4, AC-5, AC-25 — The spec describes these operators in terms
 * of time-domain stream behaviour (e.g. "at most one chunk per 100ms window").
 * The current implementation uses getIterableElements to materialise the input
 * synchronously with a static virtual clock (ctx.nowMs does not advance between
 * chunks). Under static-clock semantics:
 *   - debounce: all chunks share timestamp 0; the last chunk is the only one with
 *     an infinite gap to a non-existent successor, so only it passes.
 *   - throttle: all chunks share timestamp 0; only the first chunk passes through
 *     the rate gate for each interval.
 *   - sample: all chunks fall in window 0; only the last (most-recently-seen) chunk
 *     is emitted as the single sample for that window.
 * Tests assert against these static-clock outcomes. Real time-driven behaviour
 * (multiple chunks in distinct time windows) cannot be tested with the synchronous
 * getIterableElements path. (Path A — static clock limitation, Tasks 2.2/2.3.)
 *
 * [SPEC] EC-12 — The spec states the iteration ceiling (RILL_R010) is enforced
 * inside getIterableElements for debounce/throttle/sample. This cannot be
 * directly triggered in a test without passing 10,001+ elements through an
 * iterator, which is itself blocked by the same limit. A range(0, 10001) used
 * as debounce input will halt inside getIterableElements with RILL_R010 before
 * debounce logic executes. This is documented rather than separately tested;
 * the equivalent RILL_R010 behaviour is already covered in collection-operators
 * (AC-34/BC-8) and iterate.test.ts (AC-11).
 *
 * [SPEC] EC-13 — Upstream halt propagation through getIterableElements is
 * structurally guaranteed by the shared getIterableElements implementation. It
 * is not separately tested here as no unique debounce/throttle/sample-specific
 * behaviour is exercised.
 *
 * [DEVIATION] duration() supports positional args only (named args not yet
 * supported by the parser). All tests use duration(0, 0, 0, 0, 0, 0, X) for
 * X milliseconds. See packages/core/tests/language/duration.test.ts line 6.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  type RillStream,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

// ---------------------------------------------------------------------------
// Helper: host function that returns a RillStream over provided values
// ---------------------------------------------------------------------------

function makeStreamFn(chunks: RillValue[], resolution: RillValue = null) {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (const v of chunks) yield v;
        })(),
        resolve: async () => resolution,
      }),
  };
}

// ---------------------------------------------------------------------------
// AC-3 / IR-4: debounce static-clock semantics
// ---------------------------------------------------------------------------

describe('debounce: static-clock semantics (AC-3, IR-4)', () => {
  it('range(0, 5) -> debounce emits only the last element', async () => {
    // Under static-clock all chunks share timestamp 0.
    // Only the last chunk (4) has an infinite gap to its successor (no successor),
    // so only it passes the debounce gate.
    const result = await run(
      'range(0, 5) -> debounce(duration(0, 0, 0, 0, 0, 0, 50))'
    );
    expect(result).toEqual([4]);
  });

  it('single-element iterator passes through unchanged', async () => {
    const result = await run(
      'range(0, 1) -> debounce(duration(0, 0, 0, 0, 0, 0, 50))'
    );
    expect(result).toEqual([0]);
  });

  it('empty iterator returns empty list', async () => {
    const result = await run(
      'range(0, 0) -> debounce(duration(0, 0, 0, 0, 0, 0, 50))'
    );
    expect(result).toEqual([]);
  });

  it('stream input: only last chunk emitted', async () => {
    const result = await run(
      'make_stream() -> debounce(duration(0, 0, 0, 0, 0, 0, 50))',
      { functions: { make_stream: makeStreamFn([10, 20, 30]) } }
    );
    expect(result).toEqual([30]);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / IR-5: throttle static-clock semantics
// ---------------------------------------------------------------------------

describe('throttle: static-clock semantics (AC-4, IR-5)', () => {
  it('range(0, 5) -> throttle emits only the first element', async () => {
    // Under static-clock all chunks share timestamp 0.
    // The first chunk passes the gate (nextAllowedMs starts at -Infinity).
    // Subsequent chunks are blocked because timestamp 0 < nextAllowedMs.
    const result = await run(
      'range(0, 5) -> throttle(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([0]);
  });

  it('single-element iterator passes through unchanged', async () => {
    const result = await run(
      'range(0, 1) -> throttle(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([0]);
  });

  it('empty iterator returns empty list', async () => {
    const result = await run(
      'range(0, 0) -> throttle(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([]);
  });

  it('stream input: only first chunk emitted', async () => {
    const result = await run(
      'make_stream() -> throttle(duration(0, 0, 0, 0, 0, 0, 100))',
      { functions: { make_stream: makeStreamFn([10, 20, 30]) } }
    );
    expect(result).toEqual([10]);
  });
});

// ---------------------------------------------------------------------------
// AC-5 / IR-6: sample static-clock semantics
// ---------------------------------------------------------------------------

describe('sample: static-clock semantics (AC-5, IR-6)', () => {
  it('range(0, 5) -> sample emits only the last element', async () => {
    // Under static-clock all chunks fall in window 0.
    // The window's "latest seen" is the last element. One sample emitted.
    const result = await run(
      'range(0, 5) -> sample(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([4]);
  });

  it('single-element iterator passes through unchanged', async () => {
    const result = await run(
      'range(0, 1) -> sample(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([0]);
  });

  it('empty iterator returns empty list', async () => {
    const result = await run(
      'range(0, 0) -> sample(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    expect(result).toEqual([]);
  });

  it('stream input: only last chunk emitted', async () => {
    const result = await run(
      'make_stream() -> sample(duration(0, 0, 0, 0, 0, 0, 100))',
      { functions: { make_stream: makeStreamFn([10, 20, 30]) } }
    );
    expect(result).toEqual([30]);
  });
});

// ---------------------------------------------------------------------------
// AC-25: per-operator distinct semantics
// ---------------------------------------------------------------------------

describe('AC-25: per-operator distinct semantics', () => {
  it('debounce emits latest, throttle emits first, sample emits latest', async () => {
    // With a 5-element range all sharing static-clock timestamp 0:
    //   - debounce: latest = last element = 4
    //   - throttle: first-of-interval = first element = 0
    //   - sample:   latest-at-interval = last element = 4
    const debounceResult = await run(
      'range(0, 5) -> debounce(duration(0, 0, 0, 0, 0, 0, 50))'
    );
    const throttleResult = await run(
      'range(0, 5) -> throttle(duration(0, 0, 0, 0, 0, 0, 100))'
    );
    const sampleResult = await run(
      'range(0, 5) -> sample(duration(0, 0, 0, 0, 0, 0, 100))'
    );

    // debounce emits latest (last)
    expect(debounceResult).toEqual([4]);
    // throttle emits first-of-interval
    expect(throttleResult).toEqual([0]);
    // sample emits latest-at-interval (last per window)
    expect(sampleResult).toEqual([4]);

    // throttle and debounce emit different elements from the same input
    expect(throttleResult).not.toEqual(debounceResult);
    // debounce and sample agree under static-clock (both emit last)
    expect(debounceResult).toEqual(sampleResult);
  });
});

// ---------------------------------------------------------------------------
// AC-10 / EC-10: list input raises #INVALID_INPUT
// ---------------------------------------------------------------------------

describe('EC-10 / AC-10: list input raises #INVALID_INPUT', () => {
  it('debounce rejects list input', async () => {
    await expectHalt(
      () => run('list[1, 2, 3] -> debounce(duration(0, 0, 0, 0, 0, 0, 10))'),
      { code: 'INVALID_INPUT' }
    );
  });

  it('throttle rejects list input', async () => {
    await expectHalt(
      () => run('list[1, 2, 3] -> throttle(duration(0, 0, 0, 0, 0, 0, 100))'),
      { code: 'INVALID_INPUT' }
    );
  });

  it('sample rejects list input', async () => {
    await expectHalt(
      () => run('list[1, 2, 3] -> sample(duration(0, 0, 0, 0, 0, 0, 100))'),
      { code: 'INVALID_INPUT' }
    );
  });
});

// ---------------------------------------------------------------------------
// AC-16 / EC-11: non-duration argument raises a parameter type error
//
// The `dur` param on debounce/throttle/sample declares type: { kind: 'duration' }.
// The runtime validates param types at the call site before invoking the function
// body. A non-duration argument therefore triggers a call-site parameter type
// mismatch (RILL-R001 RuntimeError), not the internal throwCatchableHostHalt
// (which would produce a RuntimeHaltSignal). Both signal that the argument is
// the wrong type; the test asserts on the call-site error.
// ---------------------------------------------------------------------------

describe('EC-11 / AC-16: non-duration argument raises a parameter type error', () => {
  it('debounce with string duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> debounce("50ms")')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });

  it('debounce with numeric duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> debounce(50)')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });

  it('throttle with string duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> throttle("100ms")')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });

  it('throttle with numeric duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> throttle(100)')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });

  it('sample with string duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> sample("100ms")')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });

  it('sample with numeric duration arg raises RILL-R001', async () => {
    await expect(run('range(0, 5) -> sample(100)')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R001' })
    );
  });
});
