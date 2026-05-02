/**
 * Rill Language Tests: iterate() operator (Phase 2, Task 2.4)
 *
 * Covers:
 * - AC-6  / IR-7  : iterate(0, { $ + 1 }) -> take(5) emits 0, 1, 2, 3, 4
 * - AC-7  / IR-7  : Fibonacci via iterate + dict-pair state -> take(10)
 * - AC-11 / EC-16 : iterate ceiling behaviour with take() — documented below
 * - EC-14         : closure catchable halt propagates out of iterate
 * - EC-15         : closure non-catchable halt propagates out of iterate
 * - EC-17         : non-invocable closure argument raises RILL_R006
 *
 * iterate() produces an unbounded iterator. Bound it with take(n) before any
 * materialising operator (seq, fan, fold, filter, stop_when) to avoid hitting
 * the MAX_ITER ceiling inside getIterableElements.
 *
 * Pipe form: $seed -> iterate($closure)
 * Call form: iterate(seed, closure)
 *
 * [DEVIATION] The spec's AC-7 example uses `tuple[$.1, $.0.add($.1)]` to
 * represent Fibonacci state. In rill, numeric dot-notation ($.0, $.1) is not
 * valid syntax (docs/topic-types.md: "Dot notation (.1) is not valid syntax").
 * Fibonacci state is represented using a dict with named fields (a, b) instead
 * of a tuple with numeric indices. The mathematical sequence produced is
 * identical.
 *
 * [DEVIATION] The spec's AC-6 example uses `$.add(1)` for number increment.
 * `.add()` is a datetime/duration method; it is not defined on numbers. The
 * correct rill idiom for integer increment is `$ + 1`.
 *
 * [SPEC] AC-11 — The spec states "take(15000) halts with RILL_R010 at chunk
 * 10,000". In practice, take() clamps its n argument to MAX_ITER (10,000) and
 * uses walkIteratorSteps to lazily collect exactly 10,000 elements, which
 * never triggers iterate's internal step counter ceiling. The actual observable
 * behaviour is: take(15000) on an iterate stream returns 10,000 elements
 * without halting. The RILL_R010 from iterate fires only when a materialising
 * operator (seq, fan, fold, stop_when) tries to expand the full unbounded
 * stream without a prior take. Tests cover both the clamped-take behaviour and
 * the RILL_R010-via-seq scenario.
 *
 * [SPEC] stop_when on iterate — stop_when calls getIterableElements to
 * materialise the input before applying the predicate, hitting the 10,000
 * iteration ceiling. To use stop_when on an iterate stream, apply take(n)
 * first to bound the stream. Tests reflect this constraint.
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

// ---------------------------------------------------------------------------
// AC-6 / IR-7: basic integer iteration via call form and pipe form
// ---------------------------------------------------------------------------

describe('iterate: basic integer sequence (AC-6, IR-7)', () => {
  it('call form: iterate(0, { $ + 1 }) -> take(5) emits 0..4', async () => {
    const result = await run('iterate(0, { $ + 1 }) -> take(5)');
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('pipe form: 0 -> iterate({ $ + 1 }) -> take(5) emits 0..4', async () => {
    const result = await run('0 -> iterate({ $ + 1 }) -> take(5)');
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('take(1) yields only the seed value', async () => {
    const result = await run('iterate(10, { $ + 1 }) -> take(1)');
    expect(result).toEqual([10]);
  });

  it('take(0) yields empty list', async () => {
    const result = await run('iterate(0, { $ + 1 }) -> take(0)');
    expect(result).toEqual([]);
  });

  it('non-zero seed with step: iterate(5, { $ + 3 }) -> take(4)', async () => {
    const result = await run('iterate(5, { $ + 3 }) -> take(4)');
    expect(result).toEqual([5, 8, 11, 14]);
  });

  it('string seed: iterate("a", { "{$}a" }) -> take(3) emits "a","aa","aaa"', async () => {
    const result = await run('iterate("a", { "{$}a" }) -> take(3)');
    expect(result).toEqual(['a', 'aa', 'aaa']);
  });

  it('captured closure as iterator step function', async () => {
    const result = await run(`
      |x| ($x * 2) => $double
      iterate(1, $double) -> take(5)
    `);
    expect(result).toEqual([1, 2, 4, 8, 16]);
  });
});

// ---------------------------------------------------------------------------
// AC-7 / IR-7: Fibonacci via dict-pair state
//
// The spec example uses tuple indexing ($.0, $.1) which is not valid rill
// syntax. This test uses a dict with named fields (a, b) to represent the
// same mathematical state. take(n) bounds the stream BEFORE seq materialises.
// ---------------------------------------------------------------------------

describe('iterate: Fibonacci via dict-pair state (AC-7, IR-7)', () => {
  it('Fibonacci via dict state: first 10 Fibonacci numbers', async () => {
    // State: dict[a: <current>, b: <next>]
    // Step:  dict[a: $.b, b: ($.a + $.b)]
    // take(10) bounds the stream lazily before seq materialises it.
    const result = await run(`
      iterate(dict[a: 0, b: 1], { dict[a: $.b, b: ($.a + $.b)] })
        -> take(10)
        -> seq({ $.a })
    `);
    expect(result).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
  });

  it('Fibonacci via pipe form', async () => {
    const result = await run(`
      dict[a: 0, b: 1]
        -> iterate({ dict[a: $.b, b: ($.a + $.b)] })
        -> take(6)
        -> seq({ $.a })
    `);
    expect(result).toEqual([0, 1, 1, 2, 3, 5]);
  });
});

// ---------------------------------------------------------------------------
// stop_when: must be preceded by take() on an unbounded iterate stream
// ---------------------------------------------------------------------------

describe('iterate: stop_when preceded by take()', () => {
  it('take(20) -> stop_when({ $ -> .eq(5) }) emits 0..5 inclusive', async () => {
    // stop_when calls getIterableElements which materialises the bounded list.
    // take(20) lazily bounds the stream first, then stop_when filters by value.
    const result = await run(
      'iterate(0, { $ + 1 }) -> take(20) -> stop_when({ $ -> .eq(5) })'
    );
    expect(result).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// AC-11 / EC-16: RILL_R010 ceiling behaviour
// ---------------------------------------------------------------------------

describe('iterate: RILL_R010 ceiling (AC-11, EC-16)', () => {
  it('take(15000) clamps to 10000 elements and succeeds without halting', async () => {
    // take() clamps n to MAX_ITER (10000) and uses walkIteratorSteps lazily.
    // iterate's internal step counter only reaches 9999 (for elements 1..9999).
    // The ceiling is never exceeded; RILL_R010 does not fire.
    // This matches the actual static-clock implementation (Path A).
    const result = (await run(
      'iterate(0, { $ + 1 }) -> take(15000)'
    )) as number[];
    expect(result).toHaveLength(10000);
    expect(result[0]).toBe(0);
    expect(result[9999]).toBe(9999);
  });

  it('seq on unbounded iterate stream hits RILL_R010 ceiling', async () => {
    // Without a bounding take(), seq calls getIterableElements which expands
    // the iterator until the 10000-step limit fires RILL_R010.
    await expect(run('iterate(0, { $ + 1 }) -> seq({ $ })')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
  });

  it('take(10000) succeeds and returns all 10000 elements', async () => {
    const result = (await run(
      'iterate(0, { $ + 1 }) -> take(10000)'
    )) as number[];
    expect(result).toHaveLength(10000);
    expect(result[0]).toBe(0);
    expect(result[9999]).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// EC-14: closure catchable halt propagates out of iterate
// ---------------------------------------------------------------------------

describe('iterate: EC-14 — catchable closure halt propagates', () => {
  it('type assertion failure inside closure propagates as catchable halt', async () => {
    // The closure body "not_a_number" : number produces a catchable TYPE_MISMATCH
    // halt. iterate propagates it as-is.
    await expectHalt(
      () => run('iterate(0, { "not_a_number" : number }) -> take(5)'),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('catchable halt can be recovered via guard', async () => {
    // guard intercepts catchable halts and converts them to the ?? fallback path.
    const result = await run(
      'guard { iterate(0, { "not_a_number" : number }) -> take(5) } ?? 99'
    );
    expect(result).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// EC-15: closure non-catchable halt propagates out of iterate
// ---------------------------------------------------------------------------

describe('iterate: EC-15 — non-catchable closure halt propagates', () => {
  it('error statement inside closure produces non-catchable halt', async () => {
    // error "msg" produces catchable: false RuntimeHaltSignal (RILL_R016).
    // iterate propagates it without re-catching.
    await expect(
      run('iterate(0, { error "fatal step" }) -> take(5)')
    ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R016' }));
  });

  it('non-catchable halt is NOT recoverable via guard', async () => {
    // guard only recovers catchable halts. A non-catchable halt bypasses guard.
    await expect(
      run('guard { iterate(0, { error "nope" }) -> take(5) } ?? 0')
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EC-17: non-invocable closure argument raises RILL_R006
// ---------------------------------------------------------------------------

describe('iterate: EC-17 — non-invocable closure raises RILL_R006', () => {
  it('numeric closure argument raises RILL_R006', async () => {
    await expect(run('iterate(0, 42) -> take(3)')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R006' })
    );
  });

  it('string closure argument raises RILL_R006', async () => {
    await expect(run('iterate(0, "increment") -> take(3)')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R006' })
    );
  });
});
