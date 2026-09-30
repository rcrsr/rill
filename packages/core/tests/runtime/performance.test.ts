/**
 * Rill Runtime Tests: Performance Regression
 * Guards nested expression evaluation against performance regressions.
 *
 * - Test script includes: map, each, fold, dict creation, closures
 * - Timing uses best-of-N: the script runs in several batches and the test
 *   asserts on the fastest batch average. Load spikes on shared CI runners
 *   inflate some batches but not the minimum, while a real regression
 *   raises every batch.
 * - Fails if the fastest batch average exceeds the baseline by more than
 *   500% (see REGRESSION_THRESHOLD)
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// Performance threshold: 500% regression tolerance
// CI runners show high variance; observed peaks above 1.04ms on
// GitHub-hosted runners under load. The threshold is sized for the
// noisiest runners we see, not for typical-case detection.
const REGRESSION_THRESHOLD = 5.0;

// Baseline execution time (ms) - measured before the evaluator refactor
// Baseline: 0.225ms per iteration (local, isolated)
// Range observed: 0.149ms (isolated) to >1.04ms (CI under load)
// Max allowed with 500% threshold: 1.35ms
const BASELINE_MS = 0.225;

describe('Rill Runtime: Performance Regression', () => {
  it('executes nested expressions within performance budget', async () => {
    const batchCount = 5;
    const batchIterations = 200;

    // Complex test script covering multiple evaluation paths:
    // - map (parallel iteration)
    // - each (sequential iteration)
    // - fold (reduction)
    // - dict creation
    // - closures with captures
    // - arithmetic expressions
    // - string interpolation
    const testScript = `
      |x| { $x * 2 } => $double

      list[1, 2, 3, 4, 5] -> fan($double) => $doubled
      $doubled -> seq({ $ + 1 }) => $incremented
      $incremented -> fold(0, { $@ + $ }) => $total

      dict[result: $total, doubled: $doubled] => $data
      $data.result
    `;

    // Warmup: let JIT optimize before measuring.
    // Expected result: [2,4,6,8,10] -> [3,5,7,9,11] -> sum = 35
    for (let i = 0; i < 10; i++) {
      expect(await run(testScript)).toBe(35);
    }

    // No assertions inside the timed region; mismatches are counted and
    // asserted after timing.
    let mismatches = 0;
    const batchAverages: number[] = [];

    for (let batch = 0; batch < batchCount; batch++) {
      const start = performance.now();
      for (let i = 0; i < batchIterations; i++) {
        const result = await run(testScript);
        if (result !== 35) mismatches++;
      }
      batchAverages.push((performance.now() - start) / batchIterations);
    }

    expect(mismatches).toBe(0);

    const bestAvgMs = Math.min(...batchAverages);
    const maxAllowed = BASELINE_MS * (1 + REGRESSION_THRESHOLD);
    expect(bestAvgMs).toBeLessThanOrEqual(maxAllowed);
  }, 60000); // 60s timeout for 1000 timed iterations

  it('tokenizes leading whitespace before frontmatter delimiters in linear time', () => {
    // Regression guard: the frontmatter-start check must not re-slice and
    // trim the consumed source on every top-level `---` match. That made
    // tokenization cost proportional to leadingWhitespace x occurrences
    // instead of a constant per-token cost.
    const source = ' '.repeat(200_000) + '---\n'.repeat(10_000);

    const start = performance.now();
    tokenize(source);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(2000);
  }, 10000);
});
