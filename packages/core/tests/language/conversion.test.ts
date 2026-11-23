/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: -> Conversion Operator
 * Tests for the -> convert pipe target operator.
 *
 * Feature: Phase 1 keyword conversion operator (task 1.4)
 * Covers: AC-11 to AC-15, AC-28, AC-29, AC-33, AC-34, AC-47, AC-49
 *
 * Feature: Expanded conversion routes (task 1.3)
 * Covers: AC-1 to AC-17, EC-1 to EC-5, AC-25 to AC-33
 */

import { describe, expect, it } from 'vitest';

import { isTuple, ParseError, parse, VALID_TYPE_NAMES } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';
import { expectHalt } from '../helpers/halt.js';
import { isOrdered, orderedEntries } from '../helpers/ordered.js';

describe('Rill Language: -> Conversion Operator', () => {
  // ============================================================
  // BASIC CONVERSIONS
  // ============================================================

  describe('list -> tuple (AC-11)', () => {
    it('converts list[1, 2] to tuple with elements 1 and 2', async () => {
      const result = await run('list[1, 2] -> tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 2]);
    });

    it('converts empty list to empty tuple', async () => {
      const result = await run('list[] -> tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([]);
    });

    it('converts list with string elements to tuple', async () => {
      const result = await run('list["a", "b", "c"] -> tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual(['a', 'b', 'c']);
    });
  });

  describe('tuple -> list (AC-11b)', () => {
    it('converts tuple[1, 2] to list with elements 1 and 2', async () => {
      const result = await run('tuple[1, 2] -> list');
      expect(result).toEqual([1, 2]);
    });

    it('converts empty tuple to empty list', async () => {
      const result = await run('tuple[] -> list');
      expect(result).toEqual([]);
    });

    it('converts tuple with string elements to list', async () => {
      const result = await run('tuple["a", "b", "c"] -> list');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('converts tuple[1, 2] to list[1, 2]', async () => {
      const result = await run('tuple[1, 2] -> list');
      expect(result).toEqual([1, 2]);
    });

    it('converts a heterogeneous tuple to a mixed list', async () => {
      expect(await run('tuple[1, "a"] -> list')).toEqual([1, 'a']);
    });

    it('infers a union element type for the converted heterogeneous list', async () => {
      expect(
        await run(
          '(tuple[1, "a"] -> list).^type == list(union(number, string))'
        )
      ).toBe(true);
    });
  });

  describe('ordered -> dict (AC-12)', () => {
    it('converts ordered[a: 1, b: 2] to dict with keys a and b', async () => {
      const result = await run('ordered[a: 1, b: 2] -> dict');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('converts empty ordered to empty dict', async () => {
      const result = await run('ordered[] -> dict');
      expect(result).toEqual({});
    });
  });

  describe('dict -> ordered(sig) (AC-13, AC-49)', () => {
    it('converts dict[a: 1, b: 2] to ordered using field order from sig (AC-13)', async () => {
      const result = await run(
        'dict[a: 1, b: 2] -> ordered(a: number, b: number)'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('uses type signature field order, not dict order (AC-49)', async () => {
      const result = await run(
        'dict[b: 2, a: 1] -> ordered(b: number, a: number)'
      );
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      expect(entries[0]![0]).toBe('b');
      expect(entries[1]![0]).toBe('a');
    });
  });

  describe('string -> number (AC-14)', () => {
    rule('number.from-string').it('converts "5" to integer 5', async () => {
      const result = await run('"5" -> number');
      expect(result).toBe(5);
    });

    rule('number.from-string').it('converts "3.14" to decimal', async () => {
      const result = await run('"3.14" -> number');
      expect(result).toBe(3.14);
    });

    rule('number.from-string').it(
      'converts "-10" to negative number',
      async () => {
        const result = await run('"-10" -> number');
        expect(result).toBe(-10);
      }
    );

    rule('number.from-overflow').it(
      'halts converting an overflow numeric string instead of producing Infinity',
      async () => {
        await expectHalt(() => run('"1e309" -> number'), {
          code: 'INVALID_INPUT',
          messagePattern: /not finite/i,
        });
      }
    );
  });

  describe('number -> string (AC-14b)', () => {
    rule('string.from-number').it(
      'converts integer 42 to string "42"',
      async () => {
        const result = await run('42 -> string');
        expect(result).toBe('42');
      }
    );

    rule('string.from-number').it(
      'converts decimal 3.14 to string "3.14"',
      async () => {
        const result = await run('3.14 -> string');
        expect(result).toBe('3.14');
      }
    );

    rule('string.from-number').it(
      'converts negative -7 to string "-7"',
      async () => {
        const result = await run('-7 -> string');
        expect(result).toBe('-7');
      }
    );
  });

  // ============================================================
  // DYNAMIC TYPE VARIABLE (AC-15)
  // ============================================================

  describe('dynamic -> $t type variable (AC-15)', () => {
    it('converts list[1, 2] to tuple using type variable $t', async () => {
      const result = await run('tuple => $t\nlist[1, 2] -> $t');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1, 2]);
    });

    it('throws when dict -> $t where $t is ordered type (no sig available)', async () => {
      // dict -> ordered without a structural signature always errors (EC-11)
      await expect(
        run('ordered => $t\ndict[a: 1, b: 2] -> $t')
      ).rejects.toThrow(/structural type signature/);
    });

    it('passes through same type via variable (AC-47)', async () => {
      const result = await run('list => $t\nlist[1, 2] -> $t');
      expect(result).toEqual([1, 2]);
    });

    it('fills a missing field default through a held dict type', async () => {
      const result = await run(
        'dict(a: number, b: number = 5) => $t\ndict[a: 1] -> $t'
      );
      expect(result).toEqual({ a: 1, b: 5 });
    });

    it('drops extra keys through a held dict type', async () => {
      const result = await run('dict(a: number) => $t\ndict[a: 1, z: 9] -> $t');
      expect(result).toEqual({ a: 1 });
    });

    it('converts the inner field type through a held dict type', async () => {
      const result = await run('dict(a: string) => $t\ndict[a: 1] -> $t');
      expect(result).toEqual({ a: '1' });
    });

    it('halts naming the failing field through a held dict type', async () => {
      await expectHalt(() => run('dict(a: number) => $t\ndict[a: "x"] -> $t'), {
        code: 'RILL_R038',
        messagePattern: /field 'a'/,
      });
    });

    it('converts list elements to a parameterized list type', async () => {
      expect(await run('list[1, 2] -> list(string)')).toEqual(['1', '2']);
      expect(await run('list["1", "2"] -> list(number)')).toEqual([1, 2]);
      expect(await run('list[list[1]] -> list(list(string))')).toEqual([['1']]);
    });

    it('converts a tuple to a parameterized list type', async () => {
      expect(await run('tuple[1, 2] -> list(string)')).toEqual(['1', '2']);
    });

    it('converts positions of a tuple signature', async () => {
      const result = await run('list[1, 2] -> tuple(string, string)');
      expect(isTuple(result) ? result.entries : result).toEqual(['1', '2']);
    });

    it('converts dict fields', async () => {
      expect(await run('dict[a: 1] -> dict(a: string)')).toEqual({ a: '1' });
    });

    it('converts ordered fields', async () => {
      const result = await run('ordered[a: 1] -> ordered(a: string)');
      expect(isOrdered(result) ? orderedEntries(result) : result).toEqual([
        ['a', '1'],
      ]);
    });

    it('halts RILL-R036 naming the element for a list element that matches no member', async () => {
      await expectHalt(() => run('list[true] -> list(union(number, string))'), {
        code: 'RILL_R036',
        messagePattern: /element 0/,
      });
    });

    it('returns a list unchanged when every element matches a member', async () => {
      expect(await run('list[1, "a"] -> list(union(number, string))')).toEqual([
        1,
        'a',
      ]);
    });

    it('halts RILL-R038 naming the failing list element', async () => {
      await expectHalt(() => run('list["1", "x"] -> list(number)'), {
        code: 'RILL_R038',
        messagePattern: /element 1/,
      });
    });

    it('halts RILL-R038 naming the failing tuple position', async () => {
      await expectHalt(() => run('tuple["x", 1] -> tuple(number, number)'), {
        code: 'RILL_R038',
        messagePattern: /position 0/,
      });
    });

    it('still halts #TYPE_MISMATCH on the assertion path', async () => {
      await expectHalt(() => run('list[1, 2] -> :list(string)'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('orders fields by declaration through a held ordered type', async () => {
      const result = await run(
        'ordered(b: number, a: number) => $t\ndict[a: 1, b: 2] -> $t'
      );
      expect(orderedEntries(result)).toEqual([
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('fills a missing tuple element default through a held tuple type', async () => {
      const result = await run(
        'tuple(number, number = 9) => $t\nlist[1] -> $t'
      );
      expect((result as { entries: unknown[] }).entries).toEqual([1, 9]);
    });

    it('halts R044 for a missing required field through a held dict type', async () => {
      await expectHalt(() => run('dict(a: number) => $t\ndict[] -> $t'), {
        code: 'RILL_R044',
        messagePattern: /missing required field 'a'/,
      });
    });
  });

  // ============================================================
  // NO-OP CONVERSIONS (AC-47)
  // ============================================================

  describe('no-op conversions - same type (AC-47)', () => {
    it('list -> list is a no-op', async () => {
      const result = await run('list[1, 2] -> list');
      expect(result).toEqual([1, 2]);
    });

    it('dict -> dict is a no-op', async () => {
      const result = await run('dict[a: 1] -> dict');
      expect(result).toEqual({ a: 1 });
    });

    it('tuple -> tuple is a no-op', async () => {
      const result = await run('tuple[1, 2] -> tuple');
      expect(isTuple(result)).toBe(true);
    });

    it('ordered -> ordered is a no-op', async () => {
      const result = await run('ordered[a: 1] -> ordered');
      expect(isOrdered(result)).toBe(true);
    });

    it('"hello" -> string is a no-op', async () => {
      const result = await run('"hello" -> string');
      expect(result).toBe('hello');
    });

    it('42 -> number is a no-op', async () => {
      const result = await run('42 -> number');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // REMOVED METHODS: .str AND .num (AC-23, AC-24)
  // ============================================================

  describe('removed .str and .num methods (AC-23, AC-24)', () => {
    it('throws unknown method error: "123" -> .num (AC-23)', async () => {
      await expect(run('"123" -> .num')).rejects.toThrow(/Unknown method: num/);
    });

    it('throws unknown method error: 42 -> .str (AC-24)', async () => {
      await expect(run('42 -> .str')).rejects.toThrow(/Unknown method: str/);
    });
  });

  // ============================================================
  // ERROR CONTRACTS
  // ============================================================

  describe('error contracts', () => {
    it('throws runtime error: "hello" -> tuple (AC-28, EC-10)', async () => {
      await expect(run('"hello" -> tuple')).rejects.toThrow(
        /cannot convert string to tuple/
      );
    });

    it('throws runtime error: dict -> ordered without signature (AC-29, EC-11)', async () => {
      await expect(run('dict[a: 1] -> ordered')).rejects.toThrow(
        /structural type signature/
      );
    });

    rule('number.from-string-fail').it(
      'throws runtime error: "five" -> number (AC-33, EC-12)',
      async () => {
        await expect(run('"five" -> number')).rejects.toThrow(
          /cannot convert string "five" to number/
        );
      }
    );

    it('throws runtime error: -> $var where $var holds non-type value (AC-34, EC-13)', async () => {
      // Post-migration: -> $n where $n holds a non-type, non-callable,
      // non-dispatchable value produces a dispatch error. The legacy -> path
      // produced "expected type value" (RILL-R039); the new unified pipe path
      // produces the generic dispatch error since the syntax does not mark
      // conversion intent explicitly.
      await expect(run('5 => $n\n"hello" -> $n')).rejects.toThrow(
        /cannot pipe into \$n: it holds a number/
      );
    });

    it('throws runtime error: list -> dict (incompatible)', async () => {
      await expect(run('list[1, 2] -> dict')).rejects.toThrow(
        /cannot convert list to dict/
      );
    });

    it('throws runtime error: tuple -> ordered (incompatible)', async () => {
      await expect(run('tuple[1, 2] -> ordered')).rejects.toThrow(
        /cannot convert tuple to ordered/
      );
    });

    it('throws runtime error: dict -> list (incompatible)', async () => {
      await expect(run('dict[a: 1] -> list')).rejects.toThrow(
        /cannot convert dict to list/
      );
    });
  });

  // ============================================================
  // -> STRING EXPANDED ROUTES (AC-1 to AC-6)
  // ============================================================

  describe('-> string conversions (AC-1 to AC-6)', () => {
    rule('string.from-number').it(
      'converts number 42 to string "42" (AC-1)',
      async () => {
        const result = await run('42 -> string');
        expect(result).toBe('42');
      }
    );

    rule('string.from-bool').it(
      'converts bool true to string "true" (AC-2)',
      async () => {
        const result = await run('true -> string');
        expect(result).toBe('true');
      }
    );

    rule('string.from-bool').it(
      'converts bool false to string "false"',
      async () => {
        const result = await run('false -> string');
        expect(result).toBe('false');
      }
    );

    rule('string.from-collection').it(
      'converts list[1, 2] to string "list[1, 2]" (AC-3)',
      async () => {
        const result = await run('list[1, 2] -> string');
        expect(result).toBe('list[1, 2]');
      }
    );

    rule('string.from-collection').it(
      'converts dict[a: 1] to string "dict[a: 1]" (AC-4)',
      async () => {
        const result = await run('dict[a: 1] -> string');
        expect(result).toBe('dict[a: 1]');
      }
    );

    rule('string.from-collection').it(
      'converts tuple[1, 2] to string "tuple[1, 2]" (AC-5)',
      async () => {
        const result = await run('tuple[1, 2] -> string');
        expect(result).toBe('tuple[1, 2]');
      }
    );

    it('"hello" -> string is identity (AC-6)', async () => {
      const result = await run('"hello" -> string');
      expect(result).toBe('hello');
    });
  });

  // ============================================================
  // -> NUMBER EXPANDED ROUTES (AC-7 to AC-10)
  // ============================================================

  describe('-> number expanded conversions (AC-7 to AC-10)', () => {
    rule('number.from-string').it(
      'converts "123" to number 123 (AC-7)',
      async () => {
        const result = await run('"123" -> number');
        expect(result).toBe(123);
      }
    );

    rule('number.from-bool').it(
      'converts bool true to number 1 (AC-8)',
      async () => {
        const result = await run('true -> number');
        expect(result).toBe(1);
      }
    );

    rule('number.from-bool').it(
      'converts bool false to number 0 (AC-9)',
      async () => {
        const result = await run('false -> number');
        expect(result).toBe(0);
      }
    );

    it('42 -> number is identity (AC-10)', async () => {
      const result = await run('42 -> number');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // -> BOOL CONVERSIONS (AC-11 to AC-15)
  // ============================================================

  describe('-> bool conversions (AC-11 to AC-15)', () => {
    it('converts number 0 to false (AC-11)', async () => {
      const result = await run('0 -> bool');
      expect(result).toBe(false);
    });

    it('converts number 1 to true (AC-12)', async () => {
      const result = await run('1 -> bool');
      expect(result).toBe(true);
    });

    it('converts string "true" to true (AC-13)', async () => {
      const result = await run('"true" -> bool');
      expect(result).toBe(true);
    });

    it('converts string "false" to false (AC-14)', async () => {
      const result = await run('"false" -> bool');
      expect(result).toBe(false);
    });

    it('true -> bool is identity (AC-15)', async () => {
      const result = await run('true -> bool');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // COLLECTION CONVERSIONS (AC-16, AC-17)
  // ============================================================

  describe('collection cross-conversions (AC-16, AC-17)', () => {
    it('converts list[1] to tuple[1] (AC-16)', async () => {
      const result = await run('list[1] -> tuple');
      expect(isTuple(result)).toBe(true);
      const tupleResult = result as { entries: unknown[] };
      expect(tupleResult.entries).toEqual([1]);
    });

    it('converts tuple[1] to list[1] (AC-17)', async () => {
      const result = await run('tuple[1] -> list');
      expect(result).toEqual([1]);
    });
  });

  // ============================================================
  // ERROR CONTRACTS: INCOMPATIBLE AND UNPARSEABLE (EC-1 to EC-5, AC-25)
  // ============================================================

  describe('error contracts: expanded routes (EC-1 to EC-5, AC-25)', () => {
    rule('number.from-string-fail').it(
      'throws RILL-R038: "abc" -> number (EC-1, AC-18)',
      async () => {
        await expect(run('"abc" -> number')).rejects.toThrow(
          /cannot convert string "abc" to number/
        );
      }
    );

    rule('number.from-other').it(
      'throws RILL-R036: list[1] -> number (EC-2, AC-19)',
      async () => {
        await expect(run('list[1] -> number')).rejects.toThrow(
          /cannot convert list to number/
        );
      }
    );

    it('throws RILL-R036: 2 -> bool (EC-3, AC-20)', async () => {
      await expect(run('2 -> bool')).rejects.toThrow(
        /cannot convert number to bool/
      );
    });

    it('throws RILL-R036: "yes" -> bool (EC-4, AC-21)', async () => {
      await expect(run('"yes" -> bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: list[1] -> bool (EC-5, AC-22)', async () => {
      await expect(run('list[1] -> bool')).rejects.toThrow(
        /cannot convert list to bool/
      );
    });

    rule('number.from-other').it(
      'throws RILL-R036: dict[a: 1] -> number (AC-25)',
      async () => {
        await expect(run('dict[a: 1] -> number')).rejects.toThrow(
          /cannot convert dict to number/
        );
      }
    );
  });

  // ============================================================
  // BOUNDARY CASES (AC-26 to AC-33)
  // ============================================================

  describe('boundary cases (AC-26 to AC-33)', () => {
    rule('number.from-string-fail').it(
      'throws RILL-R038: "" -> number (AC-26, BC-1 empty string)',
      async () => {
        await expect(run('"" -> number')).rejects.toThrow(
          /cannot convert string "" to number/
        );
      }
    );

    rule('number.from-string-fail').it(
      'throws RILL-R038: " " -> number (AC-27, BC-2 whitespace only)',
      async () => {
        await expect(run('" " -> number')).rejects.toThrow(
          /cannot convert string " " to number/
        );
      }
    );

    it('throws RILL-R036: "True" -> bool (AC-28, BC-3 case-sensitive)', async () => {
      await expect(run('"True" -> bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: "0" -> bool (AC-29, BC-4 string zero rejected)', async () => {
      await expect(run('"0" -> bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: "1" -> bool (AC-30, BC-5 string one rejected)', async () => {
      await expect(run('"1" -> bool')).rejects.toThrow(
        /cannot convert string to bool/
      );
    });

    it('throws RILL-R036: -1 -> bool (AC-31, BC-6 only 0 and 1 accepted)', async () => {
      await expect(run('-1 -> bool')).rejects.toThrow(
        /cannot convert number to bool/
      );
    });

    it('throws RILL-R036: closure -> string (no string form)', async () => {
      await expectHalt(() => run('fn() { 42 } -> string'), {
        code: 'RILL_R036',
        hostErrorId: 'RILL-R036',
        messagePattern: /cannot convert fn to string/,
      });
    });

    it('throws RILL-R036: iterator -> string (no string form)', async () => {
      await expectHalt(() => run('range(0, 3) -> string'), {
        code: 'RILL_R036',
        hostErrorId: 'RILL-R036',
        messagePattern: /cannot convert iterator to string/,
      });
    });

    const NESTED_PRELUDE = 'fn() { 42 } => $f\nrange(0, 3) => $it\n';

    it.each([
      [
        'list holding a closure',
        'list[$f] -> string',
        /cannot convert list to string: contains fn/,
      ],
      [
        'dict holding a closure',
        'dict[a: $f] -> string',
        /cannot convert dict to string: contains fn/,
      ],
      [
        'tuple holding an iterator',
        'tuple[$it] -> string',
        /cannot convert tuple to string: contains iterator/,
      ],
      [
        'ordered holding a closure',
        'ordered[a: $f] -> string',
        /cannot convert ordered to string: contains fn/,
      ],
      [
        'deeply nested iterator',
        'list[dict[a: list[$it]]] -> string',
        /cannot convert list to string: contains iterator/,
      ],
      [
        'dict with a typed key',
        'dict[1: $f] -> string',
        /cannot convert dict to string: contains fn/,
      ],
      [
        'string-typed $T route',
        'string => $T\nlist[$f] -> $T',
        /cannot convert list to string: contains fn/,
      ],
      [
        'list holding an iterator names iterator',
        'list[$it] -> string',
        /contains iterator/,
      ],
    ])(
      'halts RILL-R036: %s -> string',
      async (_name, script, messagePattern) => {
        await expectHalt(() => run(`${NESTED_PRELUDE}${script}`), {
          code: 'RILL_R036',
          hostErrorId: 'RILL-R036',
          messagePattern,
        });
      }
    );

    it('does not name closure when a list holds an iterator', async () => {
      await expectHalt(() => run(`${NESTED_PRELUDE}list[$it] -> string`), {
        code: 'RILL_R036',
        hostErrorId: 'RILL-R036',
        messagePattern: /^(?!.*fn)/,
      });
    });

    const TIME_PRELUDE =
      'datetime(...dict[year: 2024, month: 1, day: 2]) => $d\nduration(...dict[seconds: 5]) => $u\n';

    it.each([
      [
        'list holding a datetime',
        'list[$d] -> string',
        /cannot convert list to string: contains datetime/,
      ],
      [
        'dict holding a duration',
        'dict[a: $u] -> string',
        /cannot convert dict to string: contains duration/,
      ],
    ])(
      'halts RILL-R036: %s -> string',
      async (_name, script, messagePattern) => {
        await expectHalt(() => run(`${TIME_PRELUDE}${script}`), {
          code: 'RILL_R036',
          hostErrorId: 'RILL-R036',
          messagePattern,
        });
      }
    );

    it('prints a nested datetime and duration in interpolation', async () => {
      expect(await run(`${TIME_PRELUDE}"{list[$d, $d]}"`)).toBe(
        'list[2024-01-02T00:00:00.000Z, 2024-01-02T00:00:00.000Z]'
      );
      expect(await run(`${TIME_PRELUDE}"{dict[a: $u]}"`)).toBe('dict[a: 5s]');
    });

    it('halts RILL-R036 when join meets a closure', async () => {
      await expectHalt(() => run(`${NESTED_PRELUDE}list[$f] -> .join(",")`), {
        code: 'RILL_R036',
        hostErrorId: 'RILL-R036',
        messagePattern: /cannot convert list to string: contains fn/,
      });
    });

    it('joins a list holding a datetime by its printed form', async () => {
      expect(await run(`${TIME_PRELUDE}list[$d] -> .join(",")`)).toBe(
        '2024-01-02T00:00:00.000Z'
      );
    });

    rule('string.from-collection').it(
      'still converts a plain list to its string form',
      async () => {
        expect(await run('list[1, 2] -> string')).toBe('list[1, 2]');
      }
    );

    rule('string.from-collection').it(
      'still converts empty list and dict to string',
      async () => {
        expect(await run('list[] -> string')).toBe('list[]');
        expect(await run('dict[] -> string')).toBe('dict[]');
      }
    );

    rule('number.from-string').it(
      'converts "-3.14" to number -3.14 (AC-33, BC-8 negative decimal)',
      async () => {
        const result = await run('"-3.14" -> number');
        expect(result).toBe(-3.14);
      }
    );
  });

  // ============================================================
  // PHASE 3 CONTRACT: MIGRATION ERROR AND TYPE-VALUE-VIA-VARIABLE
  // ============================================================

  describe('legacy :> migration error (UCP-EC-1, AC-EC-1, AC-EC-6)', () => {
    it('raises RILL-R078 parse error for "42" -> :>number', () => {
      let thrown: unknown = undefined;
      try {
        parse('"42" -> :>number');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ParseError);
      const parseErr = thrown as ParseError;
      expect(parseErr.errorId).toBe('RILL-R078');
      // Message must cite both `:>` and `-> type`
      expect(parseErr.message).toMatch(/:>/);
      expect(parseErr.message).toMatch(/-> type/);
    });

    it('migration error terminates the pipe chain (AC-EC-6)', async () => {
      // Parse error surfaces before any downstream stage runs, halting
      // the whole script (consistent with terminal error behavior).
      await expect(run('"42" -> :>number -> string')).rejects.toBeInstanceOf(
        ParseError
      );
      await expect(run('"42" -> :>number -> string')).rejects.toHaveProperty(
        'errorId',
        'RILL-R078'
      );
    });
  });

  describe('type-value-via-variable dispatch (UCP-AC-3, UCP-EC-3, UCP-EC-4, UCP-EC-5)', () => {
    it('number => $t; "42" -> $t returns numeric 42 (UCP-AC-3, slot-6 dispatch)', async () => {
      const result = await run('number => $t\n"42" -> $t');
      expect(result).toBe(42);
    });

    it('string => $t; 42 -> $t returns "42"', async () => {
      const result = await run('string => $t\n42 -> $t');
      expect(result).toBe('42');
    });

    it('closure => $t; 42 -> $t raises RILL-R036 (UCP-EC-3 unsupported via variable)', async () => {
      await expect(run('fn => $t\n42 -> $t')).rejects.toHaveProperty(
        'errorId',
        'RILL-R036'
      );
    });

    it('ordered => $t; dict[a: 1] -> $t raises RILL-R037 (UCP-EC-4 via variable)', async () => {
      await expect(
        run('ordered => $t\ndict[a: 1] -> $t')
      ).rejects.toHaveProperty('errorId', 'RILL-R037');
    });

    it('number => $t; "abc" -> $t raises RILL-R038 (UCP-EC-5 via variable)', async () => {
      await expect(run('number => $t\n"abc" -> $t')).rejects.toHaveProperty(
        'errorId',
        'RILL-R038'
      );
    });
  });

  describe('bare identifier fall-through (UCP-EC-2)', () => {
    it('value -> unknown_identifier dispatches to host-call path (RILL-R006)', async () => {
      // Bare non-type identifier falls through parsePipeTarget() to
      // parseBareHostCall(); runtime raises the existing host-function
      // resolution error, NOT a conversion error.
      await expect(run('"hello" -> unknown_identifier')).rejects.toHaveProperty(
        'errorId',
        'RILL-R006'
      );
      await expect(run('"hello" -> unknown_identifier')).rejects.toThrow(
        /Unknown function: unknown_identifier/
      );
    });
  });

  describe('ordered() zero-fields target (AC-BC-3)', () => {
    it('dict[a: 1] -> ordered() halts like the bare ordered target', async () => {
      // ordered() is the unspecified ordered type, so it carries no field
      // signature to convert into.
      await expect(run('dict[a: 1] -> ordered()')).rejects.toThrow(
        /requires structural type signature/
      );
    });
  });

  describe('VALID_TYPE_NAMES parser acceptance (AC-BC-4)', () => {
    // Every entry except `union` must parse as a bare-type pipe target;
    // `union` needs its members and raises RILL-P003 when bare.
    // Runtime behavior varies (convertible types succeed, closure/stream/etc.
    // raise RILL-R036 — covered by AC-BC-2); this test only asserts parsing.
    it.each(VALID_TYPE_NAMES.filter((name) => name !== 'union'))(
      'parses "foo" -> %s as a bare-type pipe target',
      (typeName) => {
        expect(() => parse(`"foo" -> ${typeName}`)).not.toThrow();
      }
    );

    it('rejects "foo" -> union as a bare-type pipe target with RILL-P003', () => {
      expect(() => parse('"foo" -> union')).toThrow(
        expect.objectContaining({ errorId: 'RILL-P003' })
      );
    });

    it('VALID_TYPE_NAMES has exactly 19 entries', () => {
      expect(VALID_TYPE_NAMES).toHaveLength(19);
    });
  });

  describe('scalar conversion edges', () => {
    rule('number.from-string').it(
      'converts bare-point, exponent, and leading-zero strings',
      async () => {
        expect(await run('"5." -> number')).toBe(5);
        expect(await run('".5" -> number')).toBe(0.5);
        expect(await run('"-.5" -> number')).toBe(-0.5);
        expect(await run('"1e3" -> number')).toBe(1000);
        expect(await run('"005" -> number')).toBe(5);
      }
    );

    rule('number.from-string-fail').it(
      'halts RILL-R038 for a leading plus, a radix prefix, and a separator',
      async () => {
        for (const s of ['"+5"', '"0x10"', '"1_000"']) {
          await expect(run(`${s} -> number`)).rejects.toMatchObject({
            errorId: 'RILL-R038',
          });
        }
      }
    );

    rule('number.from-other').it(
      'halts RILL-R036 converting an atom to number',
      async () => {
        await expect(run('#a -> number')).rejects.toMatchObject({
          errorId: 'RILL-R036',
        });
      }
    );

    rule('string.from-datetime').it(
      'halts RILL-R036 converting a datetime to string',
      async () => {
        await expect(
          run('datetime("2026-03-13") -> string')
        ).rejects.toMatchObject({ errorId: 'RILL-R036' });
      }
    );
  });
});
