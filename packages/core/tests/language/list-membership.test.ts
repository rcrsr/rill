/**
 * Rill Runtime Tests: List Membership Methods
 * Tests for .has(), .has_any(), .has_all() methods
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: List Membership Methods', () => {
  describe('.has()', () => {
    describe('basic functionality', () => {
      it('returns true when value exists in list (AC-12)', async () => {
        expect(await run('list[1, 2, 3] -> .has(2)')).toBe(true);
      });

      it('returns false when value does not exist (AC-13)', async () => {
        expect(await run('list[1, 2, 3] -> .has(5)')).toBe(false);
      });

      it('returns false for empty list (AC-14)', async () => {
        expect(await run('list[] -> .has(1)')).toBe(false);
      });

      it('handles single-element list', async () => {
        expect(await run('list[42] -> .has(42)')).toBe(true);
      });

      it('finds value at start of list', async () => {
        expect(await run('list[1, 2, 3] -> .has(1)')).toBe(true);
      });

      it('finds value at end of list', async () => {
        expect(await run('list[1, 2, 3] -> .has(3)')).toBe(true);
      });
    });

    describe('deep equality', () => {
      it('uses deep equality for dicts (AC-15)', async () => {
        expect(
          await run('list[dict[a: 1], dict[a: 2]] -> .has(dict[a: 1])')
        ).toBe(true);
      });

      it('uses deep equality for nested dicts', async () => {
        expect(
          await run(
            'list[dict[x: dict[y: 1]], dict[x: dict[y: 2]]] -> .has(dict[x: dict[y: 1]])'
          )
        ).toBe(true);
      });

      it('uses deep equality for lists', async () => {
        expect(
          await run('list[list[1, 2], list[3, 4]] -> .has(list[1, 2])')
        ).toBe(true);
      });

      it('returns false for different dict values', async () => {
        expect(
          await run('list[dict[a: 1], dict[a: 2]] -> .has(dict[a: 3])')
        ).toBe(false);
      });

      it('returns false for key not in list', async () => {
        expect(
          await run('list[dict[a: 1], dict[a: 2]] -> .has(dict[b: 1])')
        ).toBe(false);
      });
    });

    describe('type safety', () => {
      it('returns false for type mismatch (AC-18)', async () => {
        expect(await run('list[1, 2, 3] -> .has("2")')).toBe(false);
      });

      it('distinguishes string from number', async () => {
        expect(await run('list["1", "2", "3"] -> .has(1)')).toBe(false);
      });

      it('finds matching string type', async () => {
        expect(await run('list["1", "2", "3"] -> .has("2")')).toBe(true);
      });

      it('distinguishes true from 1', async () => {
        expect(await run('list[true, false] -> .has(1)')).toBe(false);
      });

      it('distinguishes false from 0', async () => {
        expect(await run('list[true, false] -> .has(0)')).toBe(false);
      });
    });

    describe('error handling', () => {
      it('throws for non-list receiver (EC-4, AC-19)', async () => {
        await expect(run('"not a list" -> .has(1)')).rejects.toThrow(
          'has() requires list receiver, got string'
        );
      });

      it('throws for number receiver', async () => {
        await expect(run('42 -> .has(1)')).rejects.toThrow(
          'has() requires list receiver, got number'
        );
      });

      it('throws for dict receiver', async () => {
        await expect(run('dict[a: 1, b: 2] -> .has(1)')).rejects.toThrow(
          'has() requires list receiver, got dict'
        );
      });

      it('throws for boolean receiver', async () => {
        await expect(run('true -> .has(1)')).rejects.toThrow(
          'has() requires list receiver, got bool'
        );
      });

      it('throws when called without arguments (EC-5, AC-20)', async () => {
        await expect(run('list[1, 2, 3] -> .has()')).rejects.toThrow(
          'has() expects 1 argument, got 0'
        );
      });

      it('throws when called with too many arguments', async () => {
        await expect(run('list[1, 2, 3] -> .has(1, 2)')).rejects.toThrow(
          'has() expects 1 argument, got 2'
        );
      });
    });

    describe('edge cases', () => {
      it('finds string in string list', async () => {
        expect(await run('list["one", "two", "three"] -> .has("two")')).toBe(
          true
        );
      });

      it('finds boolean in bool list', async () => {
        expect(await run('list[true, false] -> .has(true)')).toBe(true);
      });

      it('handles list with duplicate values', async () => {
        expect(await run('list[1, 2, 2, 3] -> .has(2)')).toBe(true);
      });

      it('handles empty string search', async () => {
        expect(await run('list["", "a", "b"] -> .has("")')).toBe(true);
      });

      it('handles zero value', async () => {
        expect(await run('list[0, 1, 2] -> .has(0)')).toBe(true);
      });
    });
  });

  describe('.has_any()', () => {
    describe('basic functionality', () => {
      it('returns true when at least one candidate exists (AC-16)', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[2, 5])')).toBe(true);
      });

      it('returns true when all candidates exist', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[1, 2])')).toBe(true);
      });

      it('returns false when no candidates exist', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[4, 5])')).toBe(false);
      });

      it('returns false for empty list (AC-22)', async () => {
        expect(await run('list[] -> .has_any(list[1])')).toBe(false);
      });

      it('returns false for empty candidates on non-empty list', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[])')).toBe(false);
      });

      it('returns false for both empty', async () => {
        expect(await run('list[] -> .has_any(list[])')).toBe(false);
      });

      it('returns true when first candidate matches', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[1, 99, 100])')).toBe(
          true
        );
      });

      it('returns true when last candidate matches', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[99, 100, 3])')).toBe(
          true
        );
      });
    });

    describe('deep equality', () => {
      it('uses deep equality for dict candidates', async () => {
        expect(
          await run(
            'list[dict[a: 1], dict[a: 2]] -> .has_any(list[dict[a: 1], dict[a: 3]])'
          )
        ).toBe(true);
      });

      it('uses deep equality for list candidates', async () => {
        expect(
          await run(
            'list[list[1, 2], list[3, 4]] -> .has_any(list[list[1, 2], list[5, 6]])'
          )
        ).toBe(true);
      });

      it('returns false when no candidates match deeply', async () => {
        expect(
          await run(
            'list[dict[a: 1], dict[a: 2]] -> .has_any(list[dict[a: 3], dict[a: 4]])'
          )
        ).toBe(false);
      });
    });

    describe('type safety', () => {
      it('respects type differences', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list["1", "2"])')).toBe(
          false
        );
      });

      it('finds matching types', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[4, 2, 5])')).toBe(
          true
        );
      });
    });

    describe('error handling', () => {
      it('throws for non-list receiver (EC-6)', async () => {
        await expect(run('"not a list" -> .has_any(list[1])')).rejects.toThrow(
          'has_any() requires list receiver, got string'
        );
      });

      it('throws for number receiver', async () => {
        await expect(run('42 -> .has_any(list[1])')).rejects.toThrow(
          'has_any() requires list receiver, got number'
        );
      });

      it('throws for non-list argument (EC-7, AC-21)', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_any("not a list")')
        ).rejects.toThrow('has_any() expects list argument, got string');
      });

      it('throws for number argument', async () => {
        await expect(run('list[1, 2, 3] -> .has_any(42)')).rejects.toThrow(
          'has_any() expects list argument, got number'
        );
      });

      it('throws for dict argument', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_any(dict[a: 1])')
        ).rejects.toThrow('has_any() expects list argument, got dict');
      });

      it('throws when called without arguments (EC-8)', async () => {
        await expect(run('list[1, 2, 3] -> .has_any()')).rejects.toThrow(
          'has_any() expects 1 argument, got 0'
        );
      });

      it('throws when called with too many arguments', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_any(list[1], list[2])')
        ).rejects.toThrow('has_any() expects 1 argument, got 2');
      });
    });

    describe('edge cases', () => {
      it('handles homogeneous candidates', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[5, 2, 6])')).toBe(
          true
        );
      });

      it('handles single-candidate list', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[2])')).toBe(true);
      });

      it('handles duplicate candidates', async () => {
        expect(await run('list[1, 2, 3] -> .has_any(list[2, 2, 2])')).toBe(
          true
        );
      });
    });
  });

  describe('.has_all()', () => {
    describe('basic functionality', () => {
      it('returns true when all candidates exist (AC-17)', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[1, 2])')).toBe(true);
      });

      it('returns false when some candidates missing', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[1, 4])')).toBe(false);
      });

      it('returns true for empty candidates (AC-23)', async () => {
        expect(await run('list[1, 2] -> .has_all(list[])')).toBe(true);
      });

      it('returns true for empty candidates on empty list', async () => {
        expect(await run('list[] -> .has_all(list[])')).toBe(true);
      });

      it('returns false when any candidate missing', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[1, 2, 4])')).toBe(
          false
        );
      });

      it('returns true when all candidates present', async () => {
        expect(
          await run('list[1, 2, 3, 4, 5] -> .has_all(list[1, 3, 5])')
        ).toBe(true);
      });

      it('returns false for non-empty candidates on empty list', async () => {
        expect(await run('list[] -> .has_all(list[1])')).toBe(false);
      });

      it('returns true for single matching candidate', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[2])')).toBe(true);
      });
    });

    describe('deep equality', () => {
      it('uses deep equality for dict candidates', async () => {
        expect(
          await run(
            'list[dict[a: 1], dict[a: 2], dict[a: 3]] -> .has_all(list[dict[a: 1], dict[a: 2]])'
          )
        ).toBe(true);
      });

      it('uses deep equality for list candidates', async () => {
        expect(
          await run(
            'list[list[1, 2], list[3, 4], list[5, 6]] -> .has_all(list[list[1, 2], list[5, 6]])'
          )
        ).toBe(true);
      });

      it('returns false when not all candidates match deeply', async () => {
        expect(
          await run(
            'list[dict[a: 1], dict[a: 2]] -> .has_all(list[dict[a: 1], dict[a: 3]])'
          )
        ).toBe(false);
      });
    });

    describe('type safety', () => {
      it('requires all types to match', async () => {
        expect(
          await run('list["1", "2", "3"] -> .has_all(list["1", "2"])')
        ).toBe(true);
      });
    });

    describe('error handling', () => {
      it('throws for non-list receiver (EC-9)', async () => {
        await expect(run('"not a list" -> .has_all(list[1])')).rejects.toThrow(
          'has_all() requires list receiver, got string'
        );
      });

      it('throws for number receiver', async () => {
        await expect(run('42 -> .has_all(list[1])')).rejects.toThrow(
          'has_all() requires list receiver, got number'
        );
      });

      it('throws for non-list argument (EC-10)', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_all("not a list")')
        ).rejects.toThrow('has_all() expects list argument, got string');
      });

      it('throws for number argument', async () => {
        await expect(run('list[1, 2, 3] -> .has_all(42)')).rejects.toThrow(
          'has_all() expects list argument, got number'
        );
      });

      it('throws for dict argument', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_all(dict[a: 1])')
        ).rejects.toThrow('has_all() expects list argument, got dict');
      });

      it('throws when called without arguments (EC-11)', async () => {
        await expect(run('list[1, 2, 3] -> .has_all()')).rejects.toThrow(
          'has_all() expects 1 argument, got 0'
        );
      });

      it('throws when called with too many arguments', async () => {
        await expect(
          run('list[1, 2, 3] -> .has_all(list[1], list[2])')
        ).rejects.toThrow('has_all() expects 1 argument, got 2');
      });
    });

    describe('edge cases', () => {
      it('handles homogeneous candidates requiring all', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[1, 2])')).toBe(true);
      });

      it('handles duplicate candidates', async () => {
        expect(await run('list[1, 2, 3] -> .has_all(list[2, 2, 2])')).toBe(
          true
        );
      });

      it('fails when duplicate value missing', async () => {
        expect(await run('list[1, 3] -> .has_all(list[2, 2])')).toBe(false);
      });
    });
  });

  describe('performance', () => {
    it('handles large list search efficiently (AC-24)', async () => {
      // Create a 1000-element list and search for a value
      const listExpr = `range(0, 1000) -> seq({ $ }) -> .has(999)`;
      const start = Date.now();
      const result = await run(listExpr);
      const duration = Date.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(150);
    });

    it('handles large list with has_any efficiently', async () => {
      const listExpr = `range(0, 1000) -> seq({ $ }) -> .has_any(list[500, 999])`;
      const start = Date.now();
      const result = await run(listExpr);
      const duration = Date.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(50);
    });

    it('handles large list with has_all efficiently', async () => {
      const listExpr = `range(0, 1000) -> seq({ $ }) -> .has_all(list[0, 500, 999])`;
      const start = Date.now();
      const result = await run(listExpr);
      const duration = Date.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(50);
    });
  });

  describe('integration with other features', () => {
    it('works in conditional expressions', async () => {
      expect(
        await run('list[1, 2, 3] -> .has(2) ? "found" ! "not found"')
      ).toBe('found');
    });

    it('works in pipe chains', async () => {
      expect(await run('list[1, 2, 3] -> .has(2) -> string')).toBe('true');
    });

    it('works with captured variables', async () => {
      const result = await run(`
        list[1, 2, 3] => $list
        2 => $value
        $list -> .has($value)
      `);
      expect(result).toBe(true);
    });

    it('chains multiple membership checks', async () => {
      expect(
        await run('(list[1, 2, 3] -> .has(2)) && (list[4, 5, 6] -> .has(5))')
      ).toBe(true);
    });

    it('works with map and filter results', async () => {
      expect(await run('list[1, 2, 3] -> fan({ $ * 2 }) -> .has(4)')).toBe(
        true
      );
    });
  });
});
