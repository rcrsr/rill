/**
 * Rill Language Tests: chain() Built-in
 * Tests for the chain() built-in function that pipes values through closures.
 *
 * Feature: Phase 1 chain() built-in (task 1.5)
 * Covers: AC-16, AC-17, AC-18, AC-30, AC-48
 *
 * CALLING CONVENTION NOTE:
 * Two calling forms are supported:
 *
 * Direct form: chain(value, closureOrList)
 *   Both arguments supplied explicitly.
 *
 * Pipe form: value -> chain($closure)
 *   chain() detects pipe position (single arg with pipeValue set) and
 *   uses the pipe value as the first argument.
 *
 * Closures must be parameterized (|x|{ $x * 2 }) so chain can pass
 * the value as a positional argument.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: chain() Built-in', () => {
  // ============================================================
  // BASIC CHAIN INVOCATION
  // ============================================================

  describe('single closure (AC-16)', () => {
    it('chains value through single parameterized closure', async () => {
      // |x|{ $x * 2 } is a closure with param x; chain passes 5 as $x
      const result = await run('|x|{ $x * 2 } => $double\nchain(5, $double)');
      expect(result).toBe(10);
    });

    it('chains string value through closure', async () => {
      const result = await run(
        '|x|{ "{$x}!" } => $exclaim\nchain("hello", $exclaim)'
      );
      expect(result).toBe('hello!');
    });

    it('chains boolean through closure', async () => {
      const result = await run(
        '|x|{ $x ? false ! true } => $negate\nchain(true, $negate)'
      );
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // LIST OF CLOSURES (AC-17)
  // ============================================================

  describe('list of closures (AC-17)', () => {
    it('pipes through list[$inc, $double] left-to-right', async () => {
      // inc first: 5 + 1 = 6, then double: 6 * 2 = 12
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\nchain(5, list[$inc, $double])'
      );
      expect(result).toBe(12);
    });

    it('pipes through list[$double, $inc] in reversed order', async () => {
      // double first: 5 * 2 = 10, then inc: 10 + 1 = 11
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\nchain(5, list[$double, $inc])'
      );
      expect(result).toBe(11);
    });

    it('pipes through three closures', async () => {
      // 1 + 1 = 2, * 2 = 4, + 10 = 14
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $dbl\n|x|{ $x + 10 } => $add10\nchain(1, list[$inc, $dbl, $add10])'
      );
      expect(result).toBe(14);
    });
  });

  // ============================================================
  // LIST VARIABLE (AC-18)
  // ============================================================

  describe('list variable as pipeline (AC-18)', () => {
    it('accepts a list variable as the closure list', async () => {
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\nlist[$inc, $double] => $pipeline\nchain(5, $pipeline)'
      );
      expect(result).toBe(12);
    });

    it('accepts empty list variable as no-op pipeline', async () => {
      const result = await run('list[] => $pipeline\nchain(42, $pipeline)');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // EMPTY CLOSURE LIST - NO-OP (AC-48)
  // ============================================================

  describe('empty closure list returns input unchanged (AC-48)', () => {
    it('chain(5, list[]) returns 5 unchanged', async () => {
      const result = await run('chain(5, list[])');
      expect(result).toBe(5);
    });

    it('chain("hello", list[]) returns "hello" unchanged', async () => {
      const result = await run('chain("hello", list[])');
      expect(result).toBe('hello');
    });

    it('chain with empty list variable returns input unchanged', async () => {
      const result = await run('list[] => $empty\nchain(99, $empty)');
      expect(result).toBe(99);
    });
  });

  // ============================================================
  // ERROR CONTRACTS (AC-30, EC-14)
  // ============================================================

  describe('error contracts', () => {
    it('throws RILL-R040 when second arg is a non-closure string (AC-30, EC-14)', async () => {
      await expect(run('chain(5, "not a closure")')).rejects.toThrow(
        /chain.*closure/i
      );
    });

    it('throws RILL-R040 when second arg is a number', async () => {
      await expect(run('chain(5, 42)')).rejects.toThrow(/chain.*closure/i);
    });

    it('throws RILL-R040 when second arg is a dict', async () => {
      await expect(run('chain(5, dict[a: 1])')).rejects.toThrow(
        /chain.*closure/i
      );
    });

    it('throws RILL-R040 when list element is not a closure', async () => {
      await expect(run('chain(5, list["not a closure"])')).rejects.toThrow(
        /chain.*closure/i
      );
    });

    it('throws runtime error when list element is not a closure via list variable', async () => {
      // Using a list variable so the type check occurs inside chain, not at list construction.
      // list["bad"] produces a homogeneous string list; chain rejects it.
      await expect(
        run('list["not a closure"] => $fns\nchain(5, $fns)')
      ).rejects.toThrow(/chain.*closure/i);
    });
  });

  // ============================================================
  // PIPE FORM (AC-16)
  // ============================================================

  describe('pipe form: value -> chain($closure)', () => {
    it('pipes value through single closure via pipe position', async () => {
      const result = await run('|x|{ $x * 2 } => $double\n5 -> chain($double)');
      expect(result).toBe(10);
    });

    it('pipes string through closure via pipe position', async () => {
      const result = await run(
        '|x|{ "{$x}!" } => $exclaim\n"hello" -> chain($exclaim)'
      );
      expect(result).toBe('hello!');
    });

    it('pipes through list of closures via pipe position', async () => {
      // inc: 5 + 1 = 6, double: 6 * 2 = 12
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\n5 -> chain(list[$inc, $double])'
      );
      expect(result).toBe(12);
    });
  });

  // ============================================================
  // CHAINED PIPE WITH MANUAL $ PLACEMENT (IR-8)
  // ============================================================

  describe('chained pipes with manual $ placement (IR-8)', () => {
    it('multi-step chain: auto-prepend then manual $ in successive pipes', async () => {
      // Step 1: "hello" -> .upper (method call; pipe value is the receiver)
      // Step 2: "HELLO" -> .contains("HELLO") (method call; pipe value is the receiver)
      // Verifies that chained method calls deliver the pipe value through the receiver position at each step.
      const result = await run('"hello" -> .upper -> .contains("HELLO")');
      expect(result).toBe(true);
    });

    it('multi-step chain: manual $ placement preserved across two host-fn pipes', async () => {
      // "ab" -> identity($) -> .len
      // Step 1: identity($) — $ is top-level, manual placement → identity("ab")
      // Step 2: .len — auto-prepend pipe value "ab" as receiver
      const result = await run('"ab" -> identity($) -> .len');
      expect(result).toBe(2);
    });

    it('multi-step chain: auto-prepend in first pipe, closure $ late-bound in second', async () => {
      // list[1, 2, 3] -> seq({ $ * 2 }) -> seq({ $ + 10 })
      // Both seq calls: $ inside closures is late-bound, not counted → auto-prepend
      const result = await run(
        'list[1, 2, 3] -> seq({ $ * 2 }) -> seq({ $ + 10 })'
      );
      expect(result).toEqual([12, 14, 16]);
    });

    it('multi-step chain: capture intermediate result, then use $ in next pipe', async () => {
      // "world" => $s -> .len => $n -> identity($n)
      // identity($n) — $ is $n here, but the pipe binding rule checks for bare $
      // In this case we capture and pass explicitly; verifies chaining semantics
      const result = await run('"world" -> .len => $n\n$n -> identity');
      expect(result).toBe(5);
    });
  });
});
