/**
 * Rill Runtime Tests: Block Scoping
 *
 * Tests for proper variable scoping in blocks, loops, conditionals, and groups.
 * Blocks create child scopes that:
 * 1. Read from parent scope (lexical lookup)
 * 2. Cannot write to parent scope (shadowing only)
 * 3. Do not leak variables to parent scope
 */

import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

describe('Rill Runtime: Block Scoping', () => {
  describe('Loop Blocks', () => {
    it('cannot shadow outer variable in block', async () => {
      // Attempting to assign to outer variable name is an error
      const script = `
        "outer" :> $x
        [1, 2, 3] -> each { "inner" :> $x }
        $x
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('inner variable not visible after block exits', async () => {
      // Variable created inside block is not visible outside
      // Accessing undefined variable returns null
      const script = `
        [1, 2, 3] -> each { "created" :> $y }
        $y
      `;
      expect(await run(script)).toBeNull();
    });

    it('reading outer variable inside block works', async () => {
      const script = `
        100 :> $x
        [1, 2, 3] -> each { $x + $ }
      `;
      expect(await run(script)).toEqual([101, 102, 103]);
    });

    it('can create new variables that do not shadow', async () => {
      // New variables with unique names are allowed
      const script = `
        10 :> $x
        [1, 2, 3] -> each {
          ($x + $) :> $local
          [$x, $local]
        }
      `;
      // $x is read from outer (10), $local is new in each iteration
      expect(await run(script)).toEqual([
        [10, 11],
        [10, 12],
        [10, 13],
      ]);
    });

    it('nested blocks create nested scopes', async () => {
      // Each level can create new unique variables
      const script = `
        "outer" :> $x
        [1, 2] -> each {
          "level1" :> $a
          [3, 4] -> each {
            "level2" :> $b
            [$x, $a, $b]
          }
        }
      `;
      // Each inner block can read from all outer scopes
      expect(await run(script)).toEqual([
        [
          ['outer', 'level1', 'level2'],
          ['outer', 'level1', 'level2'],
        ],
        [
          ['outer', 'level1', 'level2'],
          ['outer', 'level1', 'level2'],
        ],
      ]);
    });

    it('loop iteration variable $ is block-local', async () => {
      // $ changes per iteration but doesn't leak to outer scope
      const script = `
        "original" :> $outer
        [1, 2, 3] -> each { $ * 10 } :> $result
        $result
      `;
      expect(await run(script)).toEqual([10, 20, 30]);
    });
  });

  describe('Conditional Blocks', () => {
    it('cannot shadow outer variable in then branch', async () => {
      const script = `
        "outer" :> $x
        true ? { "then" :> $x }
        $x
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('cannot shadow outer variable in else branch', async () => {
      const script = `
        "outer" :> $x
        false ? { "then" :> $x } ! { "else" :> $x }
        $x
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('conditional can read outer variables', async () => {
      const script = `
        10 :> $x
        true ? { $x + 5 } ! { $x - 5 }
      `;
      expect(await run(script)).toBe(15);
    });

    it('variables created in conditional do not leak', async () => {
      // Variable created in conditional branch is not visible outside
      const script = `
        true ? { "created" :> $y }
        $y
      `;
      expect(await run(script)).toBeNull();
    });
  });

  describe('Grouped Expressions', () => {
    it('cannot shadow outer variable in grouped expression', async () => {
      const script = `
        "outer" :> $x
        ("inner" :> $x)
        $x
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('grouped expressions can read outer variables', async () => {
      const script = `
        10 :> $x
        ($x + 5)
      `;
      expect(await run(script)).toBe(15);
    });

    it('variables created in group do not leak', async () => {
      // Variable created in grouped expression is not visible outside
      const script = `
        ("created" :> $y)
        $y
      `;
      expect(await run(script)).toBeNull();
    });
  });

  describe('Closures', () => {
    it('closures cannot shadow outer variables', async () => {
      const script = `
        "outer" :> $x
        ||("closure" :> $x) :> $fn
        $fn()
        $x
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('closures resolve variables at call time (late binding)', async () => {
      const script = `
        10 :> $x
        ||($x + 5) :> $fn
        20 :> $x
        $fn()
      `;
      // Closure resolves $x at call time, so it sees $x=20
      expect(await run(script)).toBe(25);
    });
  });

  describe('Type Consistency Across Scopes', () => {
    it('cannot shadow outer variable even with different type', async () => {
      // Cannot reuse outer variable name in child scope
      const script = `
        "hello" :> $x
        [1, 2, 3] -> each {
          100 :> $x
          $x
        }
      `;
      await expect(run(script)).rejects.toThrow(
        /Cannot reassign outer variable/
      );
    });

    it('reading outer variable respects its type', async () => {
      const script = `
        10 :> $x
        [1, 2, 3] -> each { $x + $ }
      `;
      expect(await run(script)).toEqual([11, 12, 13]);
    });
  });

  describe('While Loop Scoping', () => {
    it('while loop uses $ as accumulator', async () => {
      // Old pattern ($x inside loop) no longer works
      // New pattern: use $ as accumulator
      const script = `
        0 -> ($ < 5) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(5);
    });

    it('while loop body has isolated scope', async () => {
      // Variable assignment inside while body doesn't leak
      const script = `
        0 -> ($ < 3) @ {
          ($ * 10) :> $inner
          $ + 1
        }
        $inner
      `;
      // $inner was only created inside loop, not visible outside
      expect(await run(script)).toBeNull();
    });
  });

  describe('Do-While Loop Scoping', () => {
    it('do-while uses $ as accumulator', async () => {
      const script = `
        0 -> @ { $ + 1 } ? ($ < 5)
      `;
      expect(await run(script)).toBe(5);
    });

    it('do-while body has isolated scope', async () => {
      // Variable assignment inside do-while body doesn't leak
      const script = `
        0 -> @ {
          ($ * 10) :> $inner
          $ + 1
        } ? ($ < 3)
        $inner
      `;
      // $inner was only created inside loop, not visible outside
      expect(await run(script)).toBeNull();
    });
  });
});
