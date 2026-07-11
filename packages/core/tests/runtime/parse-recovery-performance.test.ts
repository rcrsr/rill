/**
 * Rill Parser Tests: parseWithRecovery Performance Regression
 *
 * The previous version of this test measured wall-clock time over the
 * tests/language corpus (mostly-valid short snippets) against a fixed
 * millisecond ceiling. That corpus rarely drives recoverToNextStatement's
 * resync loop or trySalvagePartialExpression's re-parse through worst-case
 * shapes, and an absolute ceiling flakes under CI runner variance.
 *
 * This version instead exercises the recovery path directly with a
 * synthetic input sized to trigger it repeatedly, and asserts near-linear
 * scaling: quadrupling the input size should not multiply parse time by
 * more than a safe constant. Recovery is linear in input size, so this
 * holds with margin while still catching an accidental quadratic
 * regression.
 *
 * A deeply-nested-unclosed-bracket variant was also tried (to exercise
 * recoverToNextStatement's opener-stack walk specifically) but was dropped:
 * the only depths that reach recoverToNextStatement at all sit within ~50
 * tokens of V8's default call-stack limit for this grammar (parseExpression
 * recurses per open paren before recovery ever runs), so any depth large
 * enough to time meaningfully risks a `RangeError` instead of exercising
 * the resync loop, and the margin is too thin to be reliable across Node
 * versions/CI runners with different stack sizes. The repeated-`error()`
 * case below reaches recoverToNextStatement on every one of its statements
 * without approaching that limit, so it is the sole timed case here.
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';

// Scaling-tolerance constant: quadrupling the input must not more than
// quintuple the parse time. Linear scaling would produce a ratio near 4;
// this leaves generous margin for measurement noise while still catching a
// quadratic (ratio ~16) or worse regression.
const MAX_SCALING_RATIO = 5;

/**
 * Builds a script of `count` back-to-back malformed statements, each of
 * which fails to parse as an `error` statement (message required) and
 * drives one full pass through recoverToNextStatement per statement.
 */
function buildMalformedStatementCorpus(count: number): string {
  return 'error()\n'.repeat(count);
}

/** Runs parseWithRecovery over `source` `iterations` times, timing only. */
function timeParse(source: string, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parseWithRecovery(source);
  }
  return performance.now() - start;
}

describe('parseWithRecovery recovery-path performance scaling', () => {
  it('scales near-linearly with input size over repeated malformed statements', () => {
    const small = buildMalformedStatementCorpus(2500);
    const large = buildMalformedStatementCorpus(10000);
    const iterations = 5;

    // Warmup: let the JIT optimize before measuring either size.
    for (let i = 0; i < 3; i++) {
      parseWithRecovery(small);
      parseWithRecovery(large);
    }

    const smallMs = timeParse(small, iterations);
    const largeMs = timeParse(large, iterations);

    const ratio = largeMs / smallMs;
    expect(ratio).toBeLessThan(MAX_SCALING_RATIO);
  }, 60000);
});
