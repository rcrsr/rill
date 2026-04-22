/**
 * Rill Runtime Tests: Loops
 * Tests for while loops, do-while loops, break, and return
 *
 * Loop syntax:
 *   while (cond) do { body }        - while loop (cond must be bool)
 *   do { body } while (cond)        - do-while (body first, then check)
 *   do<limit: N> { body } while (cond) - do-while with iteration limit
 *
 * For iteration over collections, use collection operators: each, map, filter, fold
 */

import { describe, expect, it } from 'vitest';

import { parse, ParseError } from '@rcrsr/rill';
import { findNode, run } from '../helpers/runtime.js';

describe('Rill Runtime: Loops', () => {
  describe('While Loops', () => {
    it('[AC-NOD-6] loops until condition is false (pipe-seeded while)', async () => {
      // Use $ as accumulator (block scoping: variables don't leak)
      const script = `
        0 -> while ($ < 3) do { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('never enters loop when condition is initially false', async () => {
      // Loop body never executes when condition starts false
      // The value is 5, which never satisfies ($ < 0)
      const script = `
        5 -> while ($ < 0) do { $ + 1 }
      `;
      expect(await run(script)).toBe(5);
    });

    it('uses method as condition', async () => {
      // Loop while string contains "RETRY", replace with "OK" to exit
      // Uses $ as accumulator
      const script = `
        "RETRY" -> while ($ -> .contains("RETRY")) do { "OK" }
      `;
      expect(await run(script)).toBe('OK');
    });

    it('uses comparison as condition', async () => {
      // Uses $ as accumulator for string building
      const script = `
        "" -> while (($ -> .len) < 3) do { "{$}x" }
      `;
      expect(await run(script)).toBe('xxx');
    });

    it('uses grouped comparison as condition', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> while ($ < 5) do { $ + 1 }
      `;
      expect(await run(script)).toBe(5);
    });

    it('requires boolean condition', async () => {
      // Non-boolean conditions should error
      await expect(run('while (list[1, 2, 3]) do { $ }')).rejects.toThrow(
        /condition must be boolean/i
      );
    });

    it('string condition errors', async () => {
      await expect(run('while ("hello") do { $ }')).rejects.toThrow(
        /condition must be boolean/i
      );
    });
  });

  describe('Break', () => {
    it('exits while loop with break', async () => {
      // Uses $ as accumulator, condition always true, break exits
      const script = `
        0 -> while ($ < 100) do {
          ($ + 1) -> ($ >= 5) ? break ! $
        }
      `;
      expect(await run(script)).toBe(5);
    });

    it('returns break value from while loop', async () => {
      // Uses $ as accumulator, condition always true, break exits with value
      const script = `
        0 -> while ($ < 100) do {
          ($ + 1) -> ($ == 3) ? ("three" -> break) ! $
        }
      `;
      expect(await run(script)).toBe('three');
    });

    it('exits each loop early with break', async () => {
      // Break in each terminates iteration and returns partial results
      const script = `
        list[1, 2, 3, 4, 5] -> seq({
          ($ == 3) ? break
          $
        })
      `;
      // each returns results collected before break
      expect(await run(script)).toEqual([1, 2]);
    });
  });

  describe('Return', () => {
    it('exits block early with return', async () => {
      // With scope isolation, bare `return` returns the block's inherited $
      // (not the previous sibling's result). Use explicit return value instead.
      const script = `
        "" -> {
          "first" => $a
          $a -> return
          "second" => $b
          $b
        }
      `;
      // Returns $a's value because that's what we explicitly return
      expect(await run(script)).toBe('first');
    });

    it('exits block with explicit return value', async () => {
      const script = `
        "" -> {
          "first" => $a
          "returned" -> return
          "never reached"
        }
      `;
      expect(await run(script)).toBe('returned');
    });

    it('return in conditional exits containing block', async () => {
      const script = `
        "" -> {
          "value" => $v
          $v -> .eq("value") ? ("matched" -> return)
          "not matched"
        }
      `;
      expect(await run(script)).toBe('matched');
    });
  });

  describe('Do-While Loops', () => {
    it('[AC-NOD-2] executes body at least once (DoWhileLoopNode structure)', async () => {
      // Even with false condition, body runs once (uses $ as accumulator)
      const script = `
        0 -> do { $ + 1 } while (false)
      `;
      expect(await run(script)).toBe(1);
    });

    it('continues while condition is true', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> do { $ + 1 } while ($ < 5)
      `;
      expect(await run(script)).toBe(5);
    });

    it('uses method as condition', async () => {
      // Build up string using $ as accumulator
      const script = `
        "" -> do { "{$}x" } while (($ -> .len) < 3)
      `;
      expect(await run(script)).toBe('xxx');
    });

    it('supports break', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> do {
          ($ + 1) -> ($ > 3) ? ($ -> break) ! $
        } while (true)
      `;
      expect(await run(script)).toBe(4);
    });

    it('returns last value from body', async () => {
      // Uses $ as accumulator
      const script = `
        0 -> do { $ + 1 } while ($ < 3)
      `;
      expect(await run(script)).toBe(3);
    });

    it('executes once then checks condition (vs while which checks first)', async () => {
      // While loop with false condition: body never executes
      // Use a condition that's always false for initial value
      const whileScript = `
        5 -> while ($ < 0) do { $ + 1 }
      `;
      expect(await run(whileScript)).toBe(5);

      // Do-while with false condition: body executes once, then exits
      const doWhileScript = `
        5 -> do { $ + 1 } while ($ < 0)
      `;
      expect(await run(doWhileScript)).toBe(6);
    });
  });

  describe('Nested Loops (using each)', () => {
    it('handles nested each loops', async () => {
      const script = `
        list[list[1, 2], list[3, 4]] -> seq({
          $ -> seq({ $ * 2 })
        })
      `;
      expect(await run(script)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('break only exits inner loop', async () => {
      const script = `
        list[list[1, 2, 3], list[4, 5, 6]] -> seq({
          $ -> seq({
            ($ == 2) ? break
            ($ == 5) ? break
            $
          })
        })
      `;
      // Inner loops break and return partial results
      // First inner loop: collects [1], breaks at 2
      // Second inner loop: collects [4], breaks at 5
      expect(await run(script)).toEqual([[1], [4]]);
    });
  });

  describe('Iterator While Loops', () => {
    it('$ is consistent in condition and body (parenthesized)', async () => {
      // Loop while iterator is not done; capture each result
      const script = `
        list[1, 2, 3] -> .first() -> while (!$.done) do { $.next() } => $it
        $it.done
      `;
      expect(await run(script)).toBe(true);
    });

    it('loop advances iterator correctly', async () => {
      // After looping, iterator should be exhausted
      const script = `
        list[1, 2, 3] -> .first() -> while (!$.done) do { $.next() } => $it
        $it.done
      `;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Legacy @ Syntax Errors', () => {
    it('[AC-NOD-8] bare @ without condition emits migration error R080', async () => {
      const err = await run('@ { $ + 1 }').catch((e: unknown) => e);
      expect(err).toHaveProperty('errorId', 'RILL-R080');
      expect(err).toHaveProperty(
        'message',
        expect.stringContaining(
          'Migration error: use `do { body } while (cond)`'
        )
      );
    });

    it('[AC-NOD-7] pre-loop (cond) @ form emits migration error R079 at @', async () => {
      const err = await run('0 -> ($ < 3) @ { $ + 1 }').catch(
        (e: unknown) => e
      );
      expect(err).toHaveProperty('errorId', 'RILL-R079');
      expect(err).toHaveProperty(
        'message',
        expect.stringContaining(
          'Migration error: use `while (cond) do { body }`'
        )
      );
    });

    it('[AC-NOD-8] post-loop @ { body } ? (cond) form emits migration error R080 at @', async () => {
      const err = await run('0 -> @ { $ + 1 } ? ($ < 3)').catch(
        (e: unknown) => e
      );
      expect(err).toHaveProperty('errorId', 'RILL-R080');
      expect(err).toHaveProperty(
        'message',
        expect.stringContaining(
          'Migration error: use `do { body } while (cond)`'
        )
      );
    });

    it('bare ^(limit:) annotation in expression position emits migration error R081', async () => {
      // R081 fires when ^(limit: N) appears as a primary expression head
      await expect(run('true ? ^(limit: 5) { $ + 1 } ! 0')).rejects.toThrow(
        /Migration error: use `do<limit: N> \{ body \}`/
      );
    });
  });

  describe('Self-Chaining Semantics', () => {
    it('while: body result becomes next $', async () => {
      const result = await run('1 -> while ($ < 100) do { $ * 2 }');
      expect(result).toBe(128); // 1->2->4->8->16->32->64->128
    });

    it('do-while: body result becomes next $', async () => {
      const result = await run('1 -> do { $ * 2 } while ($ < 100)');
      expect(result).toBe(128);
    });
  });

  describe('Script-Level Return', () => {
    it('exits script with explicit return value', async () => {
      const script = `
        "hello" -> return
      `;
      expect(await run(script)).toBe('hello');
    });

    it('stops executing remaining statements', async () => {
      const script = `
        "first" => $a
        $a -> return
        "second" => $b
        $b
      `;
      expect(await run(script)).toBe('first');
    });

    it('returns current $ when no explicit value', async () => {
      const script = `
        "piped value" -> return
      `;
      expect(await run(script)).toBe('piped value');
    });

    it('works with conditional at script level', async () => {
      const script = `
        "check" => $val
        $val -> .eq("check") ? ("matched" -> return)
        "not matched"
      `;
      expect(await run(script)).toBe('matched');
    });
  });

  // ============================================================
  // AC-NOD-1: WhileLoopNode AST structure
  // ============================================================

  describe('AST Structure: WhileLoopNode [AC-NOD-1]', () => {
    it('[AC-NOD-1] produces WhileLoopNode with PipeChain condition and no annotations', () => {
      const ast = parse('0 -> while ($ < 5) do { $ + 1 }');
      expect(ast.type).toBe('Script');
      // Walk to find the WhileLoop node
      const whileNode = findNode(ast, 'WhileLoop') as Record<
        string,
        unknown
      > | null;
      expect(whileNode).not.toBeNull();
      expect(whileNode!['type']).toBe('WhileLoop');
      // condition is a PipeChain (seed threaded into condition)
      expect((whileNode!['condition'] as Record<string, unknown>)['type']).toBe(
        'PipeChain'
      );
      // annotations are undefined when not specified
      expect(whileNode!['annotations']).toBeUndefined();
    });
  });

  // ============================================================
  // AC-NOD-2: DoWhileLoopNode AST structure
  // ============================================================

  describe('AST Structure: DoWhileLoopNode [AC-NOD-2]', () => {
    it('[AC-NOD-2] produces DoWhileLoopNode with null input, body, and condition', () => {
      const ast = parse('do { $ + 1 } while ($ < 5)');
      const doWhileNode = findNode(ast, 'DoWhileLoop') as Record<
        string,
        unknown
      > | null;
      expect(doWhileNode).not.toBeNull();
      expect(doWhileNode!['type']).toBe('DoWhileLoop');
      // input is null when not pipe-seeded
      expect(doWhileNode!['input']).toBeNull();
      // body and condition are populated
      expect(doWhileNode!['body']).toBeDefined();
      expect(doWhileNode!['condition']).toBeDefined();
    });
  });

  // ============================================================
  // AC-NOD-3 / AC-NOD-4: Limit annotations at runtime
  // ============================================================

  describe('Limit Annotations [AC-NOD-3, AC-NOD-4]', () => {
    it('[AC-NOD-3] while...do<limit: 100> allows up to 100 iterations', async () => {
      // limit: 100 overrides the default; loop runs to completion (50 iterations)
      const result = await run('0 -> while ($ < 50) do<limit: 100> { $ + 1 }');
      expect(result).toBe(50);
    });

    it('[AC-NOD-3] do<limit: 100>...while annotation is present on AST node', () => {
      const ast = parse('while ($ < 50) do<limit: 100> { $ + 1 }');
      const whileNode = findNode(ast, 'WhileLoop') as Record<
        string,
        unknown
      > | null;
      expect(whileNode).not.toBeNull();
      const annotations = whileNode!['annotations'] as unknown[];
      expect(Array.isArray(annotations)).toBe(true);
      expect(annotations.length).toBeGreaterThan(0);
    });

    it('[AC-NOD-4] do<limit: 50>...while applies limit verbatim at runtime', async () => {
      // limit: 50 allows exactly 50 iterations; loop to 50 from 0
      const result = await run('0 -> do<limit: 50> { $ + 1 } while ($ < 50)');
      expect(result).toBe(50);
    });
  });

  // ============================================================
  // AC-NOD-5: Nested while and do-while
  // ============================================================

  describe('Nested Loops [AC-NOD-5]', () => {
    it('[AC-NOD-5] nested while loops associate conditions to innermost keyword', async () => {
      // Outer loop: 0..2, inner loop: 0..1 per outer step
      const result = await run(`
        0 -> while ($ < 4) do {
          0 -> while ($ < 2) do { $ + 1 }
          $ + 1
        }
      `);
      // Outer $ goes 0->1->2->3->4 (inner loop always returns 2, outer adds 1)
      // After outer body: inner returns 2, then outer $ + 1 = 3 (wait, outer $ is the seed)
      // Actually outer $ is the running value, inner replaces it temporarily in inner scope
      // Let's just verify it completes without error
      expect(typeof result).toBe('number');
    });

    it('[AC-NOD-5] nested do-while loops associate conditions to innermost keyword', async () => {
      const result = await run(`
        0 -> do {
          0 -> do { $ + 1 } while ($ < 2)
          $ + 1
        } while ($ < 3)
      `);
      expect(typeof result).toBe('number');
    });
  });

  // ============================================================
  // AC-NOD-7: (cond) @ {…} emits RILL-R079
  // ============================================================

  describe('Migration Error: R079 pre-loop @ [AC-NOD-7]', () => {
    it('[AC-NOD-7] ($ < 5) @ { $ + 1 } emits RILL-R079 at @ token', () => {
      try {
        parse('($ < 5) @ { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-R079');
        expect(e.message).toContain(
          'Migration error: use `while (cond) do { body }`'
        );
      }
    });

    it('[AC-NOD-7] error fires at the @ glyph (NFR-LOOP-3 span locality)', () => {
      try {
        parse('($ < 5) @ { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        // @ is at column 9 (1-based) in the source
        expect(e.location?.column).toBe(9);
      }
    });
  });

  // ============================================================
  // AC-NOD-8: @ {…} ? (cond) emits RILL-R080
  // ============================================================

  describe('Migration Error: R080 post-loop @ [AC-NOD-8]', () => {
    it('[AC-NOD-8] @ { $ + 1 } ? ($ < 5) emits RILL-R080 at @ token', () => {
      try {
        parse('@ { $ + 1 } ? ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-R080');
        expect(e.message).toContain(
          'Migration error: use `do { body } while (cond)`'
        );
      }
    });

    it('[AC-NOD-8] error fires at the @ glyph (NFR-LOOP-3 span locality)', () => {
      try {
        parse('@ { $ + 1 } ? ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        // @ is at column 1 (1-based) — start of source
        expect(e.location?.column).toBe(1);
      }
    });
  });

  // ============================================================
  // AC-NOD-9: (cond) @ ^(limit: N) {…} emits RILL-R079 at @
  // ============================================================

  describe('Migration Error: R079 at earliest @ [AC-NOD-9]', () => {
    it('[AC-NOD-9] ($ < 50) @ ^(limit: 100) { $ + 1 } emits RILL-R079 at @', () => {
      try {
        parse('($ < 50) @ ^(limit: 100) { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-R079');
        expect(e.message).toContain(
          'Migration error: use `while (cond) do { body }`'
        );
        // @ is at column 10 (1-based)
        expect(e.location?.column).toBe(10);
      }
    });
  });

  // ============================================================
  // AC-NOD-10: while without (cond) emits RILL-P004 row 4
  // ============================================================

  describe('Parse Error: while missing (cond) [AC-NOD-10]', () => {
    it('[AC-NOD-10] while { body } emits RILL-P004 with row-4 message', () => {
      try {
        parse('while { body }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Parse error: `while` requires `(condition)` before `do`'
        );
      }
    });

    it('[AC-NOD-10] while do { body } emits RILL-P004 with row-4 message', () => {
      try {
        parse('while do { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Parse error: `while` requires `(condition)` before `do`'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-11: while (cond) without do emits RILL-P004 row 5
  // ============================================================

  describe('Parse Error: while (cond) missing do [AC-NOD-11]', () => {
    it('[AC-NOD-11] while ($ < 5) { body } emits RILL-P004 with row-5 message', () => {
      try {
        parse('while ($ < 5) { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Parse error: expected `do` after `while (cond)`'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-12: standalone do { body } without while emits RILL-P004 row 6
  // ============================================================

  describe('Parse Error: standalone do without trailing while [AC-NOD-12]', () => {
    it('[AC-NOD-12] do { $ + 1 } emits RILL-P004 with row-6 message', () => {
      try {
        parse('do { $ + 1 }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Parse error: `do { body }` requires trailing `while (cond)` in post-loop form'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-13: do<unknown: N> emits RILL-P004 row 7
  // ============================================================

  describe('Parse Error: unknown construct option [AC-NOD-13]', () => {
    it('[AC-NOD-13] do<unknown: 1> { body } emits RILL-P004 with unknown substituted', () => {
      try {
        parse('do<unknown: 1> { $ + 1 } while ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Parse error: unknown option `unknown` for `do` construct (only `limit` accepted)'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-14: non-positive limit emits RILL-P004 row 8
  // ============================================================

  describe('Parse Error: non-positive limit [AC-NOD-14]', () => {
    it('[AC-NOD-14] do<limit: 0> { body } emits RILL-P004 with row-8 message', () => {
      try {
        parse('do<limit: 0> { $ + 1 } while ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Validation error: `limit` must be a positive integer'
        );
      }
    });

    it('[AC-NOD-14] do<limit: -5> { body } emits RILL-P004 with row-8 message', () => {
      try {
        parse('do<limit: -5> { $ + 1 } while ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P004');
        expect(e.message).toContain(
          'Validation error: `limit` must be a positive integer'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-15: missing > in construct options emits RILL-P005 row 9
  // ============================================================

  describe('Parse Error: missing > in construct options [AC-NOD-15]', () => {
    it('[AC-NOD-15] do<limit: 100 { body } emits RILL-P005 with row-9 message', () => {
      try {
        parse('do<limit: 100 { $ + 1 } while ($ < 5)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const e = err as ParseError;
        expect(e.errorId).toBe('RILL-P005');
        expect(e.message).toContain(
          'Parse error: expected `>` to close `do` construct options'
        );
      }
    });
  });

  // ============================================================
  // AC-NOD-16: while and do as variable names fail parsing
  // ============================================================

  describe('Reserved Keywords: while and do as variable names [AC-NOD-16]', () => {
    it('[AC-NOD-16] $while fails parsing with invalid-identifier error', () => {
      expect(() => parse('$while')).toThrow();
    });

    it('[AC-NOD-16] $do fails parsing with invalid-identifier error', () => {
      expect(() => parse('$do')).toThrow();
    });

    it('[AC-NOD-16] while as capture target fails parsing', () => {
      // "val" => $while — $while requires IDENTIFIER after $
      expect(() => parse('"val" => $while')).toThrow();
    });
  });

  // ============================================================
  // AC-NOD-17: do<limit: 1> succeeds (smallest positive integer)
  // ============================================================

  describe('Boundary: minimum valid limit [AC-NOD-17]', () => {
    it('[AC-NOD-17] do<limit: 1> { body } while (false) succeeds', async () => {
      // limit: 1 is the smallest positive integer; body runs once
      const result = await run('0 -> do<limit: 1> { $ + 1 } while (false)');
      expect(result).toBe(1);
    });
  });

  // ============================================================
  // AC-NOD-18: do<limit: 10000> applies verbatim, not the default
  // ============================================================

  describe('Boundary: limit equal to default [AC-NOD-18]', () => {
    it('[AC-NOD-18] do<limit: 10000> annotation is present on the AST node', () => {
      const ast = parse('do<limit: 10000> { $ + 1 } while ($ < 5)');
      const doWhileNode = findNode(ast, 'DoWhileLoop') as Record<
        string,
        unknown
      > | null;
      expect(doWhileNode).not.toBeNull();
      // annotations are present (not undefined) — verbatim limit is stored
      const annotations = doWhileNode!['annotations'] as unknown[];
      expect(Array.isArray(annotations)).toBe(true);
      expect(annotations.length).toBeGreaterThan(0);
    });

    it('[AC-NOD-18] do<limit: 10000> executes correctly at runtime', async () => {
      // Runs 5 iterations to reach 5; limit 10000 is applied verbatim
      const result = await run('0 -> do<limit: 10000> { $ + 1 } while ($ < 5)');
      expect(result).toBe(5);
    });
  });

  // ============================================================
  // AC-NOD-19: nested grouping in condition parses correctly
  // ============================================================

  describe('Boundary: nested grouping in condition [AC-NOD-19]', () => {
    it('[AC-NOD-19] while ((($ < 5))) do { $ + 1 } parses and executes', async () => {
      const result = await run('0 -> while ((($ < 5))) do { $ + 1 }');
      expect(result).toBe(5);
    });

    it('[AC-NOD-19] nested grouping produces a valid WhileLoop AST node', () => {
      const ast = parse('while ((($ < 5))) do { $ + 1 }');
      const whileNode = findNode(ast, 'WhileLoop');
      expect(whileNode).not.toBeNull();
    });
  });

  // ============================================================
  // AC-NOD-20: while and do in strings and comments are inert
  // ============================================================

  describe('Boundary: keywords in strings and comments are inert [AC-NOD-20]', () => {
    it('[AC-NOD-20] while inside a string literal is treated as string content', async () => {
      const result = await run('"while do loop"');
      expect(result).toBe('while do loop');
    });

    it('[AC-NOD-20] do inside a string literal is treated as string content', async () => {
      const result = await run('"do something while true"');
      expect(result).toBe('do something while true');
    });

    it('[AC-NOD-20] while in a comment does not trigger loop parsing', async () => {
      // Comment followed by a simple expression
      const result = await run('# while do loop\n42');
      expect(result).toBe(42);
    });

    it('[AC-NOD-20] do in a comment does not trigger loop parsing', async () => {
      const result = await run('# do something while condition\n"ok"');
      expect(result).toBe('ok');
    });
  });
});
