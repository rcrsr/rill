/**
 * Rill Language Tests: Parameterized destruct<> Type Annotations
 * Tests for type-annotated destructure patterns: destruct<$a:list(string)>,
 * destruct<$a:dict(name: string)>, and union types destruct<$a:string|number>.
 *
 * AC = Acceptance Criterion from the type-system-improvements spec.
 * BC = Backward Compatibility criterion.
 * EC = Error Contract.
 *
 * destruct<$var:type> binds an element of a list input to $var and validates
 * it against :type. The input must be a list with as many elements as pattern
 * variables. "list of strings" means the element bound to $a is list(string).
 *
 * Covers: AC-1, AC-2, AC-3, AC-35, AC-36, BC-6, BC-8, EC-3, EC-4
 */

import { describe, expect, it } from 'vitest';
import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Language: Parameterized destruct<> Type Annotations', () => {
  // ============================================================
  // AC-1: destruct<$a:list(string)> accepts list of strings
  // Input: a 1-element list where the element is list(string)
  // ============================================================

  describe('destruct<$a:list(string)> accepts list of strings (AC-1)', () => {
    it('binds list of strings to typed variable', async () => {
      const { context } = await runWithContext(
        'list[list["foo", "bar", "baz"]] -> destruct<$a:list(string)>'
      );
      expect(context.variables.get('a')).toEqual(['foo', 'bar', 'baz']);
    });

    it('returns the original outer list unchanged', async () => {
      const result = await run(
        'list[list["hello", "world"]] -> destruct<$a:list(string)>'
      );
      expect(result).toEqual([['hello', 'world']]);
    });

    it('accepts empty inner list for list(string) type', async () => {
      const { context } = await runWithContext(
        'list[list[]] -> destruct<$a:list(string)>'
      );
      expect(context.variables.get('a')).toEqual([]);
    });
  });

  // ============================================================
  // AC-2, EC-3: destruct<$a:list(string)> on list of numbers → RILL-R001
  // Input: a 1-element list where the element is list(number)
  // ============================================================

  describe('destruct<$a:list(string)> on list of numbers → RILL-R001 (AC-2, EC-3)', () => {
    it('throws RILL-R001 when element is list of numbers', async () => {
      await expect(
        run('list[list[1, 2, 3]] -> destruct<$a:list(string)>')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
    });

    it('error message names list(string) expected type (EC-3)', async () => {
      await expect(
        run('list[list[1, 2, 3]] -> destruct<$a:list(string)>')
      ).rejects.toThrow('list(string)');
    });
  });

  // ============================================================
  // AC-3: destruct<$a:dict(name: string)> accepts matching dict
  // Input: a 1-element list where the element is dict(name: string)
  // ============================================================

  describe('destruct<$a:dict(name: string)> accepts matching dict (AC-3)', () => {
    it('binds matching dict to typed variable', async () => {
      const { context } = await runWithContext(
        'list[dict[name: "alice"]] -> destruct<$a:dict(name: string)>'
      );
      expect(context.variables.get('a')).toEqual({ name: 'alice' });
    });

    it('returns the original outer list unchanged', async () => {
      const result = await run(
        'list[dict[name: "bob"]] -> destruct<$a:dict(name: string)>'
      );
      expect(result).toEqual([{ name: 'bob' }]);
    });

    it('throws RILL-R001 when dict field type does not match', async () => {
      await expect(
        run('list[dict[name: 42]] -> destruct<$a:dict(name: string)>')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
    });
  });

  // ============================================================
  // AC-35: destruct<$a:string|number> accepts string or number
  // Input: 1-element list with the value being string or number
  // ============================================================

  describe('destruct<$a:string|number> accepts string or number (AC-35)', () => {
    it('accepts string element', async () => {
      const { context } = await runWithContext(
        'list["hello"] -> destruct<$a:string|number>'
      );
      expect(context.variables.get('a')).toBe('hello');
    });

    it('accepts number element', async () => {
      const { context } = await runWithContext(
        'list[42] -> destruct<$a:string|number>'
      );
      expect(context.variables.get('a')).toBe(42);
    });

    it('returns the original list unchanged for string', async () => {
      const result = await run('list["test"] -> destruct<$a:string|number>');
      expect(result).toEqual(['test']);
    });

    it('returns the original list unchanged for number', async () => {
      const result = await run('list[99] -> destruct<$a:string|number>');
      expect(result).toEqual([99]);
    });
  });

  // ============================================================
  // AC-36, EC-4: destruct<$a:string|number> on bool → RILL-R001
  // ============================================================

  describe('destruct<$a:string|number> on bool → RILL-R001 (AC-36, EC-4)', () => {
    it('throws RILL-R001 when element is bool', async () => {
      await expect(
        run('list[true] -> destruct<$a:string|number>')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
    });

    it('error message names string|number expected type (EC-4)', async () => {
      await expect(
        run('list[true] -> destruct<$a:string|number>')
      ).rejects.toThrow('string|number');
    });

    it('error message names bool actual type (EC-4)', async () => {
      await expect(
        run('list[true] -> destruct<$a:string|number>')
      ).rejects.toThrow('bool');
    });
  });

  // ============================================================
  // BC-6: Simple destruct<$a:string> — identical to pre-change behavior
  // ============================================================

  describe('BC-6: Simple destruct<$a:string> backward compatibility', () => {
    it('accepts string element with :string annotation', async () => {
      const { context } = await runWithContext(
        'list["hello"] -> destruct<$a:string>'
      );
      expect(context.variables.get('a')).toBe('hello');
    });

    it('rejects number element with :string annotation', async () => {
      await expect(
        run('list[42] -> destruct<$a:string>')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
    });

    it('rejects bool element with :string annotation', async () => {
      await expect(
        run('list[true] -> destruct<$a:string>')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
    });

    it(':number annotation accepts number element', async () => {
      const { context } = await runWithContext(
        'list[99] -> destruct<$a:number>'
      );
      expect(context.variables.get('a')).toBe(99);
    });

    it('multi-variable destruct with type annotations', async () => {
      const { context } = await runWithContext(
        'list["hello", "world"] -> destruct<$a:string, $b:string>'
      );
      expect(context.variables.get('a')).toBe('hello');
      expect(context.variables.get('b')).toBe('world');
    });
  });

  // ============================================================
  // BC-8: typeRef: null — no type validation (basic destruct still works)
  // ============================================================

  describe('BC-8: destruct with no type annotation — no type validation', () => {
    it('accepts string element without annotation', async () => {
      const { context } = await runWithContext('list["hello"] -> destruct<$a>');
      expect(context.variables.get('a')).toBe('hello');
    });

    it('accepts number element without annotation', async () => {
      const { context } = await runWithContext('list[42] -> destruct<$a>');
      expect(context.variables.get('a')).toBe(42);
    });

    it('accepts list element without annotation', async () => {
      const { context } = await runWithContext(
        'list[list[1, 2, 3]] -> destruct<$a>'
      );
      expect(context.variables.get('a')).toEqual([1, 2, 3]);
    });

    it('accepts dict element without annotation', async () => {
      const { context } = await runWithContext(
        'list[dict[x: 1]] -> destruct<$a>'
      );
      expect(context.variables.get('a')).toEqual({ x: 1 });
    });

    it('accepts bool element without annotation', async () => {
      const { context } = await runWithContext('list[true] -> destruct<$a>');
      expect(context.variables.get('a')).toBe(true);
    });
  });
});
