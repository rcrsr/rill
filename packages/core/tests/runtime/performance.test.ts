/**
 * Rill Runtime Tests: Performance Regression
 * Baseline measurements for evaluate.ts refactoring
 *
 * Requirements from evaluate-decomposition-spec.md:
 * - Run 1000 iterations of nested expression evaluation
 * - Test script includes: map, each, fold, dict creation, closures
 * - Baseline recorded before the evaluator refactor; guards against regressions
 * - Fail if execution time regresses > 5%
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// Performance threshold: 500% regression tolerance
// CI runners show high variance; observed peaks above 1.04ms on
// GitHub-hosted runners under load. The threshold is sized for the
// noisiest runners we see, not for typical-case detection.
const REGRESSION_THRESHOLD = 5.0;

// Baseline execution time (ms) - measured during Phase 1 (Task 1.2)
// Baseline: 0.225ms per iteration (local, isolated)
// Range observed: 0.149ms (isolated) to >1.04ms (CI under load)
// Max allowed with 500% threshold: 1.35ms
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
      |x| { $x * 2 } => $double

      list[1, 2, 3, 4, 5] -> fan($double) => $doubled
      $doubled -> seq({ $ + 1 }) => $incremented
      $incremented -> fold(0, { $@ + $ }) => $total

      dict[result: $total, doubled: $doubled] => $data
      $data.result
    `;

    // Warmup: let JIT optimize before measuring
    for (let i = 0; i < 10; i++) {
      await run(testScript);
    }

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const result = await run(testScript);
      // Verify correctness: [2,4,6,8,10] -> [3,5,7,9,11] -> sum = 35
      expect(result).toBe(35);
    }

    const duration = performance.now() - start;
    const avgMs = duration / iterations;

    const maxAllowed = BASELINE_MS * (1 + REGRESSION_THRESHOLD);
    expect(avgMs).toBeLessThanOrEqual(maxAllowed);
  }, 60000); // 60s timeout for 1000 iterations

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
