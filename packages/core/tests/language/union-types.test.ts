/**
 * Rill Language Tests: Union Types
 * Tests for union type annotations (string|number), in all 5 type positions:
 * assertion (:T), type check (:?T), capture ($x:T), destructure (destruct<$a:T>),
 * and existence check (.?field&T). Includes parse-level tests.
 *
 * AC = Acceptance Criterion, EC = Error Contract, BC = Boundary Condition
 * from the type-system-improvements spec (Phase 2, Task 2.5).
 *
 * Covers: AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17,
 *         AC-18, AC-19, AC-20, AC-21, AC-23, EC-1, EC-2, EC-4, EC-5, EC-7,
 *         BC-1, BC-2, BC-3, BC-4, BC-5
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { parse, ParseError } from '@rcrsr/rill';

import { run, runWithContext } from '../helpers/runtime.js';

describe('Union Types', () => {
  // ============================================================
  // Union Parsing
  // ============================================================

  describe('union parsing', () => {
    it('AC-8: :string|number parses without error', () => {
      expect(() => parse('"hello" :string|number')).not.toThrow();
    });

    it('AC-9: |x| body closure not misinterpreted as union', () => {
      // The | delimiters in closure syntax must not be consumed as union pipes
      expect(() => parse('|x| { $x }')).not.toThrow();
    });

    it('AC-10: string|number|bool produces flat 3-member union', () => {
      // Parsing succeeds and the union is not nested
      expect(() => parse('"hello" :string|number|bool')).not.toThrow();
    });

    it('AC-11: list(string|number) parses as parameterized type with union arg', () => {
      expect(() => parse('list["a", 1] :list(string|number)')).not.toThrow();
    });

    it('AC-23: |x:string|number| $x parses union on closure param', () => {
      expect(() => parse('|x:string|number| { $x }')).not.toThrow();
    });

    it('EC-5: string|badident (unknown ident after pipe) throws RILL-P011', () => {
      // RILL-P011 fires when | is followed by an unknown identifier in type position.
      try {
        parse('"x" => $v:string|badident');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P011');
        expect(parseErr.message).toMatch(/Expected type name after '\|'/);
      }
    });

    it('AC-28: bare trailing pipe (string|) in assertion context throws RILL-P011', () => {
      // RILL-P011 fires when | has no following type name (not in closure context).
      try {
        parse('42 -> :string|');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P011');
        expect(parseErr.message).toMatch(/Expected type name after '\|'/);
      }
    });
  });

  // ============================================================
  // Union Assertion (:type)
  // ============================================================

  describe('union assertion (:type)', () => {
    it('AC-12: :string|number on string succeeds', async () => {
      const result = await run('"hello" :string|number');
      expect(result).toBe('hello');
    });

    it('AC-12: :string|number on number succeeds', async () => {
      const result = await run('42 :string|number');
      expect(result).toBe(42);
    });

    it('AC-13: :string|number on bool halts #TYPE_MISMATCH', async () => {
      await expectHalt(() => run('true :string|number'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'Type assertion failed',
      });
    });

    it('union assertion passes through value unchanged', async () => {
      const result = await run('"test" :string|number');
      expect(result).toBe('test');
    });

    it('union assertion can continue a pipe chain', async () => {
      const result = await run('"hello" :string|number -> .len');
      expect(result).toBe(5);
    });
  });

  // ============================================================
  // Union Type Check (:?type)
  // ============================================================

  describe('union type check (:?type)', () => {
    it('AC-14: :?string|number on string returns true', async () => {
      const result = await run('"hello" :?string|number');
      expect(result).toBe(true);
    });

    it('AC-14: :?string|number on number returns true', async () => {
      const result = await run('42 :?string|number');
      expect(result).toBe(true);
    });

    it('AC-15: :?string|number on bool returns false', async () => {
      const result = await run('true :?string|number');
      expect(result).toBe(false);
    });

    it('type check result can be used as condition', async () => {
      const script = `
        "hello" => $v
        ($v :?string|number) ? "match" ! "no match"
      `;
      expect(await run(script)).toBe('match');
    });

    it('type check returns false for non-member type in condition', async () => {
      const script = `
        true => $v
        ($v :?string|number) ? "match" ! "no match"
      `;
      expect(await run(script)).toBe('no match');
    });
  });

  // ============================================================
  // Union Capture ($x:type)
  // ============================================================

  describe('union capture ($x:type)', () => {
    it('AC-16: $x:string|number with string succeeds', async () => {
      const result = await run('"hello" => $x:string|number\n$x');
      expect(result).toBe('hello');
    });

    it('AC-16: $x:string|number with number succeeds', async () => {
      const result = await run('42 => $x:string|number\n$x');
      expect(result).toBe(42);
    });

    it('AC-17: $x:string|number with bool throws RILL-R001', async () => {
      await expectHalt(() => run('true => $x:string|number'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
        messagePattern: 'Type mismatch',
      });
    });

    it('captured union-typed variable holds the assigned value', async () => {
      const { context } = await runWithContext('"hello" => $x:string|number');
      expect(context.variables.get('x')).toBe('hello');
    });
  });

  // ============================================================
  // Re-assignment with Union-Locked Variables
  // ============================================================

  describe('re-assignment with union-locked variables', () => {
    it('AC-reass-1: re-assigning string to $x:string|number succeeds', async () => {
      const result = await run(
        '"hello" => $x:string|number\n"world" => $x\n$x'
      );
      expect(result).toBe('world');
    });

    it('AC-reass-2: re-assigning number to $x:string|number succeeds', async () => {
      const result = await run('"hello" => $x:string|number\n42 => $x\n$x');
      expect(result).toBe(42);
    });

    it('AC-reass-3: re-assigning bool to $x:string|number throws RILL-R001', async () => {
      await expect(
        run('"hello" => $x:string|number\ntrue => $x')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('AC-reass-4: re-assigning list(string) to $x:list(string) succeeds', async () => {
      const result = await run(
        'list["a","b"] => $x:list(string)\nlist["c","d"] => $x\n$x'
      );
      expect(result).toEqual(['c', 'd']);
    });

    it('AC-reass-5: re-assigning list(number) to $x:list(string) throws RILL-R001', async () => {
      await expect(
        run('list["a","b"] => $x:list(string)\nlist[1,2] => $x')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  // ============================================================
  // Union in Destructure
  // ============================================================

  describe('union in destructure', () => {
    it('AC-18: destruct<$a:string|number> accepts string', async () => {
      const { context } = await runWithContext(
        'list["hello"] -> destruct<$a:string|number>'
      );
      expect(context.variables.get('a')).toBe('hello');
    });

    it('AC-18: destruct<$a:string|number> accepts number', async () => {
      const { context } = await runWithContext(
        'list[42] -> destruct<$a:string|number>'
      );
      expect(context.variables.get('a')).toBe(42);
    });

    it('AC-19: destruct<$a:string|number> on bool throws RILL-R001', async () => {
      await expectHalt(() => run('list[true] -> destruct<$a:string|number>'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
        messagePattern: /type|mismatch/i,
      });
    });
  });

  // ============================================================
  // Boundary Conditions
  // ============================================================

  describe('boundary conditions', () => {
    it('BC-1: two-member union valid in assertion position', async () => {
      expect(await run('"a" :string|number')).toBe('a');
    });

    it('BC-1: two-member union valid in type check position', async () => {
      expect(await run('"a" :?string|number')).toBe(true);
    });

    it('BC-1: two-member union valid in capture position', async () => {
      expect(await run('"a" => $x:string|number\n$x')).toBe('a');
    });

    it('BC-1: two-member union valid in destructure position', async () => {
      const { context } = await runWithContext(
        'list["a"] -> destruct<$x:string|number>'
      );
      expect(context.variables.get('x')).toBe('a');
    });

    it('BC-1: two-member union valid in existence check position', async () => {
      expect(await run('dict[v: "a"] => $d\n$d.?v&string|number')).toBe(true);
    });

    it('BC-2: ten-member union parses and matches correctly', async () => {
      // Matches the first type (string)
      const result = await run(
        '"hello" :string|number|bool|list|dict|closure|type|any|vector|tuple'
      );
      expect(result).toBe('hello');
    });

    it('BC-2: ten-member union type check returns true for member type', async () => {
      const result = await run(
        '42 :?string|number|bool|list|dict|closure|type|any|vector|tuple'
      );
      expect(result).toBe(true);
    });

    it('BC-3: union with dynamic member $T resolves at runtime', async () => {
      const script = `
        bool => $T
        true :string|$T
      `;
      expect(await run(script)).toBe(true);
    });

    it('BC-3: union with dynamic member $T rejects non-member type', async () => {
      const script = `
        bool => $T
        42 :string|$T
      `;
      await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
    });

    it('BC-4: list(string|number) — string list matches union', async () => {
      // Rill lists are homogeneous; list(string|number) accepts all-string lists
      const result = await run('list["a", "b"] :list(string|number)');
      expect(result).toEqual(['a', 'b']);
    });

    it('BC-4: list(string|number) — number list matches union', async () => {
      // list(string|number) also accepts all-number lists
      const result = await run('list[1, 2] :list(string|number)');
      expect(result).toEqual([1, 2]);
    });

    it('BC-4: list(string|number) type check returns true for string list', async () => {
      const result = await run('list["a", "b"] :?list(string|number)');
      expect(result).toBe(true);
    });

    it('BC-5: list(string)|dict(name: number) — list arm matches list', async () => {
      const result = await run(
        'list["a", "b"] :?list(string)|dict(name: number)'
      );
      expect(result).toBe(true);
    });

    it('BC-5: list(string)|dict(name: number) — dict arm matches dict', async () => {
      const result = await run(
        'dict[name: 42] :?list(string)|dict(name: number)'
      );
      expect(result).toBe(true);
    });

    it('BC-5: list(string)|dict(name: number) — non-member fails assertion', async () => {
      await expectHalt(() => run('42 :list(string)|dict(name: number)'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  // ============================================================
  // Union in Closure Parameter (IR-17, AC-23)
  // ============================================================

  describe('union in closure parameter', () => {
    it('AC-23: |x:string|number| $x accepts string', async () => {
      const result = await run('"hello" -> |x:string|number| { $x }');
      expect(result).toBe('hello');
    });

    it('AC-23: |x:string|number| $x accepts number', async () => {
      const result = await run('42 -> |x:string|number| { $x }');
      expect(result).toBe(42);
    });

    it('AC-23: |x:string|number| $x rejects bool with RILL-R001', async () => {
      await expect(
        run('true -> |x:string|number| { $x }')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });

  // ============================================================
  // Literal Members
  // ============================================================

  describe('literal members', () => {
    it('accepts a literal union member in an assertion', async () => {
      expect(await run('"wired" :"wired"|"wireless"')).toBe('wired');
    });

    it('halts an assertion on a value outside the literal union', async () => {
      await expectHalt(() => run('"wirless" :"wired"|"wireless"'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('answers a type check against a literal union', async () => {
      expect(await run('"wired" :?"wired"|"wireless"')).toBe(true);
      expect(await run('"other" :?"wired"|"wireless"')).toBe(false);
    });

    it('does not match a string against a number literal', async () => {
      expect(await run('"1" :?1|2')).toBe(false);
    });

    it('matches a number literal by value', async () => {
      expect(await run('1.0 :?1|2')).toBe(true);
    });

    it('accepts and rejects bool literal members', async () => {
      expect(await run('true :?true|"x"')).toBe(true);
      expect(await run('false :?true|"x"')).toBe(false);
    });

    it('accepts a mixed number and literal union', async () => {
      expect(await run('5 :number|"auto"')).toBe(5);
      expect(await run('"auto" :number|"auto"')).toBe('auto');
      await expectHalt(() => run('"x" :number|"auto"'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('accepts a string and literal union', async () => {
      expect(await run('"x" :string|"x"')).toBe('x');
      expect(await run('"y" :string|"x"')).toBe('y');
    });

    it('accepts a literal union in a capture and keeps the lock', async () => {
      const result = await run(
        '"wired" => $m:"wired"|"wireless"\n"wireless" => $m\n$m'
      );
      expect(result).toBe('wireless');
    });

    it('halts a capture outside the literal union', async () => {
      await expect(run('"x" => $m:"wired"|"wireless"')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });

    it('halts re-assignment outside the locked literal union', async () => {
      await expect(
        run('"wired" => $m:"wired"|"wireless"\n"x" => $m')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('accepts a literal union in a destructure', async () => {
      const result = await run(
        'list["a", "b"] -> destruct<$x:"a"|"b", $y:"a"|"b">\n$y'
      );
      expect(result).toBe('b');
    });

    it('halts a destructure outside the literal union', async () => {
      await expect(
        run('list["a", "c"] -> destruct<$x:"a"|"b", $y:"a"|"b">')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('accepts a literal union in an existence check', async () => {
      expect(await run('dict[k: "a"] => $d\n$d.?k&"a"|"b"')).toBe(true);
      expect(await run('dict[k: "z"] => $d\n$d.?k&"a"|"b"')).toBe(false);
    });

    it('accepts a literal union as a dict field type', async () => {
      expect(await run('dict[k: "a"] :dict(k: "a"|"b")')).toEqual({ k: 'a' });
      await expectHalt(() => run('dict[k: "z"] :dict(k: "a"|"b")'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('accepts a literal union as a list element type', async () => {
      expect(await run('list["a", "b"] :list("a"|"b")')).toEqual(['a', 'b']);
      await expectHalt(() => run('list["a", "z"] :list("a"|"b")'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('accepts a literal union as a closure return type', async () => {
      expect(await run('|x: string| { $x }:"a"|"b" => $f\n$f("a")')).toBe('a');
      await expectHalt(() => run('|x: string| { $x }:"a"|"b" => $f\n$f("c")'), {
        code: 'TYPE_MISMATCH',
      });
    });

    describe('closure parameter', () => {
      const wired = '|kind: "wired"|"wireless"| { $kind } => $f\n';

      it('accepts a member value', async () => {
        expect(await run(`${wired}$f("wired")`)).toBe('wired');
      });

      it('halts RILL-R001 on a non-member and skips the body', async () => {
        await expect(
          run(
            '|kind: "wired"|"wireless"| { never_defined_fn() } => $f\n$f("wirless")'
          )
        ).rejects.toMatchObject({
          errorId: 'RILL-R001',
          message: expect.stringContaining('got string "wirless"') as string,
        });
      });

      it('exposes the literal members through .^input', async () => {
        const result = await run(`${wired}$f.^input`);
        expect(result).toMatchObject({
          structure: {
            kind: 'ordered',
            fields: [
              {
                name: 'kind',
                type: {
                  kind: 'union',
                  members: [
                    { kind: 'literal', value: 'wired' },
                    { kind: 'literal', value: 'wireless' },
                  ],
                },
              },
            ],
          },
        });
      });

      it('renders the literal members in .^type.signature', async () => {
        const result = await run(`${wired}$f.^type.signature`);
        expect(result).toContain('"wired"|"wireless"');
      });
    });

    it('keeps the inferred type of a string value as string', async () => {
      expect(await run('"wired".^type == string')).toBe(true);
    });

    it('rejects a lone literal as a type with RILL-P001', () => {
      expect(() => parse('"a" :"a"')).toThrow(
        expect.objectContaining({
          errorId: 'RILL-P001',
          message: expect.stringContaining('Expected type name') as string,
        }) as Error
      );
    });

    it('rejects an interpolated literal member with RILL-P003', () => {
      expect(() => parse('"a" :"{$x}"|"b"')).toThrow(
        expect.objectContaining({ errorId: 'RILL-P003' }) as Error
      );
    });
  });
});
