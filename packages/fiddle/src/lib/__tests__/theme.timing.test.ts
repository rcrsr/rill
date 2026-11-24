/**
 * Theme extension performance budgets
 *
 * Wall-clock p95 budgets for createThemeExtension. Named *.timing.test.ts so
 * vitest runs it alone after the unit files; see vitest.config.ts.
 */

import { describe, it, expect } from 'vitest';
import { createThemeExtension } from '../theme.js';
import { measureP95 } from '../../../tests/helpers/measure.js';

describe('createThemeExtension performance', () => {
  describe('Theme creation performance', () => {
    it('completes theme creation within 100ms', () => {
      const darkP95 = measureP95(
        () => {
          createThemeExtension(true);
        },
        { samples: 50, warmup: 5 }
      );
      expect(darkP95).toBeLessThan(100);

      const lightP95 = measureP95(
        () => {
          createThemeExtension(false);
        },
        { samples: 50, warmup: 5 }
      );
      expect(lightP95).toBeLessThan(100);
    });
  });

  describe('Rapid theme creation calls', () => {
    it('completes 10 rapid createThemeExtension calls', () => {
      const p95 = measureP95(
        () => {
          for (let i = 0; i < 10; i++) {
            createThemeExtension(i % 2 === 0);
          }
        },
        { samples: 20, warmup: 3 }
      );

      // All 10 calls should complete within 1 second
      expect(p95).toBeLessThan(1000);
    });
  });
});
