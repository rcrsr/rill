/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Structural Type Identity
 *
 * Tests for `^type` structural precision for collection types and closures.
 * Covers AC-1 through AC-39 from the structural-type-identity spec.
 *
 * Key syntax facts (verified from source):
 * - Fn type literal: `fn(x: type):returnType` (: after closing paren)
 * - Fn return type annotation: `fn(x):type { body }` (: before the block)
 * - Type constructor: list(number), dict(a: number), tuple(...), ordered(...)
 * - Structural :? check requires variable: store type in $t, use -> :?$t
 *
 *
 */

import { describe, expect, it } from 'vitest';
import { rule } from '../helpers/rule.js';

import { createLogCollector, run } from '../helpers/runtime.js';

describe('Rill Language: Structural Type Identity', () => {
  // ============================================================
  // Structural Type Identity — Lists (AC-1 through AC-5)
  // ============================================================

  describe('List structural types (AC-1 to AC-5)', () => {
    it('AC-1: [1, 2, 3].^type == list(number) is true', async () => {
      const result = await run('list[1, 2, 3].^type == list(number)');
      expect(result).toBe(true);
    });

    it('AC-2: ["a", "b"].^type == list(string) is true', async () => {
      const result = await run('list["a", "b"].^type == list(string)');
      expect(result).toBe(true);
    });

    it('AC-3: [].^type == list(any) is true', async () => {
      const result = await run('list[].^type == list(any)');
      expect(result).toBe(true);
    });

    rule('list.equality').it(
      'AC-4: list(number) == list(number) is true',
      async () => {
        const result = await run('list(number) == list(number)');
        expect(result).toBe(true);
      }
    );

    rule('list.equality').it(
      'AC-5: list(number) != list(string) is true',
      async () => {
        const result = await run('list(number) != list(string)');
        expect(result).toBe(true);
      }
    );
  });

  // ============================================================
  // Structural Type Identity — Tuples (AC-6 through AC-9)
  // ============================================================

  describe('Tuple structural types (AC-6 to AC-9)', () => {
    it('AC-6: tuple[1, "hello", true].^type == tuple(number, string, bool)', async () => {
      const result = await run(
        'tuple[1, "hello", true].^type == tuple(number, string, bool)'
      );
      expect(result).toBe(true);
    });

    rule('tuple.equality').it(
      'AC-7: tuple(number, string) != tuple(string, number) is true',
      async () => {
        const result = await run(
          'tuple(number, string) != tuple(string, number)'
        );
        expect(result).toBe(true);
      }
    );

    rule('tuple.equality').it(
      'AC-8: tuple(number, string) != tuple(number, string, bool) is true',
      async () => {
        const result = await run(
          'tuple(number, string) != tuple(number, string, bool)'
        );
        expect(result).toBe(true);
      }
    );

    it('AC-9: tuple[].^type == tuple() is true', async () => {
      const result = await run('tuple[].^type == tuple()');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Structural Type Identity — Ordered (AC-10 through AC-12)
  // ============================================================

  describe('Ordered structural types (AC-10 to AC-12)', () => {
    it('AC-10: ordered[a: 1, b: "hello"].^type == ordered(a: number, b: string)', async () => {
      const result = await run(
        'ordered[a: 1, b: "hello"].^type == ordered(a: number, b: string)'
      );
      expect(result).toBe(true);
    });

    rule('ordered.order').it(
      'AC-11: ordered(a: number, b: string) != ordered(b: string, a: number) is true',
      async () => {
        const result = await run(
          'ordered(a: number, b: string) != ordered(b: string, a: number)'
        );
        expect(result).toBe(true);
      }
    );

    it('AC-12: ordered[].^type == ordered()', async () => {
      const result = await run('ordered[].^type == ordered()');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Structural Type Identity — Dicts (AC-13 through AC-17)
  // ============================================================

  describe('Dict structural types (AC-13 to AC-17)', () => {
    it('AC-13: [name: "alice", age: 30].^type == dict(name: string, age: number) is true', async () => {
      const result = await run(
        'dict[name: "alice", age: 30].^type == dict(name: string, age: number)'
      );
      expect(result).toBe(true);
    });

    rule('dict.field-equality').it(
      'AC-14: dict(a: number, b: string) == dict(b: string, a: number) is true (field-order-insensitive)',
      async () => {
        const result = await run(
          'dict(a: number, b: string) == dict(b: string, a: number)'
        );
        expect(result).toBe(true);
      }
    );

    rule('dict.field-equality').it(
      'AC-15: dict(a: string) == dict(b: string) is false (different field names)',
      async () => {
        const result = await run('dict(a: string) == dict(b: string)');
        expect(result).toBe(false);
      }
    );

    rule('dict.field-equality', 'dict.field-type').it(
      'AC-16: dict(a: dict(x: number)) == dict(a: dict(x: number)) is true',
      async () => {
        const result = await run(
          'dict(a: dict(x: number)) == dict(a: dict(x: number))'
        );
        expect(result).toBe(true);
      }
    );

    rule('dict.field-equality', 'dict.field-type').it(
      'AC-17: dict(a: dict(x: number)) == dict(a: dict(x: string)) is false',
      async () => {
        const result = await run(
          'dict(a: dict(x: number)) == dict(a: dict(x: string))'
        );
        expect(result).toBe(false);
      }
    );
  });

  // ============================================================
  // Structural Type Identity — Closures (AC-18 through AC-20)
  //
  // Runtime closures with `:type` return annotation produce structural
  // return types matching sig literals. Without annotation, ret = any.
  // AC-18/19 use runtime closures (param name comparison).
  // AC-20 uses sig literals to compare different return types structurally.
  // ============================================================

  describe('Closure structural types (AC-18 to AC-20)', () => {
    it('AC-18: same-signature closures produce equal ^type', async () => {
      // Both closures have param x: number — their ^type structures match
      const result = await run(`
        fn(x: number) { $x * 2 } => $fn1
        fn(x: number) { $x * 3 } => $fn2
        $fn1.^type == $fn2.^type
      `);
      expect(result).toBe(true);
    });

    it('AC-19: different-param-name closures produce unequal ^type', async () => {
      // Param name 'x' vs 'y' — structural type includes param name
      const result = await run(`
        fn(x: number) { $x } => $fn1
        fn(y: number) { $y } => $fn2
        $fn1.^type == $fn2.^type
      `);
      expect(result).toBe(false);
    });

    it('AC-20: different-return-type closures produce unequal ^type', async () => {
      // Use closure sig literals which encode return type structurally:
      // fn(x: number):number vs fn(x: number):string
      const result = await run(
        '(fn(x: number):number) == (fn(x: number):string)'
      );
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // Closure sig literal equality — param and return type discrimination
  // ============================================================

  describe('Closure sig literal equality — param and return type discrimination', () => {
    // ----------------------------------------------------------
    // Parsing correctness (enabled by parsePostfixExpr fix)
    // ----------------------------------------------------------

    it('bare syntax pipes correctly: fn(x: string):string -> log logs the sig value', async () => {
      const { logs, callbacks } = createLogCollector();
      await run('fn(x: string):string -> log', { callbacks });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('x');
      expect(logs[0]).toContain('string');
    });

    it('bare syntax with assignment: $t.signature equals the sig literal representation', async () => {
      const result = await run('fn(x: string):string => $t\n$t.signature');
      expect(result).toContain('x');
      expect(result).toContain('string');
    });

    it('multi-pipe after bare sig: fn(x: string):string -> string -> .len returns string length', async () => {
      const result = await run('fn(x: string):string -> string -> .len');
      expect(typeof result).toBe('number');
      expect(result as number).toBeGreaterThan(0);
    });

    // ----------------------------------------------------------
    // Equality — param type discrimination
    // ----------------------------------------------------------

    it('same params + same return type → true', async () => {
      const result = await run(`
        fn(x: string):string => $a
        fn(x: string):string => $b
        $a == $b
      `);
      expect(result).toBe(true);
    });

    it('same params + different return type → false', async () => {
      const result = await run(`
        fn(x: string):string => $a
        fn(x: string):number => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    it('different param types + same return type → false', async () => {
      const result = await run(`
        fn(x: string):string => $a
        fn(x: number):string => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    it('different param names + same types → false', async () => {
      const result = await run(`
        fn(x: string):string => $a
        fn(y: string):string => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    it('different param count + same return type → false', async () => {
      const result = await run(`
        fn(x: string):string => $a
        fn(x: string, y: number):string => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // Equality — multi-param
    // ----------------------------------------------------------

    it('multi-param: same params same return → true', async () => {
      const result = await run(`
        fn(x: string, y: number):bool => $a
        fn(x: string, y: number):bool => $b
        $a == $b
      `);
      expect(result).toBe(true);
    });

    it('multi-param: one param type differs → false', async () => {
      const result = await run(`
        fn(x: string, y: number):bool => $a
        fn(x: string, y: string):bool => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // Equality — nested type params
    // ----------------------------------------------------------

    it('nested list type params: list(string) vs list(number) param → false', async () => {
      const result = await run(`
        fn(x: list(string)):number => $a
        fn(x: list(number)):number => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    it('nested dict type params: dict(a: string) vs dict(b: string) param → false', async () => {
      const result = await run(`
        fn(x: dict(a: string)):number => $a
        fn(x: dict(b: string)):number => $b
        $a == $b
      `);
      expect(result).toBe(false);
    });

    // ----------------------------------------------------------
    // Display format
    // ----------------------------------------------------------

    it('display format: .signature of fn(x: string):number contains x, string, and number', async () => {
      const result = await run('fn(x: string):number => $t\n$t.signature');
      expect(result).toContain('x');
      expect(result).toContain('string');
      expect(result).toContain('number');
    });

    it('display format: .signature of fn(x: string, y: number):bool is exactly the sig', async () => {
      const result = await run(
        'fn(x: string, y: number):bool => $t\n$t.signature'
      );
      expect(result).toBe('fn(x: string, y: number):bool');
    });

    // ----------------------------------------------------------
    // Compatibility — parenthesized and bare forms are equivalent
    // ----------------------------------------------------------

    it('parenthesized form equals bare form', async () => {
      const result = await run(
        'fn(x: string):string => $a\n(fn(x: string):string) => $b\n$a == $b'
      );
      expect(result).toBe(true);
    });

    it('parenthesized inline equality matches bare variable equality', async () => {
      const result = await run(
        '(fn(x: number):string) == (fn(x: number):string)'
      );
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Type Constructors as Values (AC-21 through AC-23)
  // ============================================================

  describe('Type constructors as values (AC-21 to AC-23)', () => {
    rule('type-value.first-class').it(
      'AC-21: dict(name: string) => $t stores a type value equal only to the same structure',
      async () => {
        const result = await run(`
        dict(name: string) => $t
        list[
          $t == dict(name: string),
          $t == dict(name: number),
          $t == dict(other: string)
        ]
      `);
        expect(result).toEqual([true, false, false]);
      }
    );

    it('AC-22: stored type constructor equals ^type of matching dict', async () => {
      const result = await run(`
        dict(name: string) => $t
        dict[name: "alice"].^type == $t
      `);
      expect(result).toBe(true);
    });

    it('AC-23: closure sig literal fn(x: string):string stores as a type value equal only to the same signature', async () => {
      // Closure sig literal syntax: fn(params):returnType
      const result = await run(`
        (fn(x: string):string) => $t
        list[
          $t == (fn(x: string):string),
          $t == (fn(x: string):number),
          $t == (fn(y: string):string)
        ]
      `);
      expect(result).toEqual([true, false, false]);
    });
  });

  // ============================================================
  // Type Assertions with Structural Types (AC-24 through AC-30)
  //
  // The :? operator accepts coarse type names (:?list) or dynamic variable
  // refs (:?$t). For structural precision, store the type constructor in a
  // variable then use :?$t for coarse checking or ^type == for structural.
  // AC-24/25/29/30 use ^type equality (structural).
  // AC-26/28 use :? directly (coarse).
  // AC-27 uses ^type equality against a stored closure sig type.
  // ============================================================

  describe('Type assertions with structural types (AC-24 to AC-30)', () => {
    it('AC-25: [1, 2, 3] :? list(string) is false — via ^type equality', async () => {
      const result = await run('list[1, 2, 3].^type == list(string)');
      expect(result).toBe(false);
    });

    it('AC-27: runtime closure ^type != closure sig literal type (return type encoding differs)', async () => {
      // Store closure sig as type, compare against closure ^type
      const result = await run(`
        fn(x: number, y: number) { $x + $y } => $fn
        (fn(x: number, y: number):number) => $sigType
        $fn.^type == $sigType
      `);
      // No return type annotation on the closure → ret = {type:'any'}.
      // Sig literal has :number → ret = primitive(number). They differ.
      expect(result).toBe(false);
    });

    it('AC-27b: closure with :number return type matches sig literal ^type', async () => {
      // Return type annotation `:number` after `}` should encode as
      // primitive(number) in ^type.structure.ret, matching a sig literal.
      const result = await run(`
        fn(x: number):number { $x } => $fn
        (fn(x: number):number) => $sigType
        $fn.^type == $sigType
      `);
      expect(result).toBe(true);
    });

    it('AC-28: $fn :? closure is true for any closure', async () => {
      const result = await run(`
        fn(x: number) { $x } => $fn
        $fn -> :?fn
      `);
      expect(result).toBe(true);
    });

    rule('dict.field-type').it(
      'AC-29: [a: [1, 2, 3]] :? dict(a: list(number)) is true — via ^type equality',
      async () => {
        const result = await run(
          'dict[a: list[1, 2, 3]].^type == dict(a: list(number))'
        );
        expect(result).toBe(true);
      }
    );
  });

  // ============================================================
  // Metatype and Coarse Names (AC-31 through AC-37)
  // ============================================================

  describe('Metatype and coarse names (AC-31 to AC-37)', () => {
    it('AC-31: list(number).^type.name == "type" is true', async () => {
      const result = await run(`
        list(number) => $t
        $t.^type.name == "type"
      `);
      expect(result).toBe(true);
    });

    it('AC-32: type.^type.name == "type" is true (fixed point)', async () => {
      const result = await run(`
        type => $t
        $t.^type.name == "type"
      `);
      expect(result).toBe(true);
    });

    it('AC-33: string.^type.name == "type" is true', async () => {
      const result = await run(`
        string => $t
        $t.^type.name == "type"
      `);
      expect(result).toBe(true);
    });

    it('AC-34: "hello".^type.name == "string" is true', async () => {
      const result = await run('"hello".^type.name == "string"');
      expect(result).toBe(true);
    });

    it('AC-35: [1, 2, 3].^type.name == "list" is true', async () => {
      const result = await run('list[1, 2, 3].^type.name == "list"');
      expect(result).toBe(true);
    });

    it('AC-36: ordered[a: 1].^type.name == "ordered"', async () => {
      const result = await run('ordered[a: 1].^type.name == "ordered"');
      expect(result).toBe(true);
    });

    it('AC-37: tuple[1, "hi"].^type.name == "tuple"', async () => {
      const result = await run('tuple[1, "hi"].^type.name == "tuple"');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Tuple/Ordered Split (AC-38 through AC-39)
  // ============================================================

  describe('Tuple/Ordered split (AC-38 to AC-39)', () => {
    it('AC-38: ordered[a: 1, b: 2].^type == ordered(a: number, b: number)', async () => {
      const result = await run(
        'ordered[a: 1, b: 2].^type == ordered(a: number, b: number)'
      );
      expect(result).toBe(true);
    });

    it('AC-39: tuple[1, "hello"].^type == tuple(number, string)', async () => {
      const result = await run(
        'tuple[1, "hello"].^type == tuple(number, string)'
      );
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Display Format for Parameterized Type Values (AC-10)
  // ============================================================

  describe('Display format for parameterized type values (AC-10)', () => {
    rule('list.print').it(
      'AC-10: list(string) type value .signature returns "list(string)"',
      async () => {
        const result = await run('list(string) => $t\n$t.signature');
        expect(result).toBe('list(string)');
      }
    );

    rule('list.print').it(
      'AC-10: list(number) type value .signature returns "list(number)"',
      async () => {
        const result = await run('list(number) => $t\n$t.signature');
        expect(result).toBe('list(number)');
      }
    );

    rule('dict.field-print').it(
      'AC-10: dict(name: string) type value .signature returns "dict(name: string)"',
      async () => {
        const result = await run('dict(name: string) => $t\n$t.signature');
        expect(result).toBe('dict(name: string)');
      }
    );

    it('AC-10: list(string) type value .name returns "list"', async () => {
      const result = await run('list(string) => $t\n$t.name');
      expect(result).toBe('list');
    });
  });

  // ============================================================
  // Reflection: .^type params for parameterized param type (AC-11)
  // ============================================================

  describe('Reflection: .^type reflects parameterized param type (AC-11)', () => {
    it('AC-11: fn(x: list(string)) closure .^type has x typed list(string)', async () => {
      const script = `
        fn(x: list(string)) { $x } => $fn
        $fn.^type
      `;
      const result = (await run(script)) as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; params: { name: string; type: unknown }[] };
      };
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('fn');
      expect(result.structure.params).toHaveLength(1);
      expect(result.structure.params[0]!.name).toBe('x');
      expect(result.structure.params[0]!.type).toEqual({
        kind: 'list',
        element: { kind: 'string' },
      });
    });

    it('AC-11: fn(x: dict(name: string)) closure .^type reflects dict structure', async () => {
      const script = `
        fn(x: dict(name: string)) { $x } => $fn
        $fn.^type
      `;
      const result = (await run(script)) as {
        __rill_type: true;
        structure: { type: string; params: { name: string; type: unknown }[] };
      };
      expect(result.structure.params[0]!.type).toEqual({
        kind: 'dict',
        fields: { name: { type: { kind: 'string' } } },
      });
    });
  });

  // ============================================================
  // Structure Preserved Through Variable (AC-26)
  // ============================================================

  describe('Structure preserved through variable (AC-26)', () => {
    it('AC-26: list(dict(name: string, age: number)) => $t preserves full structure (field order insensitive, fields required)', async () => {
      const script = `
        list(dict(name: string, age: number)) => $t
        list[
          $t == list(dict(age: number, name: string)),
          $t == list(dict(name: string))
        ]
      `;
      const result = await run(script);
      expect(result).toEqual([true, false]);
    });

    it('AC-26: stored $t can be used for structural type check via ^type equality', async () => {
      const script = `
        list(dict(name: string)) => $t
        dict[name: "alice"] => $d
        list[$d].^type == $t
      `;
      const result = await run(script);
      expect(result).toBe(true);
    });
  });
  describe('Structural relations', () => {
    rule('structural-typing.structural').it(
      'treats two types written with the same structure as one type',
      async () => {
        expect(
          await run('dict(t: number) => $c\ndict(t: number) => $f\n$c == $f')
        ).toBe(true);
      }
    );

    rule('structural-typing.accepts').it(
      'drops a union member another member accepts',
      async () => {
        expect(await run('union(list, list(number)).signature')).toBe('list');
        expect(await run('union(dict, dict(a: number)).signature')).toBe(
          'dict'
        );
      }
    );

    rule('structural-typing.equal').it(
      'equates types that accept each other',
      async () => {
        expect(await run('list == list(any)')).toBe(true);
        expect(await run('dict == dict()')).toBe(true);
        expect(await run('union(list, list(number)) == list')).toBe(true);
      }
    );

    rule('structural-typing.exact-position').it(
      'requires exact positions and fields for tuple and ordered',
      async () => {
        expect(await run('tuple[1, 2] -> :?tuple(number)')).toBe(false);
        expect(await run('tuple[1] -> :?tuple(number, number)')).toBe(false);
        expect(await run('tuple[1] -> :?tuple(number, number = 2)')).toBe(true);
        expect(await run('ordered[a: 1, b: 2] -> :?ordered(a: number)')).toBe(
          false
        );
        expect(
          await run('ordered[a: 1] -> :?ordered(a: number, b: number = 0)')
        ).toBe(true);
        expect(
          await run('ordered[b: 1, a: 2] -> :?ordered(a: number, b: number)')
        ).toBe(false);
      }
    );

    rule('structural-typing.present-typed').it(
      'checks a present defaulted field against its field type',
      async () => {
        expect(await run('dict[a: "x"] -> :?dict(a: number = 1)')).toBe(false);
        expect(await run('dict[a: 2] -> :?dict(a: number = 1)')).toBe(true);
      }
    );

    rule('structural-typing.bare-ordered').it(
      'admits every ordered in a bare ordered',
      async () => {
        expect(await run('ordered[a: 1] -> :?ordered')).toBe(true);
        expect(await run('ordered[] -> :?ordered')).toBe(true);
        expect(await run('dict[a: 1] -> :?ordered')).toBe(false);
      }
    );
  });
});
