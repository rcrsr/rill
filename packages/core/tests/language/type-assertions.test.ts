/**
 * Rill Runtime Tests: Type Assertions and Checks
 * Tests for type assertion (expr:type) and type check (expr:?type) syntax
 * including parameterized structural type assertions.
 *
 * AC = Acceptance Criterion, EC = Error Contract from the type-assertions spec.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

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
      expect(await run('list[1, 2, 3] -> :list')).toEqual([1, 2, 3]);
    });

    it('asserts dict type on pipe value', async () => {
      expect(await run('dict[a: 1, b: 2] -> :dict')).toEqual({ a: 1, b: 2 });
    });

    it('asserts closure type on pipe value', async () => {
      expect(await run('|| "x" -> :closure -> $()')).toBe('x');
    });

    it('errors on type mismatch - string expected, got number', async () => {
      await expectHaltMessage(
        () => run('42 -> :string'),
        'expected string, got number'
      );
    });

    it('errors on type mismatch - number expected, got string', async () => {
      await expectHaltMessage(
        () => run('"hello" -> :number'),
        'expected number, got string'
      );
    });

    it('errors on type mismatch - bool expected, got string', async () => {
      await expectHaltMessage(
        () => run('"true" -> :bool'),
        'expected bool, got string'
      );
    });

    it('errors on type mismatch - list expected, got dict', async () => {
      await expectHaltMessage(
        () => run('dict[a: 1] -> :list'),
        'expected list, got dict'
      );
    });

    it('errors on type mismatch - dict expected, got list', async () => {
      await expectHaltMessage(
        () => run('list[1, 2] -> :dict'),
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
      expect(await run('list[1, 2, 3] -> :?list')).toBe(true);
    });

    it('returns false when type mismatches - list', async () => {
      expect(await run('dict[a: 1] -> :?list')).toBe(false);
    });

    it('returns true when type matches - dict', async () => {
      expect(await run('dict[a: 1] -> :?dict')).toBe(true);
    });

    it('returns false when type mismatches - dict', async () => {
      expect(await run('list[1, 2] -> :?dict')).toBe(false);
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
      await expect(run('42 -> :string -> string')).rejects.toThrow();
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
        list[1, 2, 3] => $data
        $data -> :?list ? ($data -> each { ($ * 2) }) ! list[]
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

    it('asserts .^type returns type value (typeName via host API)', async () => {
      // .^type.^name no longer works; typeName accessible via host typeName property
      const result = (await run('42 => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('number');
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
      expect(await run('list[] -> :list')).toEqual([]);
    });

    it('empty dict is still dict type', async () => {
      expect(await run('dict[] -> :dict')).toEqual({});
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
    it('list is not tuple', async () => {
      expect(await run('list[1, 2] -> :?tuple')).toBe(false);
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
        list[$process(5), $process("hello"), $process(true)]
      `;
      expect(await run(script)).toEqual([10, 5, 0]);
    });

    it('chained type checks', async () => {
      const script = `
        "test" => $v
        list[
          $v -> :?string,
          $v -> :?number,
          $v -> :?bool
        ]
      `;
      expect(await run(script)).toEqual([true, false, false]);
    });
  });

  // ============================================================
  // Parameterized Type Assertions (AC-4 through AC-7, AC-23, AC-25)
  // ============================================================

  describe('Parameterized type assertions (AC-4 to AC-7, AC-23, AC-25)', () => {
    it('AC-4: list[list[1,2],list[3]] :list(list(number)) assertion succeeds', async () => {
      const result = await run('list[list[1, 2], list[3]] :list(list(number))');
      expect(result).toEqual([[1, 2], [3]]);
    });

    it('AC-5: list[list[1,2]] :? list(list(number)) returns true', async () => {
      const result = await run('list[list[1, 2]] :? list(list(number))');
      expect(result).toBe(true);
    });

    it('AC-6: list[] :? list(string) returns true (empty list vacuous truth)', async () => {
      const result = await run('list[] :? list(string)');
      expect(result).toBe(true);
    });

    it('AC-7: list[1, 2] :? list returns true (bare type matches any list)', async () => {
      const result = await run('list[1, 2] :? list');
      expect(result).toBe(true);
    });

    it('AC-23: empty list[] matches any list(T) (same as AC-6)', async () => {
      const result = await run('list[] :? list(number)');
      expect(result).toBe(true);
    });

    it('AC-25: dict(items: list(tuple(number, string))) validates fully (deeply nested)', async () => {
      await expect(
        run('dict(items: list(tuple(number, string))) => $t\n"ok"')
      ).resolves.toBe('ok');
    });
  });

  // ============================================================
  // Leaf type with args error (AC-16, AC-17, AC-18)
  // ============================================================

  describe('Leaf type with type arguments rejects (AC-16, AC-17, AC-18)', () => {
    it('AC-16: :string(number) halts with "string does not accept type arguments"', async () => {
      await expectHaltMessage(
        () => run('"hello" :string(number)'),
        'string does not accept type arguments'
      );
    });

    it('AC-17: :vector(string) halts with "vector does not accept type arguments"', async () => {
      await expectHaltMessage(
        () => run('"hello" :vector(string)'),
        'vector does not accept type arguments'
      );
    });

    it('AC-18: :closure(string, number) halts with "closure does not accept type arguments"', async () => {
      await expectHaltMessage(
        () => run('"hello" :closure(string, number)'),
        'closure does not accept type arguments'
      );
    });
  });

  // ============================================================
  // Post-conversion structural mismatch (AC-19, EC-12)
  // ============================================================

  describe('Post-conversion structural mismatch (AC-19, EC-12)', () => {
    it('AC-19: list[1,2] -> list(string) halts with structural mismatch containing "list(string)"', async () => {
      await expectHaltMessage(
        () => run('list[1, 2] -> list(string)'),
        'list(string)'
      );
    });

    it('EC-12: post-conversion structural mismatch uses typed-atom halt path', async () => {
      await expectHaltMessage(
        () => run('list[1, 2] -> list(string)'),
        'Type assertion failed'
      );
    });
  });

  // ============================================================
  // Error Contracts (EC-1 through EC-7, EC-10, EC-13, EC-14)
  // ============================================================

  describe('Error contracts (EC-1 through EC-7, EC-10, EC-13, EC-14)', () => {
    it('EC-1: dynamic ref to undefined variable halts with "not defined"', async () => {
      await expect(run('1 :$undeclared_type_var')).rejects.toThrow(
        'not defined'
      );
    });

    it('EC-2: dynamic ref to non-type variable halts with "not a valid type reference"', async () => {
      const script = `
        1 => $n
        $n :$n
      `;
      await expectHaltMessage(() => run(script), 'not a valid type reference');
    });

    it('EC-3: leaf type with args via annotation syntax halts (same as AC-16)', async () => {
      await expectHaltMessage(
        () => run('"hello" :string(number)'),
        'string does not accept type arguments'
      );
    });

    it('EC-4: list(string, number) annotation halts with "requires exactly 1 type argument"', async () => {
      await expectHaltMessage(
        () => run('"x" :list(string, number)'),
        'list() requires exactly 1 type argument'
      );
    });

    it('EC-5: dict(string) annotation (positional) resolves as uniform dict type', async () => {
      // Single positional arg now produces uniform dict type { kind: 'dict', valueType: { kind: 'string' } }
      // "x" is not a dict, so assertType raises a type mismatch
      await expectHaltMessage(
        () => run('"x" :dict(string)'),
        'Type assertion failed'
      );
    });

    it('EC-6: tuple(x: string) annotation (named) halts with "requires positional arguments"', async () => {
      await expectHaltMessage(
        () => run('"x" :tuple(x: string)'),
        'tuple() requires positional arguments'
      );
    });

    it('EC-7: non-type-value as type arg halts with "not a valid type reference"', async () => {
      const script = `
        1 => $n
        $n :list($n)
      `;
      await expectHaltMessage(() => run(script), 'not a valid type reference');
    });

    it('EC-10: structural assertion mismatch halts with "list(string)" in error', async () => {
      await expectHaltMessage(
        () => run('list[1, 2] :list(string)'),
        'list(string)'
      );
    });

    it('EC-13: invalid token at type position causes ParseError', async () => {
      await expect(run('"x" :123')).rejects.toThrow();
    });

    it('EC-14: malformed arg list causes ParseError', async () => {
      await expect(run('"x" :list(')).rejects.toThrow();
    });
  });

  // ============================================================
  // Tuple Trailing-Default Assertions (AC-1, AC-2 from task 1.11)
  // ============================================================

  describe('Tuple trailing-default assertions (task 1.11)', () => {
    it('AC-1: tuple assertion accepts shorter value when trailing elements have defaults', async () => {
      const result = await run(
        'tuple(string, number = 0) => $t\ntuple["x"] -> :$t'
      );
      expect(result).toEqual({
        __rill_tuple: true,
        entries: ['x'],
      });
    });

    it('AC-1: tuple assertion accepts full-length value when trailing elements have defaults', async () => {
      const result = await run(
        'tuple(string, number = 0) => $t\ntuple["x", 5] -> :$t'
      );
      expect(result).toEqual({
        __rill_tuple: true,
        entries: ['x', 5],
      });
    });

    it('AC-2: tuple assertion rejects missing non-defaulted element', async () => {
      await expectHaltMessage(
        () => run('tuple(string, number) => $t\ntuple["x"] -> :$t'),
        /Type assertion failed/
      );
    });

    it('AC-2: tuple assertion rejects when all required elements are missing', async () => {
      await expectHaltMessage(
        () => run('tuple(string, number) => $t\ntuple[] -> :$t'),
        /Type assertion failed/
      );
    });
  });
});
