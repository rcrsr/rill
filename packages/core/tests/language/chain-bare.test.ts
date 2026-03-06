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
    it('pipes through [$inc, $double] left-to-right', async () => {
      // inc first: 5 + 1 = 6, then double: 6 * 2 = 12
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\nchain(5, [$inc, $double])'
      );
      expect(result).toBe(12);
    });

    it('pipes through [$double, $inc] in reversed order', async () => {
      // double first: 5 * 2 = 10, then inc: 10 + 1 = 11
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\nchain(5, [$double, $inc])'
      );
      expect(result).toBe(11);
    });

    it('pipes through three closures', async () => {
      // 1 + 1 = 2, * 2 = 4, + 10 = 14
      const result = await run(
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $dbl\n|x|{ $x + 10 } => $add10\nchain(1, [$inc, $dbl, $add10])'
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
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\n[$inc, $double] => $pipeline\nchain(5, $pipeline)'
      );
      expect(result).toBe(12);
    });

    it('accepts empty list variable as no-op pipeline', async () => {
      const result = await run('[] => $pipeline\nchain(42, $pipeline)');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // EMPTY CLOSURE LIST - NO-OP (AC-48)
  // ============================================================

  describe('empty closure list returns input unchanged (AC-48)', () => {
    it('chain(5, []) returns 5 unchanged', async () => {
      const result = await run('chain(5, [])');
      expect(result).toBe(5);
    });

    it('chain("hello", []) returns "hello" unchanged', async () => {
      const result = await run('chain("hello", [])');
      expect(result).toBe('hello');
    });

    it('chain with empty list variable returns input unchanged', async () => {
      const result = await run('[] => $empty\nchain(99, $empty)');
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
      await expect(run('chain(5, [a: 1])')).rejects.toThrow(
        /chain.*closure/i
      );
    });

    it('throws RILL-R040 when list element is not a closure', async () => {
      await expect(run('chain(5, ["not a closure"])')).rejects.toThrow(
        /chain.*closure/i
      );
    });

    it('throws runtime error when list element is not a closure via list variable', async () => {
      // Using a list variable so the type check occurs inside chain, not at list construction.
      // ["bad"] produces a homogeneous string list; chain rejects it.
      await expect(
        run('["not a closure"] => $fns\nchain(5, $fns)')
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
        '|x|{ $x + 1 } => $inc\n|x|{ $x * 2 } => $double\n5 -> chain([$inc, $double])'
      );
      expect(result).toBe(12);
    });
  });
});
