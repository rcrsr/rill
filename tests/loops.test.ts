/**
 * Rill Runtime Tests: Loops
 * Tests for while loops, for loops, break, and return
 *
 * New loop syntax:
 *   cond @ body        - while loop (cond is bool)
 *   list @ body        - for-each (list is iterable)
 *   @ body             - for-each over $
 *   @ body ? cond      - do-while (body first, then check)
 */

import type { RillValue } from '../src/index.js';
import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

// Helper functions for arithmetic
const inc = (args: RillValue[]): number => {
  const x = args[0];
  return typeof x === 'number' ? x + 1 : 1;
};
const double = (args: RillValue[]): number => {
  const x = args[0];
  return typeof x === 'number' ? x * 2 : 0;
};
const add10 = (args: RillValue[]): number => {
  const x = args[0];
  return typeof x === 'number' ? x + 10 : 10;
};

describe('Rill Runtime: Loops', () => {
  describe('While Loops', () => {
    it('loops until condition is false', async () => {
      // Use $ as accumulator (block scoping: variables don't leak)
      const script = `
        0 -> ($ < 3) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('never enters loop when condition is initially false', async () => {
      // Loop body never executes when condition starts false
      // The value is 5, which never satisfies ($ < 0)
      const script = `
        5 -> ($ < 0) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(5);
    });

    it('uses method as condition', async () => {
      // Loop while string contains "RETRY", replace with "OK" to exit
      // Uses $ as accumulator
      const script = `
        "RETRY" -> ($ -> .contains("RETRY")) @ { "OK" }
      `;
      expect(await run(script)).toBe('OK');
    });

    it('uses comparison as condition', async () => {
      // Uses $ as accumulator for string building
      const script = `
        "" -> (($ -> .len) < 3) @ { "{$}x" }
      `;
      expect(await run(script)).toBe('xxx');
    });

    it('uses grouped comparison as condition', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> ($ < 5) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(5);
    });
  });

  describe('For Loops', () => {
    it('iterates over tuple', async () => {
      expect(await run('["a", "b", "c"] @ { $ }')).toEqual(['a', 'b', 'c']);
    });

    it('transforms elements', async () => {
      const script = `
        [1, 2, 3] @ {
          $ -> add10
        }
      `;
      expect(await run(script, { functions: { add10 } })).toEqual([11, 12, 13]);
    });

    it('returns empty array for empty tuple', async () => {
      expect(await run('[] @ { "x" }')).toEqual([]);
    });

    it('handles single element', async () => {
      expect(await run('["only"] @ { $ }')).toEqual(['only']);
    });

    it('iterates over string characters', async () => {
      expect(await run('"abc" @ { $ }')).toEqual(['a', 'b', 'c']);
    });

    it('can transform string characters', async () => {
      const script = `
        "abc" @ {
          "{$}{$}"
        }
      `;
      expect(await run(script)).toEqual(['aa', 'bb', 'cc']);
    });

    it('iterates over dict entries', async () => {
      const result = await run('[b: 2, a: 1] @ { $ }');
      // Keys sorted alphabetically
      expect(result).toEqual([
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ]);
    });

    it('can destructure dict entries', async () => {
      const script = `
        [x: 10, y: 20] @ {
          $ -> *<key: $k, value: $v>
          "{$k}={$v}"
        }
      `;
      expect(await run(script)).toEqual(['x=10', 'y=20']);
    });

    it('returns empty array for empty dict', async () => {
      expect(await run('[:]  @ { $ }')).toEqual([]);
    });

    it('iterates using pipe target syntax', async () => {
      expect(await run('["a", "b", "c"] -> @ { $ }')).toEqual(['a', 'b', 'c']);
    });

    it('iterates over $ with bare @', async () => {
      const script = `
        [1, 2, 3] -> @ { $ }
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });
  });

  describe('Break', () => {
    it('exits for loop with value', async () => {
      const script = `
        [1, 2, 3, 4, 5] @ {
          ($ == 3) ? ("found" -> break)
          $
        }
      `;
      expect(await run(script)).toBe('found');
    });

    it('exits for loop with bare break', async () => {
      const script = `
        [1, 2, 3, 4, 5] @ {
          ($ == 3) ? break
          $
        }
      `;
      expect(await run(script)).toBe(3);
    });

    it('exits while loop with break', async () => {
      // Uses $ as accumulator, condition always true, break exits
      const script = `
        0 -> ($ < 100) @ {
          ($ + 1) -> ($ >= 5) ? break ! $
        }
      `;
      expect(await run(script)).toBe(5);
    });

    it('returns break value from while loop', async () => {
      // Uses $ as accumulator, condition always true, break exits with value
      const script = `
        0 -> ($ < 100) @ {
          ($ + 1) -> ($ == 3) ? ("three" -> break) ! $
        }
      `;
      expect(await run(script)).toBe('three');
    });
  });

  describe('Return', () => {
    it('exits block early with return', async () => {
      const script = `
        {
          "first" -> $a
          return
          "second" -> $b
          $b
        }
      `;
      // Returns "first" because that's $ when return is hit
      expect(await run(script)).toBe('first');
    });

    it('exits block with explicit return value', async () => {
      const script = `
        {
          "first" -> $a
          "returned" -> return
          "never reached"
        }
      `;
      expect(await run(script)).toBe('returned');
    });

    it('return in conditional exits containing block', async () => {
      const script = `
        {
          "value" -> $v
          $v -> .eq("value") ? ("matched" -> return)
          "not matched"
        }
      `;
      expect(await run(script)).toBe('matched');
    });
  });

  describe('Do-While Loops', () => {
    it('executes body at least once', async () => {
      // Even with false condition, body runs once (uses $ as accumulator)
      const script = `
        0 -> @ { $ + 1 } ? false
      `;
      expect(await run(script)).toBe(1);
    });

    it('continues while condition is true', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> @ { $ + 1 } ? ($ < 5)
      `;
      expect(await run(script)).toBe(5);
    });

    it('uses method as condition', async () => {
      // Build up string using $ as accumulator
      const script = `
        "" -> @ { "{$}x" } ? (($ -> .len) < 3)
      `;
      expect(await run(script)).toBe('xxx');
    });

    it('supports break', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> @ {
          ($ + 1) -> ($ > 3) ? ($ -> break) ! $
        } ? true
      `;
      expect(await run(script)).toBe(4);
    });

    it('returns last value from body', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> @ { $ + 1 } ? ($ < 3)
      `;
      expect(await run(script)).toBe(3);
    });

    it('executes once then checks condition (vs while which checks first)', async () => {
      // While loop with false condition: body never executes
      // Use a condition that's always false for initial value
      const whileScript = `
        5 -> ($ < 0) @ { $ + 1 }
      `;
      expect(await run(whileScript)).toBe(5);

      // Do-while with false condition: body executes once, then exits
      const doWhileScript = `
        5 -> @ { $ + 1 } ? ($ < 0)
      `;
      expect(await run(doWhileScript)).toBe(6);
    });
  });

  describe('Nested Loops', () => {
    it('handles nested for loops', async () => {
      const script = `
        [[1, 2], [3, 4]] @ {
          $ @ {
            $ -> double
          }
        }
      `;
      expect(await run(script, { functions: { double } })).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('break only exits inner loop', async () => {
      const script = `
        [[1, 2, 3], [4, 5, 6]] @ {
          $ @ {
            ($ == 2) ? break
            ($ == 5) ? break
            $
          }
        }
      `;
      // Inner loops break with the break value (not accumulated results)
      // First inner loop: breaks at 2, returns 2
      // Second inner loop: breaks at 5, returns 5
      // Outer loop collects these break values
      expect(await run(script)).toEqual([2, 5]);
    });
  });
});
