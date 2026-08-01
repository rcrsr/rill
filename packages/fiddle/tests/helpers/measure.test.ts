/**
 * Guards on the measurement helper the performance tests depend on.
 *
 * A sample count of zero reaches `computeP95` with an empty array, which
 * returns `undefined` rather than throwing. The budget assertion then fails
 * for a reason its message never mentions, and the reading it reports is
 * not a measurement of anything. These cases pin that shut.
 */
import { describe, expect, it } from 'vitest';

import { measureP95 } from './measure.js';

const noop = (): void => {};

describe('measureP95', () => {
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects a sample count of %p',
    (samples) => {
      expect(() => measureP95(noop, { samples, warmup: 0 })).toThrow(
        /at least one sample/
      );
    }
  );

  it.each([-1, 1.5, NaN, Infinity])(
    'rejects a warmup count of %p',
    (warmup) => {
      expect(() => measureP95(noop, { samples: 1, warmup })).toThrow(
        /non-negative warmup/
      );
    }
  );

  it('accepts a zero warmup, which is a valid choice', () => {
    expect(() => measureP95(noop, { samples: 1, warmup: 0 })).not.toThrow();
  });

  it('runs the function exactly samples + warmup times', () => {
    let calls = 0;
    measureP95(
      () => {
        calls++;
      },
      { samples: 7, warmup: 3 }
    );

    expect(calls).toBe(10);
  });

  it('returns a finite, non-negative duration', () => {
    const p95 = measureP95(
      () => {
        let counter = 0;
        for (let i = 0; i < 1000; i++) {
          counter += i;
        }
        return counter;
      },
      { samples: 10, warmup: 2 }
    );

    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeGreaterThanOrEqual(0);
  });
});
