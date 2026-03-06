/**
 * Rill Language Tests: Keyword-Prefixed Collection Literals
 * Tests for list[], dict[], tuple[], ordered[] keyword forms.
 *
 * Feature: Phase 1 keyword-prefixed literals (tasks 1.1-1.6)
 * Note: formatValue output uses legacy format (list(...) etc.) until task 2.1.
 * Tests use structural value comparison where possible.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError, isTuple } from '@rcrsr/rill';

import { run, runWithContext } from '../helpers/runtime.js';

// Helper to check if a value is an ordered collection
function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

// Helper to get ordered entries
function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}

describe('Rill Language: Keyword-Prefixed Collection Literals', () => {
  // ============================================================
  // list[] LITERALS
  // ============================================================

  describe('list[] literals', () => {
    it('evaluates list[1, 2, 3] to list containing integers (AC-1)', async () => {
      const result = await run('list[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('evaluates list[] to empty list (AC-5)', async () => {
      const result = await run('list[]');
      expect(result).toEqual([]);
    });

    it('evaluates list with string elements', async () => {
      const result = await run('list["a", "b", "c"]');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('evaluates list with boolean elements', async () => {
      const result = await run('list[true, false]');
      expect(result).toEqual([true, false]);
    });

    it('evaluates list with variable element', async () => {
      const result = await run('42 => $x\nlist[$x, 1]');
      expect(result).toEqual([42, 1]);
    });

    it('is valid in all positions that accept a list (AC-40)', async () => {
      // list[] can be captured, passed through pipe, and used as a value
      const { context } = await runWithContext('list[1, 2, 3] => $captured');
      expect(context.variables.get('captured')).toEqual([1, 2, 3]);
    });

    it('list is distinct from tuple (AC-44)', async () => {
      const listResult = await run('list[1, 2]');
      const tupleResult = await run('tuple[1, 2]');
      expect(Array.isArray(listResult)).toBe(true);
      expect(isTuple(listResult)).toBe(false);
      expect(isTuple(tupleResult)).toBe(true);
    });
  });

  // ============================================================
  // dict[] LITERALS
  // ============================================================

  describe('dict[] literals', () => {
    it('evaluates dict[a: 1, b: 2] to dict with keys a and b (AC-2)', async () => {
      const result = await run('dict[a: 1, b: 2]');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('evaluates dict[] to empty dict (AC-5)', async () => {
      const result = await run('dict[]');
      expect(result).toEqual({});
    });

    it('evaluates dict with string values', async () => {
      const result = await run('dict[name: "Alice", city: "NYC"]');
      expect(result).toEqual({ name: 'Alice', city: 'NYC' });
    });

    it('allows field access on dict literal result', async () => {
      const result = await run('dict[a: 10, b: 20] => $d\n$d.a');
      expect(result).toBe(10);
    });
  });

  // ============================================================
  // tuple[] LITERALS
  // ============================================================

  describe('tuple[] literals', () => {
    it('evaluates tuple[1, "hello", true] to mixed-type tuple (AC-3)', async () => {
      const result = await run('tuple[1, "hello", true]');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 'hello', true]);
    });

    it('evaluates tuple[] to empty tuple (AC-5 / AC-44)', async () => {
      const result = await run('tuple[]');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([]);
    });

    it('tuple is distinct from list (AC-44)', async () => {
      const listResult = await run('list[1, 2]');
      const tupleResult = await run('tuple[1, 2]');
      expect(isTuple(tupleResult)).toBe(true);
      expect(isTuple(listResult)).toBe(false);
    });

    it('preserves mixed types in tuple', async () => {
      const result = await run('tuple[42, "text", false]');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries[0]).toBe(42);
      expect(tupleResult.entries[1]).toBe('text');
      expect(tupleResult.entries[2]).toBe(false);
    });
  });

  // ============================================================
  // ordered[] LITERALS
  // ============================================================

  describe('ordered[] literals', () => {
    it('evaluates ordered[a: 1, b: 2] preserving key order (AC-4)', async () => {
      const result = await run('ordered[a: 1, b: 2]');
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('evaluates ordered[] to empty ordered (AC-5 / AC-45)', async () => {
      const result = await run('ordered[]');
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toEqual([]);
    });

    it('ordered is distinct from dict (AC-45)', async () => {
      const dictResult = await run('dict[a: 1]');
      const orderedResult = await run('ordered[a: 1]');
      expect(isOrdered(dictResult)).toBe(false);
      expect(isOrdered(orderedResult)).toBe(true);
    });

    it('preserves insertion order for ordered literal', async () => {
      const result = await run('ordered[z: 3, a: 1, m: 2]');
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries[0]![0]).toBe('z');
      expect(entries[1]![0]).toBe('a');
      expect(entries[2]![0]).toBe('m');
    });
  });

  // ============================================================
  // SPREAD IN list[] (AC-6, AC-46)
  // ============================================================

  describe('spread in list[] literals (AC-6, AC-46)', () => {
    it('spreads $other and appends 3 (AC-6)', async () => {
      const result = await run('list[1, 2] => $other\nlist[...$other, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('spreads empty list producing empty result (AC-46)', async () => {
      const result = await run('list[] => $empty\nlist[...$empty]');
      expect(result).toEqual([]);
    });

    it('spreads multiple variables', async () => {
      const result = await run(
        'list[1, 2] => $a\nlist[3, 4] => $b\nlist[...$a, ...$b]'
      );
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it('spreads and adds elements', async () => {
      const result = await run('list[1, 2] => $a\nlist[0, ...$a, 3]');
      expect(result).toEqual([0, 1, 2, 3]);
    });
  });

  // ============================================================
  // PARSE ERRORS (EC-2, EC-3, EC-4)
  // ============================================================

  describe('parse errors for malformed literals', () => {
    it('throws ParseError for unclosed list[ (EC-2)', () => {
      expect(() => parse('list[1, 2')).toThrow(ParseError);
    });

    it('throws ParseError for dict[ entry without key: value (EC-3)', () => {
      expect(() => parse('dict[1]')).toThrow(ParseError);
    });

    it('throws ParseError for tuple[ with key: value pair (EC-4)', () => {
      expect(() => parse('tuple[a: 1, b: 2]')).toThrow(ParseError);
    });

    it('throws ParseError for unclosed dict[', () => {
      expect(() => parse('dict[a: 1')).toThrow(ParseError);
    });

    it('throws ParseError for unclosed tuple[', () => {
      expect(() => parse('tuple[1, 2')).toThrow(ParseError);
    });

    it('throws ParseError for unclosed ordered[', () => {
      expect(() => parse('ordered[a: 1')).toThrow(ParseError);
    });
  });

  // ============================================================
  // WHITESPACE ADJACENCY AND BARE BRACKET ERRORS (AC-27, AC-35, EC-1, EC-5)
  // ============================================================

  describe('whitespace adjacency and bare bracket errors', () => {
    it('throws ParseError with errorId RILL-P007 for list with whitespace before bracket (EC-1/AC-27)', () => {
      let err: unknown;
      try {
        parse('list [1, 2]');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParseError);
      expect(err).toHaveProperty('errorId', 'RILL-P007');
    });

    it('throws ParseError with errorId RILL-P007 for ordered with whitespace before bracket (EC-5)', () => {
      let err: unknown;
      try {
        parse('ordered [1, 2]');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParseError);
      expect(err).toHaveProperty('errorId', 'RILL-P007');
    });
  });
});
