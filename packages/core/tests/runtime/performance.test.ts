/**
 * Rill Runtime Tests: Performance Regression
 * Guards nested expression evaluation and tokenization against performance
 * regressions using size ratios instead of absolute budgets.
 *
 * A 4x increase in input size must not multiply the best-of-N time by 8x or
 * more. Linear scaling gives a ratio near 4; a quadratic regression gives
 * about 16. The bound matches parse-recovery-performance.test.ts, where 8
 * leaves room for the noise seen on shared CI runners.
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { scalingRatio } from '../helpers/scaling.js';

const MAX_SCALING_RATIO = 8;

describe('Rill Runtime: Performance Regression', () => {
  it('scales linearly when evaluating nested expressions', async () => {
    // Covers fan, seq, fold, dict creation, closures with captures,
    // arithmetic, and field access. The collection length scales with n.
    // Expected result for n: doubled = 2i, incremented = 2i + 1,
    // total = sum(2i + 1) = n * n.
    const scriptFor = (n: number): string => `
      |x| { $x * 2 } => $double

      range(0, ${n}) -> fan($double) => $doubled
      $doubled -> seq({ $ + 1 }) => $incremented
      $incremented -> fold(0, { $@ + $ }) => $total

      dict[result: $total, doubled: $doubled] => $data
      $data.result
    `;

    // Warmup: let JIT optimize before measuring.
    for (let i = 0; i < 5; i++) {
      expect(await run(scriptFor(100))).toBe(100 * 100);
      expect(await run(scriptFor(400))).toBe(400 * 400);
    }

    // No assertions inside the timed region; mismatches are counted and
    // asserted after timing.
    let mismatches = 0;
    const ratio = await scalingRatio(
      async (n) => {
        if ((await run(scriptFor(n))) !== n * n) mismatches++;
      },
      200,
      800,
      5
    );

    expect(mismatches).toBe(0);
    expect(ratio).toBeLessThan(MAX_SCALING_RATIO);
  }, 60000);

  it('tokenizes leading whitespace before frontmatter delimiters in linear time', async () => {
    // Regression guard: the frontmatter-start check must not re-slice and
    // trim the consumed source on every top-level `---` match. That made
    // tokenization cost proportional to leadingWhitespace x occurrences
    // instead of a constant per-token cost. Both factors scale 4x, so a
    // product-shaped cost grows 16x while a linear cost grows 4x.
    const sourceAt = (scale: number): string =>
      ' '.repeat(50_000 * scale) + '---\n'.repeat(2_500 * scale);

    const ratio = await scalingRatio(
      (scale) => {
        tokenize(sourceAt(scale));
      },
      1,
      4,
      5
    );

    expect(ratio).toBeLessThan(MAX_SCALING_RATIO);
  }, 30000);
});
