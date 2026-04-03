/**
 * Rill Language Tests: Whitespace Continuations
 * Tests for multi-line continuation gaps G1-G6 and statement boundary guard.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Whitespace Continuations', () => {
  describe('G1: Binary Operators across newlines', () => {
    it('adds two variables split across newline', async () => {
      const result = await run(`1 => $x\n2 => $y\n$x +\n$y`);
      expect(result).toBe(3);
    });

    it('produces same result as single-line addition', async () => {
      const multiLine = await run(`3 => $x\n4 => $y\n$x +\n$y`);
      const singleLine = await run(`3 => $x\n4 => $y\n$x + $y`);
      expect(multiLine).toBe(singleLine);
    });

    it('logical || across newline', async () => {
      const result = await run(`false => $a\ntrue => $b\n$a ||\n$b`);
      expect(result).toBe(true);
    });

    it('logical && across newline', async () => {
      const result = await run(`true => $a\nfalse => $b\n$a &&\n$b`);
      expect(result).toBe(false);
    });

    it('comparison == across newline', async () => {
      const result = await run(`"hello" => $a\n"hello" => $b\n$a ==\n$b`);
      expect(result).toBe(true);
    });

    it('comparison != across newline', async () => {
      const result = await run(`1 => $a\n2 => $b\n$a !=\n$b`);
      expect(result).toBe(true);
    });

    it('multiplication across newline', async () => {
      const result = await run(`3 => $x\n4 => $y\n$x *\n$y`);
      expect(result).toBe(12);
    });

    it('division across newline', async () => {
      const result = await run(`10 => $x\n2 => $y\n$x /\n$y`);
      expect(result).toBe(5);
    });

    it('modulo across newline', async () => {
      const result = await run(`7 => $x\n3 => $y\n$x %\n$y`);
      expect(result).toBe(1);
    });
  });

  describe('G1b: Line-start && and || continue expression', () => {
    it('|| at line-start continues expression', async () => {
      const result = await run(`false\n|| true`);
      expect(result).toBe(true);
    });

    it('&& at line-start continues expression', async () => {
      const result = await run(`true\n&& false`);
      expect(result).toBe(false);
    });

    it('chained && at line-start across multiple lines', async () => {
      const result = await run(`true\n&& true\n&& true`);
      expect(result).toBe(true);
    });

    it('mixed && and || at line-start with correct precedence', async () => {
      // && binds tighter than ||, so: false || (true && true) => true
      const result = await run(`false\n|| true\n&& true`);
      expect(result).toBe(true);
    });
  });

  describe('G2: Closure structure with newlines around | delimiters', () => {
    it('newline after opening | and closing | parses and executes', async () => {
      const result = await run(
        `|\nname: string|\n{ $name } => $fn\n$fn("alice")`
      );
      expect(result).toBe('alice');
    });

    it('newline before body after closing | parses and executes', async () => {
      const result = await run(
        `|name: string|\n{ $name } => $fn\n$fn("alice")`
      );
      expect(result).toBe('alice');
    });

    it('empty-param || with newline before body parses and executes', async () => {
      const result = await run(`||\n{ "hello" } => $fn\n$fn()`);
      expect(result).toBe('hello');
    });
  });

  describe('G3: Access chains with . and [ across newlines', () => {
    it('dot access across newline', async () => {
      const result = await run(`dict[name: "alice"] => $user\n$user\n.name`);
      expect(result).toBe('alice');
    });

    it('index access across newline', async () => {
      const result = await run(`list["a", "b"] => $items\n$items\n[0]`);
      expect(result).toBe('a');
    });

    it('chained dot access across newlines', async () => {
      const result = await run(
        `dict[name: "alice"] => $user\n$user\n.name\n.upper`
      );
      expect(result).toBe('ALICE');
    });
  });

  describe('G4: Postfix type assertion :type across newlines', () => {
    it('type assertion :string across newline returns value', async () => {
      const result = await run(`"hello" => $value\n$value\n:string`);
      expect(result).toBe('hello');
    });

    it('optional type assertion :?dict across newline returns bool', async () => {
      const result = await run(`dict[a: 1] => $value\n$value\n:?dict`);
      expect(result).toBe(true);
    });
  });

  describe('G5: Spread ... across newlines', () => {
    it('spread inside tuple with newline before variable', async () => {
      const result = await run(`list["a", "b"] => $base\nlist[...\n$base]`);
      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('G6: Closure param internals with newlines', () => {
    it('newline before : in typed param', async () => {
      const result = await run(
        `|name\n: string| { $name } => $fn\n$fn("alice")`
      );
      expect(result).toBe('alice');
    });

    it('newline after : in typed param', async () => {
      const result = await run(
        `|name:\nstring| { $name } => $fn\n$fn("alice")`
      );
      expect(result).toBe('alice');
    });

    it('newlines around = in default value param', async () => {
      // *[] (list spread) removed in Phase 2; call $fn() directly using default value
      const result = await run(`|x\n=\n1| { $x } => $fn\n$fn()`);
      expect(result).toBe(1);
    });
  });

  describe('AC-7: Adjacent identifier statements are not merged', () => {
    it('two capture statements on separate lines stay separate', async () => {
      const result = await run(`"a" => $a\n"b" => $b\n$b`);
      expect(result).toBe('b');
    });
  });

  describe('Error Cases', () => {
    it('EC-1 / AC-8: binary operator followed by newline then invalid token throws ParseError', () => {
      try {
        parse('5 +\n)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('EC-2 / AC-9: closure | opened with newline but unclosed throws ParseError RILL-P005', () => {
      try {
        parse('|\nname');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P005');
      }
    });

    it('EC-3 / AC-10: spread ... followed by newline then ] throws ParseError RILL-P004', () => {
      try {
        parse('list[...\n]');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P004');
      }
    });
  });

  describe('Boundary Conditions', () => {
    it('AC-11: multiple blank lines after binary operator evaluates correctly', async () => {
      const result = await run('5 +\n\n\n3');
      expect(result).toBe(8);
    });

    it('AC-12: access chain newline before [ with invalid index throws ParseError', () => {
      try {
        parse('"hello"\nlist[)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('AC-13: closure param with newlines before both : and type name parses correctly', async () => {
      const result = await run(
        '|name\n:\nstring| { $name } => $fn\n$fn("test")'
      );
      expect(result).toBe('test');
    });

    it('AC-14: empty-param || with multiple newlines before body evaluates correctly', async () => {
      const result = await run('||\n\n\n{ "hello" } => $fn\n$fn()');
      expect(result).toBe('hello');
    });
  });

  describe('Regression Guards', () => {
    it('AC-15: single-line addition still evaluates correctly', async () => {
      const result = await run('5 + 3');
      expect(result).toBe(8);
    });

    it('AC-15: single-line closure with param still works', async () => {
      const result = await run('|x| { $x } => $fn\n$fn("hi")');
      expect(result).toBe('hi');
    });

    it('AC-15: single-line spread still works', async () => {
      const result = await run('list[...list[1, 2]] => $t\n$t');
      expect(result).toEqual([1, 2]);
    });

    it('AC-15: single-line method chaining still works', async () => {
      const result = await run('"hello".len');
      expect(result).toBe(5);
    });

    it('AC-15: single-line type assertion still works', async () => {
      const result = await run('"hello":string');
      expect(result).toBe('hello');
    });
  });
});
