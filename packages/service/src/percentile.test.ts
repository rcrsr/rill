/**
 * Guards on the percentile helpers themselves.
 *
 * `measureRatioP95` divides by a reference measured elsewhere, so a bad
 * reference is the one way a latency suite can go green without measuring
 * anything. These cases pin that shut.
 */
import { describe, expect, it } from 'vitest';

import { measureP95, measureRatioP95 } from './percentile.js';

const noop = (): void => {};

describe('measureRatioP95', () => {
  // A negative reference is the dangerous one and the reason this guard
  // exists. Zero and NaN produce Infinity and NaN, which every budget
  // rejects, so they fail closed on their own. A negative reference makes
  // the ratio negative, and a negative ratio is under every budget - the
  // suite reports green having measured nothing.
  it.each([0, -1, -0.5, NaN, Infinity, -Infinity])(
    'rejects a reference p95 of %p',
    (reference) => {
      expect(() => measureRatioP95(noop, reference)).toThrow(
        /positive reference p95/
      );
    }
  );

  it('names the likely cause when the reference is zero', () => {
    expect(() => measureRatioP95(noop, 0)).toThrow(/beforeAll/);
  });

  it('divides by the reference when it is valid', () => {
    // measureP95 of a noop is at or near zero, so the assertion here is
    // about the division happening at all, not about a latency.
    expect(measureRatioP95(noop, 10)).toBeGreaterThanOrEqual(0);
    expect(measureRatioP95(noop, 10)).toBeLessThan(1);
  });
});

describe('measureP95', () => {
  it('returns a non-negative duration for work that does something', () => {
    let counter = 0;
    const p95 = measureP95(() => {
      for (let i = 0; i < 1000; i++) {
        counter += i;
      }
    });

    expect(counter).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(p95)).toBe(true);
  });
});
