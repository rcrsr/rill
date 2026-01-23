/**
 * Rill Runtime Tests: Loops
 * Tests for while loops, do-while loops, break, and return
 *
 * Loop syntax:
 *   cond @ body        - while loop (cond must be bool)
 *   @ body ? cond      - do-while (body first, then check)
 *
 * For iteration over collections, use collection operators: each, map, filter, fold
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

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

    it('requires boolean condition', async () => {
      // Non-boolean conditions should error
      await expect(run('[1, 2, 3] @ { $ }')).rejects.toThrow(
        /condition must be boolean/i
      );
    });

    it('string condition errors', async () => {
      await expect(run('"hello" @ { $ }')).rejects.toThrow(
        /condition must be boolean/i
      );
    });
  });

  describe('Break', () => {
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

    it('exits each loop early with break', async () => {
      // Break in each terminates iteration and returns break value
      const script = `
        [1, 2, 3, 4, 5] -> each {
          ($ == 3) ? break
          $
        }
      `;
      // each returns break value (3), not partial results
      expect(await run(script)).toBe(3);
    });
  });

  describe('Return', () => {
    it('exits block early with return', async () => {
      // With scope isolation, bare `return` returns the block's inherited $
      // (not the previous sibling's result). Use explicit return value instead.
      const script = `
        {
          "first" :> $a
          $a -> return
          "second" :> $b
          $b
        }
      `;
      // Returns $a's value because that's what we explicitly return
      expect(await run(script)).toBe('first');
    });

    it('exits block with explicit return value', async () => {
      const script = `
        {
          "first" :> $a
          "returned" -> return
          "never reached"
        }
      `;
      expect(await run(script)).toBe('returned');
    });

    it('return in conditional exits containing block', async () => {
      const script = `
        {
          "value" :> $v
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

  describe('Nested Loops (using each)', () => {
    it('handles nested each loops', async () => {
      const script = `
        [[1, 2], [3, 4]] -> each {
          $ -> each { $ * 2 }
        }
      `;
      expect(await run(script)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('break only exits inner loop', async () => {
      const script = `
        [[1, 2, 3], [4, 5, 6]] -> each {
          $ -> each {
            ($ == 2) ? break
            ($ == 5) ? break
            $
          }
        }
      `;
      // Inner loops break and return break value
      // First inner loop: returns 2 (break value)
      // Second inner loop: returns 5 (break value)
      // Outer loop collects these break values into [2, 5]
      expect(await run(script)).toEqual([2, 5]);
    });
  });

  describe('Iterator While Loops', () => {
    it('$ is consistent in condition and body (parenthesized)', async () => {
      // Parenthesize condition and body for clarity
      const script = `
        [1, 2, 3] -> .first() -> (!$.done) @ ($.next())
      `;
      const result = (await run(script)) as Record<string, unknown>;
      expect(result.done).toBe(true);
    });

    it('loop advances iterator correctly', async () => {
      // After looping, iterator should be exhausted
      const script = `
        [1, 2, 3] -> .first() -> (!$.done) @ ($.next()) :> $it
        $it.done
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Bare @ Error', () => {
    it('bare @ without condition errors', async () => {
      await expect(run('@ { $ + 1 }')).rejects.toThrow(
        /Bare '@' requires trailing condition/i
      );
    });
  });

  describe('Self-Chaining Semantics', () => {
    it('while: body result becomes next $', async () => {
      const result = await run('1 -> ($ < 100) @ { $ * 2 }');
      expect(result).toBe(128); // 1->2->4->8->16->32->64->128
    });

    it('do-while: body result becomes next $', async () => {
      const result = await run('1 -> @ { $ * 2 } ? ($ < 100)');
      expect(result).toBe(128);
    });
  });
});
