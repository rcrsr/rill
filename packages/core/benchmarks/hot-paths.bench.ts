/**
 * Rill Hot Path Benchmarks
 *
 * Captures timings for acceptance criteria tied to NFR-ERR-1 through
 * NFR-ERR-3 and NFR-LOOP-1 / NFR-LOOP-2:
 *
 * | Bench ID    | Criterion                                               |
 * | AC-N1       | Arithmetic hot loop regression < 2%                     |
 * | AC-N2       | `list -> map` iteration regression < 2%                 |
 * | AC-N3       | `.!code` probe on valid value: 0 heap allocations after |
 * |             | 100-iter warm-up (measured in `allocations.ts`)         |
 * | AC-N4       | N-deep guard nesting appends N frames w/ O(1) per      |
 * |             | append                                                   |
 * | AC-B5       | 10,000-frame trace; `.!` on valid is O(1)               |
 * | AC-NOD-21   | Loop-parsing cases: ≤2% regression (NFR-LOOP-1)        |
 * | AC-NOD-22   | Tokenizer keyword-table lookup: no regression           |
 * |             | (NFR-LOOP-2)                                             |
 *
 * This file uses vitest's `bench()` API. Invocation: `pnpm bench` (see
 * package.json). Allocation-specific measurement for AC-N3 lives in the
 * sibling script `allocations.ts`, which `pnpm bench` executes after the
 * timing suite completes.
 *
 * NOTES:
 * - Baselines captured on the error-handling branch (mid-initiative). The
 *   `< 2% regression vs main` acceptance is deferred to Phase 5 task 5.2,
 *   which re-runs this suite after the contract lands. Current runs
 *   simply have to complete without error and print usable timings.
 * - Benchmarks use the public `@rcrsr/rill` entry point where possible.
 *   AC-N4 and AC-B5 require direct access to the status / trace helpers,
 *   which are not yet in the public API (Phase 3 work); we import them
 *   from the internal barrel as a benchmark-only concession.
 * - Loop benchmarks (AC-NOD-21, AC-NOD-22) use keyword syntax introduced
 *   in the loop-syntax-unification initiative:
 *     while (cond) do { body }
 *     do { body } while (cond)
 *     do<limit: N> { body } while (cond)
 *   No legacy `(cond) @ {`, `@ { } ?`, or `^(limit: N) @` patterns exist
 *   in this file (they were never present; no migration was required).
 */

import { bench, describe } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import {
  appendTraceFrame,
  getStatus,
  invalidate,
  isInvalid,
} from '../src/runtime/core/types/status.js';
import { createTraceFrame } from '../src/runtime/core/types/trace.js';

// ============================================================
// SHARED SETUP HELPERS
// ============================================================

/** Parse once, execute many: reuses AST across a bench iteration set. */
async function runCached(ast: ReturnType<typeof parse>): Promise<RillValue> {
  const ctx = createRuntimeContext({});
  const result = await execute(ast, ctx);
  return result.result;
}

// ============================================================
// AC-N1: ARITHMETIC HOT LOOP
// ============================================================

describe('AC-N1: arithmetic hot loop', () => {
  // 500-iteration fold: $acc + $x on list[0..499]. Exercises the
  // arithmetic + pipe + capture hot path.
  const SOURCE = `list[${Array.from({ length: 500 }, (_, i) => i).join(', ')}] -> fold(0) { $@ + $ }`;
  const ast = parse(SOURCE);

  bench('fold 500-element arithmetic sum', async () => {
    await runCached(ast);
  });
});

// ============================================================
// AC-N2: LIST -> MAP ITERATION
// ============================================================

describe('AC-N2: list -> map iteration', () => {
  // 1000-element list -> map { $ + 1 }. Exercises the collection iteration
  // hot path (closure invocation per element + list construction).
  const ELEMENTS = Array.from({ length: 1000 }, (_, i) => i).join(', ');
  const SOURCE = `list[${ELEMENTS}] -> map { $ + 1 }`;
  const ast = parse(SOURCE);

  bench('map over 1000-element list with { $ + 1 }', async () => {
    await runCached(ast);
  });
});

// ============================================================
// AC-N3: `.!code` PROBE ON VALID
// ============================================================

describe('AC-N3: .!code probe on valid value', () => {
  // Timing-side measurement. The allocation-side measurement (which is
  // the actual AC-N3 gate) lives in allocations.ts so that we can force
  // GCs and compare heapUsed deltas cleanly.
  const SOURCE = '"hello".!code';
  const ast = parse(SOURCE);

  bench('.!code on a valid string (timing)', async () => {
    await runCached(ast);
  });
});

// ============================================================
// AC-N4: N-DEEP GUARD FRAME APPEND (O(1) PER APPEND)
// ============================================================

describe('AC-N4: appendTraceFrame append cost', () => {
  // AC-N4 asserts no prior-frame copy per append. We verify the cost
  // profile by appending frames to a growing chain and checking that the
  // per-iteration timing does not grow with N (Phase 5 task 5.2 compares
  // slopes). Two cases capture the shape.
  const frame = createTraceFrame({
    site: 'bench:0',
    kind: 'guard-caught',
    fn: 'bench',
  });

  // Seed: invalidate a base value to carry a populated sidecar.
  function seedInvalid(): RillValue {
    return invalidate(
      {} as RillValue,
      { code: 'R001', provider: 'bench' },
      frame
    );
  }

  bench('append 100 trace frames', () => {
    let v = seedInvalid();
    for (let i = 0; i < 100; i++) {
      v = appendTraceFrame(v, frame);
    }
  });

  bench('append 1000 trace frames', () => {
    let v = seedInvalid();
    for (let i = 0; i < 1000; i++) {
      v = appendTraceFrame(v, frame);
    }
  });
});

// ============================================================
// AC-B5: 10,000-FRAME TRACE, `.!` ON VALID IS O(1)
// ============================================================

describe('AC-B5: large-trace validity probe', () => {
  // Build a 10k-frame invalid once, then measure `.!` (isInvalid) and
  // `.!code` (getStatus) access cost against it. `isInvalid` on a VALID
  // value touches only the frozen empty-status singleton, so its cost
  // must be independent of any adjacent 10k-frame invalid.
  const seedFrame = createTraceFrame({
    site: 'bench:0',
    kind: 'guard-caught',
    fn: 'bench',
  });
  let bigInvalid: RillValue = invalidate(
    {} as RillValue,
    { code: 'R001', provider: 'bench' },
    seedFrame
  );
  for (let i = 0; i < 10_000; i++) {
    bigInvalid = appendTraceFrame(bigInvalid, seedFrame);
  }

  const validValue: RillValue = 'hello' as RillValue;

  bench('isInvalid on valid value (empty-status singleton)', () => {
    isInvalid(validValue);
  });

  bench('isInvalid on 10k-frame invalid value', () => {
    isInvalid(bigInvalid);
  });

  bench('getStatus().code on valid value', () => {
    void getStatus(validValue).code;
  });

  bench('getStatus().code on 10k-frame invalid value', () => {
    void getStatus(bigInvalid).code;
  });
});

// ============================================================
// AC-NOD-21: LOOP-PARSING CASES (NFR-LOOP-1)
// Keyword-form while and do-while parse + execute cost.
// Baseline captured post-migration; ≤2% regression vs main.
// ============================================================

describe('AC-NOD-21: loop-parsing cases (NFR-LOOP-1)', () => {
  // while (cond) do { body } — 50 iterations, arithmetic accumulator.
  // Exercises the WhileLoopNode parse path + evaluate path.
  const WHILE_SOURCE = '0 -> while ($ < 50) do { $ + 1 }';
  const whileAst = parse(WHILE_SOURCE);

  bench(
    'while (cond) do { body } — parse + execute 50 iterations',
    async () => {
      await runCached(whileAst);
    }
  );

  // do { body } while (cond) — 50 iterations, arithmetic accumulator.
  // Exercises the DoWhileLoopNode parse path + evaluate path.
  const DO_WHILE_SOURCE = '0 -> do { $ + 1 } while ($ < 50)';
  const doWhileAst = parse(DO_WHILE_SOURCE);

  bench(
    'do { body } while (cond) — parse + execute 50 iterations',
    async () => {
      await runCached(doWhileAst);
    }
  );
});

// ============================================================
// AC-NOD-22: do<limit: N> CONSTRUCT-OPTION PARSE OVERHEAD
// (NFR-LOOP-2)
// Isolates the extra tokenizer work for `do<limit: N>`: the
// `<` glyph, key-value pair, and `>` close must be lexed and
// the keyword-table lookup for `limit` exercised each call.
// Parse-only; no execute. Baseline captured post-migration.
// ============================================================

describe('AC-NOD-22: do<limit: N> construct-option parse overhead (NFR-LOOP-2)', () => {
  // Parse a do-while with a limit annotation each iteration to
  // measure the incremental cost of the construct-option path
  // versus a plain do-while (see AC-NOD-21 above).
  const SOURCE = '0 -> do<limit: 100> { $ + 1 } while ($ < 100)';

  bench('parse do<limit: 100> { $ + 1 } while ($ < 100)', () => {
    parse(SOURCE);
  });

  // For direct comparison, parse a plain while loop of the same length.
  const PLAIN_SOURCE = '0 -> while ($ < 100) do { $ + 1 }';

  bench('parse while ($ < 100) do { $ + 1 } (plain, comparison)', () => {
    parse(PLAIN_SOURCE);
  });
});
