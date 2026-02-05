/**
 * Rill Runtime Tests: Assert Statement
 * Tests for assert statement syntax and behavior
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Assert Statement', () => {
  describe('Success Cases', () => {
    it('returns piped value on true condition (AC-1)', async () => {
      expect(await run('5 -> assert ($ > 0)')).toBe(5);
    });

    it('returns piped value with type check (AC-5)', async () => {
      expect(await run('"hello" -> assert $:?string')).toBe('hello');
    });

    it('preserves pipe value through assertion chain', async () => {
      expect(await run('10 -> assert ($ > 0) -> assert ($ < 20)')).toBe(10);
    });

    it('works with list elements in each loop (AC-4)', async () => {
      const result = await run('[1, 2, 3] -> each { assert ($ > 0) }');
      expect(result).toEqual([1, 2, 3]);
    });

    it('works with method call condition', async () => {
      expect(await run('"test" -> assert .contains("es")')).toBe('test');
    });

    it('works with comparison condition', async () => {
      expect(await run('100 -> assert ($ >= 100)')).toBe(100);
    });

    it('works with negated condition', async () => {
      expect(await run('"hello" -> assert !.empty')).toBe('hello');
    });
  });

  describe('Error Cases - Assertion Failed', () => {
    it('throws when condition is false without message (EC-1, AC-6)', async () => {
      await expect(run('-1 -> assert ($ > 0)')).rejects.toThrow(
        'Assertion failed'
      );
    });

    it('throws with custom message when condition is false (EC-2, AC-2)', async () => {
      await expect(
        run('-1 -> assert ($ > 0) "Must be positive"')
      ).rejects.toThrow('Must be positive');
    });

    it('throws on empty string check (AC-3)', async () => {
      await expect(run('"" -> assert !.empty "Empty input"')).rejects.toThrow(
        'Empty input'
      );
    });

    it('halts loop at first assertion failure (AC-8)', async () => {
      await expect(
        run('[1, 0, 3] -> each { assert ($ > 0) "Must be positive" }')
      ).rejects.toThrow('Must be positive');
    });

    it('includes error code RILL-R015 (AC-6)', async () => {
      try {
        await run('-1 -> assert ($ > 0)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R015');
      }
    });

    it('includes location in error message', async () => {
      await expect(run('false -> assert $')).rejects.toThrow(/at \d+:\d+/);
    });

    it('throws on false comparison', async () => {
      await expect(
        run('5 -> assert ($ < 3) "Value too large"')
      ).rejects.toThrow('Value too large');
    });

    it('throws on failed method call condition', async () => {
      await expect(
        run('"hello" -> assert .contains("xyz") "Pattern not found"')
      ).rejects.toThrow('Pattern not found');
    });
  });

  describe('Error Cases - Type Errors', () => {
    it('throws when condition is not boolean (EC-3, AC-7)', async () => {
      await expect(run('"test" -> assert $')).rejects.toThrow(
        'assert requires boolean condition, got string'
      );
    });

    it('throws when condition is number', async () => {
      await expect(run('42 -> assert $')).rejects.toThrow(
        'assert requires boolean condition, got number'
      );
    });

    it('throws when condition is list', async () => {
      await expect(run('[1, 2] -> assert $')).rejects.toThrow(
        'assert requires boolean condition, got list'
      );
    });

    it('throws when condition is dict', async () => {
      await expect(run('[a: 1] -> assert $')).rejects.toThrow(
        'assert requires boolean condition, got dict'
      );
    });

    it('includes error code for type error (assertion requires boolean)', async () => {
      try {
        await run('"test" -> assert $');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId');
        // Error ID should start with RILL-R (runtime error)
        const errorId = (err as { errorId: string }).errorId;
        expect(errorId).toMatch(/^RILL-R\d{3}$/);
      }
    });
  });

  describe('Boundary Cases - Custom Messages', () => {
    it('accepts empty message string (AC-9)', async () => {
      try {
        await run('false -> assert $ ""');
        expect.fail('Should have thrown');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Empty message still includes location " at 1:10"
        expect(message).toMatch(/^ at \d+:\d+$/);
      }
    });

    it('accepts long interpolated message (AC-10)', async () => {
      const longMessage = 'x'.repeat(1000);
      const script = `false -> assert $ "{${JSON.stringify(longMessage)}}"`;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain(longMessage);
      }
    });

    it('interpolates variables in message', async () => {
      await expect(
        run(
          '5 :> $min\n3 -> assert ($ >= $min) "Value {$} below minimum {$min}"'
        )
      ).rejects.toThrow('Value 3 below minimum 5');
    });

    it('supports multiline message', async () => {
      const script = `
        false -> assert $ """
        Error: validation failed
        Expected: valid input
        """
      `;
      await expect(run(script)).rejects.toThrow('Error: validation failed');
    });
  });

  describe('Boundary Cases - Multiple Assertions', () => {
    it('halts at first failure in sequence (AC-11)', async () => {
      await expect(
        run(`
          5 -> assert ($ > 0) "First check"
          -> assert ($ < 3) "Second check"
        `)
      ).rejects.toThrow('Second check');
    });

    it('executes all assertions when all pass', async () => {
      expect(
        await run(`
          5 -> assert ($ > 0) "First check"
          -> assert ($ < 10) "Second check"
          -> assert ($ != 7) "Third check"
        `)
      ).toBe(5);
    });

    it('halts at first assertion in closure', async () => {
      const script = `
        |x| {
          $x -> assert ($ > 0) "Must be positive"
          -> assert ($ < 5) "Must be less than 5"
        } :> $validate
        10 -> $validate()
      `;
      await expect(run(script)).rejects.toThrow('Must be less than 5');
    });

    it('preserves pipe value through multiple successful assertions', async () => {
      expect(
        await run(`
          "test" -> assert (.contains("t"))
          -> assert (.contains("e"))
          -> assert (.contains("s"))
        `)
      ).toBe('test');
    });
  });

  describe('Integration with Control Flow', () => {
    it('works inside conditional then branch', async () => {
      expect(await run('true ? { 5 -> assert ($ > 0) } ! "no"')).toBe(5);
    });

    it('works inside conditional else branch', async () => {
      expect(await run('false ? "yes" ! { 5 -> assert ($ > 0) }')).toBe(5);
    });

    it('throws from conditional branch', async () => {
      await expect(
        run('true ? { -1 -> assert ($ > 0) "Invalid" } ! "no"')
      ).rejects.toThrow('Invalid');
    });

    it('works inside while loop body', async () => {
      expect(
        await run(`
          1 -> ($ <= 3) @ {
            assert ($ > 0) "Must be positive"
            $ + 1
          }
        `)
      ).toBe(4);
    });

    it('halts while loop on assertion failure', async () => {
      await expect(
        run(`
          1 -> ($ <= 5) @ {
            ($ == 3) ? { assert false "Loop halted" }
            $ + 1
          }
        `)
      ).rejects.toThrow('Loop halted');
    });

    it('works with map operator', async () => {
      expect(await run('[1, 2, 3] -> map { assert ($ > 0)\n$ * 2 }')).toEqual([
        2, 4, 6,
      ]);
    });

    it('halts map on assertion failure', async () => {
      await expect(
        run('[1, 0, 3] -> map { assert ($ > 0) "Invalid element" }')
      ).rejects.toThrow('Invalid element');
    });

    it('works with filter operator', async () => {
      expect(
        await run('[1, 2, 3, 4] -> filter { assert ($ > 0)\n$ > 2 }')
      ).toEqual([3, 4]);
    });

    it('works with fold operator', async () => {
      expect(
        await run(`
          [1, 2, 3] -> fold(0) {
            assert ($@ >= 0) "Accumulator invalid"
            $@ + $
          }
        `)
      ).toBe(6);
    });
  });

  describe('Edge Cases', () => {
    it('works with complex condition expression', async () => {
      expect(await run('5 -> assert (($ > 0) && ($ < 10))')).toBe(5);
    });

    it('works with negated complex condition', async () => {
      expect(await run('5 -> assert !(($ < 0) || ($ > 10))')).toBe(5);
    });

    it('works with type assertion as condition', async () => {
      expect(await run('"test" -> assert ($:?string)')).toBe('test');
    });

    it('throws on failed type assertion', async () => {
      await expect(
        run('42 -> assert ($:?string) "Must be string"')
      ).rejects.toThrow('Must be string');
    });

    it('preserves different value types', async () => {
      expect(await run('[1, 2] -> assert (!.empty)')).toEqual([1, 2]);
      expect(await run('[a: 1] -> assert (!.empty)')).toEqual({ a: 1 });
      expect(await run('true -> assert $')).toBe(true);
      expect(await run('42 -> assert ($ > 0)')).toBe(42);
    });

    it('works with default operator in message', async () => {
      const script = `
        [name: "test"] :> $obj
        false -> assert $ "Error: {$obj.missing ?? "no value"}"
      `;
      await expect(run(script)).rejects.toThrow('Error: no value');
    });

    it('works with method chain in condition', async () => {
      expect(await run('"  test  " -> assert .trim.contains("test")')).toBe(
        '  test  '
      );
    });
  });
});
