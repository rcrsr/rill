/**
 * Rill Runtime Tests: Scope Isolation (Phase 0 Validation)
 *
 * Tests for the new scope isolation semantics where:
 * 1. $ is immutable within a scope
 * 2. Statements in a block are sibling scopes, not a sequence
 * 3. $ flows only via explicit ->, never between siblings
 * 4. Child scopes read parent variables but cannot reassign them
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Phase 0: Scope Isolation', () => {
  describe('sibling statements do not share $', () => {
    it('$ in sibling refers to parent, not previous sibling', async () => {
      const result = await run(`
        "outer" -> {
          "inner"
          $
        }
      `);
      expect(result).toBe('outer'); // NOT "inner"
    });

    it('multiple siblings all see same parent $', async () => {
      const result = await run(`
        "parent" -> {
          "a"
          "b"
          "c"
          $
        }
      `);
      expect(result).toBe('parent');
    });

    it('sibling results are discarded except last', async () => {
      const result = await run(`
        "x" -> {
          "first"
          "second"
          "third"
        }
      `);
      expect(result).toBe('third');
    });
  });

  describe('$ flows only via explicit ->', () => {
    it('-> passes value to next element', async () => {
      const result = await run(`
        "hello" -> {
          "world" -> { $ }
        }
      `);
      expect(result).toBe('world');
    });

    it('chained blocks receive piped value', async () => {
      const result = await run(`
        "start" -> { "middle" } -> { $ }
      `);
      expect(result).toBe('middle');
    });

    it('nested chain works correctly', async () => {
      const result = await run(`
        "a" -> {
          "b" -> {
            "c" -> { $ }
          }
        }
      `);
      expect(result).toBe('c');
    });
  });

  describe('standalone blocks inherit outer $', () => {
    it('nested standalone block sees outer $', async () => {
      const result = await run(`
        "hello" -> {
          {
            $
          }
        }
      `);
      expect(result).toBe('hello');
    });

    it('deeply nested standalone blocks inherit correctly', async () => {
      const result = await run(`
        "level0" -> {
          {
            {
              $
            }
          }
        }
      `);
      expect(result).toBe('level0');
    });
  });

  describe('last sibling is block result', () => {
    it('returns last sibling value', async () => {
      const result = await run(`
        "x" -> {
          "first"
          "second"
          "third"
        }
      `);
      expect(result).toBe('third');
    });

    it('intermediate values are discarded', async () => {
      const result = await run(`
        "x" -> {
          "a" -> .upper
          "b" -> .upper
          "c"
        }
      `);
      expect(result).toBe('c');
    });
  });

  describe('variable scoping', () => {
    it('child cannot reassign outer variable', async () => {
      await expect(
        run(`
        "outer" :> $x
        {
          "inner" :> $x
        }
      `)
      ).rejects.toThrow(/[Cc]annot reassign outer variable/);
    });

    it('child can read outer variable', async () => {
      const result = await run(`
        "hello" :> $x
        {
          $x -> .upper
        }
      `);
      expect(result).toBe('HELLO');
    });

    it('variables created in child are not visible outside', async () => {
      // Variable not found throws an error
      await expect(
        run(`
        {
          "local" :> $x
        }
        $x
      `)
      ).rejects.toThrow('Undefined variable');
    });
  });

  describe('() groups create scopes', () => {
    it('grouped expression in chain', async () => {
      const result = await run(`
        "outer" -> ($ -> .upper)
      `);
      expect(result).toBe('OUTER');
    });

    it('grouped expression in condition uses piped value', async () => {
      const result = await run(`
        "hello" -> ($ == "hello") ? "yes" ! "no"
      `);
      expect(result).toBe('yes');
    });
  });

  describe('variable promotion across siblings', () => {
    it('captured var visible to later siblings', async () => {
      const result = await run(`
        "hello" -> {
          $ :> $captured
          $captured -> .upper
        }
      `);
      expect(result).toBe('HELLO');
    });

    it('multiple captures accumulate', async () => {
      const result = await run(`
        "hello" -> {
          "a" :> $first
          "b" :> $second
          "{$first}{$second}"
        }
      `);
      expect(result).toBe('ab');
    });
  });

  describe('edge cases', () => {
    it('block with just $ returns inherited $', async () => {
      // Empty blocks are not allowed in grammar, so use { $ }
      const result = await run(`
        "value" -> { $ }
      `);
      expect(result).toBe('value');
    });

    it('script-level $ without host context is undefined', async () => {
      // Without host-provided pipeValue, $ is undefined
      await expect(run('$')).rejects.toThrow('Undefined variable: $');
    });

    it('$ in piped block receives the piped value', async () => {
      // When a value is piped into a block, $ inside has that value
      const result = await run('"hello" -> { $ -> .upper }');
      expect(result).toBe('HELLO');
    });

    it('chain inside block works correctly', async () => {
      const result = await run(`
        "start" -> {
          "a" -> "b" -> "c"
        }
      `);
      expect(result).toBe('c');
    });
  });

  describe('loops maintain self-chaining semantics', () => {
    it('while loop body result becomes next $', async () => {
      const result = await run('1 -> ($ < 100) @ { $ * 2 }');
      expect(result).toBe(128); // 1->2->4->8->16->32->64->128
    });

    it('do-while body result becomes next $', async () => {
      const result = await run('1 -> @ { $ * 2 } ? ($ < 100)');
      expect(result).toBe(128);
    });

    it('each iteration receives element as $', async () => {
      const result = await run('[1, 2, 3] -> each { $ * 10 }');
      expect(result).toEqual([10, 20, 30]);
    });
  });
});
