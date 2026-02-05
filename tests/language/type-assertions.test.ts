/**
 * Rill Runtime Tests: Type Assertions and Checks
 * Tests for type assertion (expr:type) and type check (expr:?type) syntax
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Type Assertions', () => {
  describe('Pipe Shorthand :type', () => {
    it('asserts string type on pipe value', async () => {
      expect(await run('"hello" -> :string')).toBe('hello');
    });

    it('asserts number type on pipe value', async () => {
      expect(await run('42 -> :number')).toBe(42);
    });

    it('asserts bool type on pipe value', async () => {
      expect(await run('true -> :bool')).toBe(true);
    });

    it('asserts list type on pipe value', async () => {
      expect(await run('[1, 2, 3] -> :list')).toEqual([1, 2, 3]);
    });

    it('asserts dict type on pipe value', async () => {
      expect(await run('[a: 1, b: 2] -> :dict')).toEqual({ a: 1, b: 2 });
    });

    it('asserts closure type on pipe value', async () => {
      expect(await run('|| "x" -> :closure -> $()')).toBe('x');
    });

    it('errors on type mismatch - string expected, got number', async () => {
      await expect(run('42 -> :string')).rejects.toThrow(
        'expected string, got number'
      );
    });

    it('errors on type mismatch - number expected, got string', async () => {
      await expect(run('"hello" -> :number')).rejects.toThrow(
        'expected number, got string'
      );
    });

    it('errors on type mismatch - bool expected, got string', async () => {
      await expect(run('"true" -> :bool')).rejects.toThrow(
        'expected bool, got string'
      );
    });

    it('errors on type mismatch - list expected, got dict', async () => {
      await expect(run('[a: 1] -> :list')).rejects.toThrow(
        'expected list, got dict'
      );
    });

    it('errors on type mismatch - dict expected, got list', async () => {
      await expect(run('[1, 2] -> :dict')).rejects.toThrow(
        'expected dict, got list'
      );
    });
  });

  describe('Pipe Shorthand :?type (Type Check)', () => {
    it('returns true when type matches - string', async () => {
      expect(await run('"hello" -> :?string')).toBe(true);
    });

    it('returns false when type mismatches - string', async () => {
      expect(await run('42 -> :?string')).toBe(false);
    });

    it('returns true when type matches - number', async () => {
      expect(await run('42 -> :?number')).toBe(true);
    });

    it('returns false when type mismatches - number', async () => {
      expect(await run('"42" -> :?number')).toBe(false);
    });

    it('returns true when type matches - bool', async () => {
      expect(await run('true -> :?bool')).toBe(true);
    });

    it('returns false when type mismatches - bool', async () => {
      expect(await run('1 -> :?bool')).toBe(false);
    });

    it('returns true when type matches - list', async () => {
      expect(await run('[1, 2, 3] -> :?list')).toBe(true);
    });

    it('returns false when type mismatches - list', async () => {
      expect(await run('[a: 1] -> :?list')).toBe(false);
    });

    it('returns true when type matches - dict', async () => {
      expect(await run('[a: 1] -> :?dict')).toBe(true);
    });

    it('returns false when type mismatches - dict', async () => {
      expect(await run('[1, 2] -> :?dict')).toBe(false);
    });

    it('returns true when type matches - closure', async () => {
      expect(await run('|| "x" -> :?closure')).toBe(true);
    });

    it('returns false when type mismatches - closure', async () => {
      expect(await run('"fn" -> :?closure')).toBe(false);
    });
  });

  describe('Type Assertion in Pipe Chains', () => {
    it('assertion passes and continues chain', async () => {
      expect(await run('"hello" -> :string -> .len')).toBe(5);
    });

    it('assertion fails and stops chain', async () => {
      await expect(run('42 -> :string -> .str')).rejects.toThrow();
    });

    it('multiple type assertions in chain', async () => {
      expect(await run('"test" -> :string -> .len -> :number')).toBe(4);
    });
  });

  describe('Type Check in Conditionals', () => {
    it('uses type check as condition - truthy case', async () => {
      expect(
        await run('"hello" -> :?string ? "is string" ! "not string"')
      ).toBe('is string');
    });

    it('uses type check as condition - falsy case', async () => {
      expect(await run('42 -> :?string ? "is string" ! "not string"')).toBe(
        'not string'
      );
    });

    it('uses type check for branching logic', async () => {
      const script = `
        42 => $val
        $val -> :?number ? ($val -> ($ * 2)) ! 0
      `;
      expect(await run(script)).toBe(84);
    });

    it('type check with list processing', async () => {
      // Type check returns bool, so we need to use the original value in the branch
      const script = `
        [1, 2, 3] => $data
        $data -> :?list ? ($data -> each { ($ * 2) }) ! []
      `;
      expect(await run(script)).toEqual([2, 4, 6]);
    });
  });

  describe('Type Assertion After Method Calls', () => {
    it('asserts method result type', async () => {
      expect(await run('"hello" -> .len -> :number')).toBe(5);
    });

    it('asserts method result type - failure', async () => {
      await expect(run('"hello" -> .len -> :string')).rejects.toThrow();
    });
  });

  describe('Type Assertion After Function Calls', () => {
    it('asserts function result type', async () => {
      expect(await run('identity("test") -> :string')).toBe('test');
    });

    it('asserts type() function returns string', async () => {
      expect(await run('type(42) -> :string')).toBe('number');
    });
  });

  describe('Edge Cases', () => {
    it('empty string is still string type', async () => {
      expect(await run('"" -> :string')).toBe('');
    });

    it('zero is still number type', async () => {
      expect(await run('0 -> :number')).toBe(0);
    });

    it('false is still bool type', async () => {
      expect(await run('false -> :bool')).toBe(false);
    });

    it('empty list is still list type', async () => {
      expect(await run('[] -> :list')).toEqual([]);
    });

    it('empty dict is still dict type', async () => {
      expect(await run('[:] -> :dict')).toEqual({});
    });

    it('negative number is number type', async () => {
      expect(await run('-42 -> :number')).toBe(-42);
    });

    it('decimal number is number type', async () => {
      expect(await run('3.14 -> :number')).toBe(3.14);
    });
  });

  describe('Type Check Returns Boolean', () => {
    it('type check result can be stored in variable', async () => {
      expect(await run('"hello" -> :?string => $result\n$result')).toBe(true);
    });

    it('type check result can be negated', async () => {
      expect(await run('42 -> :?string -> !$')).toBe(true);
    });
  });

  describe('Type Assertion with Tuple Type', () => {
    it('asserts tuple type on spread result', async () => {
      expect(await run('*[1, 2, 3] -> :tuple')).toHaveProperty(
        '__rill_tuple',
        true
      );
    });

    it('type check for tuple', async () => {
      expect(await run('*[1, 2] -> :?tuple')).toBe(true);
    });

    it('list is not tuple', async () => {
      expect(await run('[1, 2] -> :?tuple')).toBe(false);
    });
  });

  describe('Complex Scenarios', () => {
    it('type assertion in closure body', async () => {
      const script = `
        |x| { $x -> :number -> ($ * 2) } => $double
        $double(21)
      `;
      expect(await run(script)).toBe(42);
    });

    it('type assertion in closure body - failure', async () => {
      const script = `
        |x| { $x -> :number -> ($ * 2) } => $double
        $double("hello")
      `;
      await expect(run(script)).rejects.toThrow();
    });

    it('type check for conditional dispatch', async () => {
      // Test type check followed by conditional processing
      const script = `
        |val| {
          $val -> :?number ? ($val * 2) ! ($val -> :?string ? ($val -> .len) ! 0)
        } => $process
        [$process(5), $process("hello"), $process(true)]
      `;
      expect(await run(script)).toEqual([10, 5, 0]);
    });

    it('chained type checks', async () => {
      const script = `
        "test" => $v
        [
          $v -> :?string,
          $v -> :?number,
          $v -> :?bool
        ]
      `;
      expect(await run(script)).toEqual([true, false, false]);
    });
  });
});
