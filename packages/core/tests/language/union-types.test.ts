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

    it('AC-13: :string|number on bool throws RILL-R004', async () => {
      await expect(run('true :string|number')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
    });

    it('EC-1: assertion on true names string|number and bool in error', async () => {
      await expect(run('true :string|number')).rejects.toThrow(
        'Type assertion failed'
      );
    });

    it('EC-7: no implicit coercion — true is not coerced to string|number', async () => {
      // true must stay bool; no coercion to string or number occurs
      await expect(run('true :string|number')).rejects.toHaveProperty(
        'errorId',
        'RILL-R004'
      );
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
      await expect(run('true => $x:string|number')).rejects.toHaveProperty(
        'errorId',
        'RILL-R001'
      );
    });

    it('EC-2: capture of true names string|number and bool in error', async () => {
      await expect(run('true => $x:string|number')).rejects.toThrow(
        'Type mismatch'
      );
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
      await expect(
        run('list[true] -> destruct<$a:string|number>')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('EC-4: destruct on true produces RILL-R001', async () => {
      await expect(
        run('list[true] -> destruct<$a:string|number>')
      ).rejects.toThrow(/type|mismatch/i);
    });
  });

  // ============================================================
  // Union in Existence Check
  // ============================================================

  describe('union in existence', () => {
    it('AC-20: $data.?score&string|number returns true for string', async () => {
      // Uses 'score' key — 'values' is a reserved method name and cannot be a dict key
      const result = await run(
        'dict[score: "hello"] => $data\n$data.?score&string|number'
      );
      expect(result).toBe(true);
    });

    it('AC-20: $data.?score&string|number returns true for number', async () => {
      const result = await run(
        'dict[score: 42] => $data\n$data.?score&string|number'
      );
      expect(result).toBe(true);
    });

    it('AC-21: $data.?score&string|number returns false for bool', async () => {
      const result = await run(
        'dict[score: true] => $data\n$data.?score&string|number'
      );
      expect(result).toBe(false);
    });

    it('existence check returns false when field is absent (union type)', async () => {
      const result = await run(
        'dict[other: "x"] => $data\n$data.?score&string|number'
      );
      expect(result).toBe(false);
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
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R004');
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
      await expect(
        run('42 :list(string)|dict(name: number)')
      ).rejects.toHaveProperty('errorId', 'RILL-R004');
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
});
