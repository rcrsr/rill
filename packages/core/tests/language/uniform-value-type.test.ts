/**
 * Rill Language Tests: Uniform Value Type Assertions
 *
 * Tests for uniform value type syntax on dict, ordered, and tuple:
 * - dict(closure), ordered(closure), tuple(number) assertions
 * - Nested uniform types: dict(list(number))
 * - Type inference cascade for lists of dicts
 * - Error contracts for mixed/invalid args
 *
 * AC = Acceptance Criterion, EC = Error Contract from the
 * dict-uniform-value-type spec.
 *
 * Implementation notes:
 * - Spec uses {key: val} pseudocode; rill dict literals use [key: val]
 *   or dict[key: val] syntax.
 * - Zero-param closures in dict values use ||{ body } syntax.
 * - RuntimeError stores error code in errorId, not code.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Uniform Value Type Assertions', () => {
  // ============================================================
  // Happy path assertions [AC-1 through AC-8]
  // ============================================================

  describe('Happy path uniform assertions', () => {
    it('dict(closure) passes when all values are callable [AC-1]', async () => {
      // All values must be closures for dict(closure) to pass
      const result = await run(
        '[name: ||{ "a" }, run: ||{ 1 }] -> :>dict(closure)'
      );
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('run');
    });

    it('ordered(closure) passes when all values are callable [AC-2]', async () => {
      const result = await run(
        'ordered[name: ||{ "a" }, run: ||{ 1 }] -> :>ordered(closure)'
      );
      expect(result).toHaveProperty('entries');
    });

    it('tuple(number) passes when all entries are numbers [AC-3]', async () => {
      const result = await run('tuple[1, 2, 3] -> :>tuple(number)');
      expect(result).toEqual({
        __rill_tuple: true,
        entries: [1, 2, 3],
      });
    });

    it('dict(list(number)) passes with nested uniform types [AC-4]', async () => {
      const result = await run(
        '[a: list[1, 2], b: list[3, 4]] -> :>dict(list(number))'
      );
      expect(result).toEqual({ a: [1, 2], b: [3, 4] });
    });

    it('dict() bare type matches any dict [AC-5]', async () => {
      // :>dict (bare, no parens) passes any dict through unchanged
      const result = await run('[a: 1, b: "s"] -> :>dict');
      expect(result).toEqual({ a: 1, b: 's' });
    });

    it('list of dicts infers list(dict(number)) via uniform merge [AC-6]', async () => {
      const sig = await run('list[dict[a: 1], dict[b: 2]].^type.signature');
      expect(sig).toBe('list(dict(number))');
    });

    it('structural dict assertion unchanged [AC-7]', async () => {
      const result = await run(
        '[name: "a", age: 1] -> :>dict(name: string, age: number)'
      );
      expect(result).toEqual({ name: 'a', age: 1 });
    });

    it('multi-element structural tuple unchanged [AC-8]', async () => {
      const result = await run('tuple["a", 1] -> :>tuple(string, number)');
      expect(result).toEqual({
        __rill_tuple: true,
        entries: ['a', 1],
      });
    });
  });

  // ============================================================
  // Error cases [AC-10 through AC-14, EC-1 through EC-3]
  // ============================================================

  describe('Error cases for uniform assertions', () => {
    it('string value fails dict(closure) with RILL-R004 [AC-10, EC-3]', async () => {
      await expect(
        run('[name: "a", run: "b"] -> :>dict(closure)')
      ).rejects.toThrow('Type assertion failed');
    });

    it('dict(closure, name: string) halts with RILL-R004 for mixed args [AC-11, EC-1]', async () => {
      await expect(run('dict(closure, name: string)')).rejects.toThrow(
        'dict() cannot mix positional and named arguments'
      );
    });

    it('ordered(closure, name: string) halts with RILL-R004 for mixed args [AC-12, EC-1]', async () => {
      await expect(run('ordered(closure, name: string)')).rejects.toThrow(
        'ordered() cannot mix positional and named arguments'
      );
    });

    it('tuple[1, "a"] fails tuple(number) with RILL-R004 [AC-13, EC-3]', async () => {
      await expect(run('tuple[1, "a"] -> :>tuple(number)')).rejects.toThrow(
        'Type assertion failed'
      );
    });

    it('dict(string, number) halts with RILL-R004 for 2 positional args [AC-14, EC-2]', async () => {
      await expect(run('dict(string, number)')).rejects.toThrow(
        'dict() requires exactly 1 positional type argument'
      );
    });
  });

  // ============================================================
  // Error message format [AC-9, EC-3]
  // ============================================================

  describe('Error message format', () => {
    it('failed dict(closure) assertion message contains "expected dict(closure)" [AC-9, EC-3]', async () => {
      await expect(
        run('[name: "a", run: "b"] -> :>dict(closure)')
      ).rejects.toThrow('expected dict(closure)');
    });

    it('failed dict(closure) assertion uses RILL-R004 error code [EC-3]', async () => {
      try {
        await run('[name: "a", run: "b"] -> :>dict(closure)');
        expect.unreachable('should have thrown');
      } catch (e: unknown) {
        expect((e as { errorId?: string }).errorId).toBe('RILL-R004');
      }
    });
  });

  // ============================================================
  // Boundary conditions [AC-15 through AC-20]
  // ============================================================

  describe('Boundary conditions', () => {
    it('empty dict passes dict(closure) [AC-15]', async () => {
      const result = await run('dict[] -> :>dict(closure)');
      expect(result).toEqual({});
    });

    it('empty tuple passes tuple(number) [AC-16]', async () => {
      const result = await run('tuple[] -> :>tuple(number)');
      expect(result).toEqual({
        __rill_tuple: true,
        entries: [],
      });
    });

    it('empty ordered passes ordered(number) [AC-17]', async () => {
      const result = await run('ordered[] -> :>ordered(number)');
      expect(result).toHaveProperty('entries');
      expect((result as { entries: unknown[] }).entries).toHaveLength(0);
    });

    it('conflicting dict value types infer list(dict) bare [AC-18]', async () => {
      const sig = await run('list[dict[a: 1], dict[a: "s"]].^type.signature');
      expect(sig).toBe('list(dict)');
    });

    it('uniform dict values infer list(dict(number)) via cascade [AC-19]', async () => {
      const sig = await run('list[dict[a: 1], dict[b: 2]].^type.signature');
      expect(sig).toBe('list(dict(number))');
    });

    it('dynamic key extract from dict(closure) carries no uniform type [AC-20]', async () => {
      // Auto-invoking closures (||{ body }) resolve to their return value
      // on access. The extracted value is a plain value, not a closure
      // with uniform type metadata.
      const script = `
        dict[run: ||{ 42 }] -> :>dict(closure) => $d
        "run" => $key
        $d.$key
      `;
      const result = await run(script);
      // Dynamic key extraction auto-invokes the closure, returning 42
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // Non-type-value arg error [EC-4]
  // ============================================================

  describe('Non-type-value positional arg', () => {
    it('dict(42) non-type positional arg — fails at parse time [EC-4]', async () => {
      // parseFieldArgList uses parseTypeRef; numeric literals are not valid type names.
      await expect(run('dict(42)')).rejects.toThrow('Expected type name');
    });
  });
});
