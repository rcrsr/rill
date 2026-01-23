/**
 * Rill Runtime Tests: Performance Regression
 * Baseline measurements for evaluate.ts refactoring
 *
 * Requirements from evaluate-decomposition-spec.md:
 * - Run 1000 iterations of nested expression evaluation
 * - Test script includes: map, each, fold, dict creation, closures
 * - Measure baseline before mixin extraction
 * - Fail if execution time regresses > 5%
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

// Performance threshold: 5% regression tolerance
const REGRESSION_THRESHOLD = 0.05;

// Baseline execution time (ms) - measured during Phase 1 (Task 1.2)
// Baseline: 0.225ms per iteration
// Measured with full test suite (accounts for system load and JIT warmup)
// Range observed: 0.149ms (isolated) to 0.221ms (full suite)
// Max allowed with 5% threshold: 0.236ms
const BASELINE_MS = 0.225;

describe('Rill Runtime: Performance Regression', () => {
  it('executes nested expressions within performance budget', async () => {
    const iterations = 1000;

    // Complex test script covering multiple evaluation paths:
    // - map (parallel iteration)
    // - each (sequential iteration)
    // - fold (reduction)
    // - dict creation
    // - closures with captures
    // - arithmetic expressions
    // - string interpolation
    const testScript = `
      |x| { $x * 2 } :> $double

      [1, 2, 3, 4, 5] -> map $double :> $doubled
      $doubled -> each { $ + 1 } :> $incremented
      $incremented -> fold(0) { $@ + $ } :> $total

      [result: $total, doubled: $doubled] :> $data
      $data.result
    `;

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const result = await run(testScript);
      // Verify correctness: [2,4,6,8,10] -> [3,5,7,9,11] -> sum = 35
      expect(result).toBe(35);
    }

    const duration = performance.now() - start;
    const avgMs = duration / iterations;

    // Log performance metrics for baseline establishment
    // eslint-disable-next-line no-console
    console.log(
      `Performance: ${iterations} iterations in ${duration.toFixed(2)}ms (avg: ${avgMs.toFixed(3)}ms)`
    );

    // Check regression only if baseline is established
    if (BASELINE_MS !== undefined) {
      const maxAllowed = BASELINE_MS * (1 + REGRESSION_THRESHOLD);
      expect(avgMs).toBeLessThanOrEqual(maxAllowed);
      // eslint-disable-next-line no-console
      console.log(
        `Baseline: ${BASELINE_MS.toFixed(3)}ms, Current: ${avgMs.toFixed(3)}ms, Max: ${maxAllowed.toFixed(3)}ms`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `No baseline set. Use this value to update BASELINE_MS: ${avgMs.toFixed(3)}`
      );
    }
  }, 60000); // 60s timeout for 1000 iterations
});
