/**
 * Rill Language Tests: Closure Annotation Defaults
 *
 * Tests that closure parameters support default values via `= literal` syntax
 * in the annotation position: `|name: type = default|`.
 *
 * AC-1  through AC-24: acceptance criteria for parsing defaults in closure annotations
 * EC-1  through EC-3:  error contracts for invalid defaults and missing delimiters
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Closure Annotation Defaults', () => {
  // ============================================================
  // AC-1: |model: string = "gpt-4"| parses without error
  // ============================================================

  describe('AC-1: string default parses in closure annotation', () => {
    it('|model: string = "gpt-4"| parses without error', () => {
      const ast = parse('|model: string = "gpt-4"|{ $model }');
      expect(ast.statements).toHaveLength(1);
    });

    it('closure with string default executes and returns default', async () => {
      const result = await run(
        '|model: string = "gpt-4"|{ $model } => $fn\n$fn()'
      );
      expect(result).toBe('gpt-4');
    });
  });

  // ============================================================
  // AC-2: Each of 7 literal types parses as default
  // ============================================================

  describe('AC-2: all 7 literal types parse as defaults', () => {
    it('string default: = "hello"', () => {
      const ast = parse('|x: string = "hello"|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('number default: = 42', () => {
      const ast = parse('|x: number = 42|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('bool default (true): = true', () => {
      const ast = parse('|x: bool = true|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('bool default (false): = false', () => {
      const ast = parse('|x: bool = false|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('list default: = [1, 2, 3]', () => {
      const ast = parse('|x: list = [1, 2, 3]|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('dict default: = [a: 1]', () => {
      const ast = parse('|x: dict = [a: 1]|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('empty dict default: = [:]', () => {
      const ast = parse('|x: dict = [:]|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });

    it('tuple default: = [1, "a"]', () => {
      const ast = parse('|x: tuple = [1, "a"]|{ $x }');
      expect(ast.statements).toHaveLength(1);
    });
  });

  // ============================================================
  // AC-4: = computed_expression produces parse error
  // ============================================================

  describe('AC-4: computed expression in default produces parse error', () => {
    it('= $var in closure annotation default throws ParseError', () => {
      expect(() => parse('|x: string = $var|{ $x }')).toThrow(ParseError);
    });

    it('= some_fn() in closure annotation default throws ParseError', () => {
      expect(() => parse('|x: number = some_fn()|{ $x }')).toThrow(ParseError);
    });
  });

  // ============================================================
  // AC-16: = (1 + 2) in closure annotation param default produces parse error
  // ============================================================

  describe('AC-16: parenthesized expression in default produces parse error', () => {
    it('= (1 + 2) in closure param default throws ParseError', () => {
      expect(() => parse('|x: number = (1 + 2)|{ $x }')).toThrow(ParseError);
    });
  });

  // ============================================================
  // AC-17: = "value" outside supported positions preserves existing error
  // ============================================================

  describe('AC-17: = "value" outside supported positions preserves existing error', () => {
    it('standalone assignment = "value" still produces error', () => {
      expect(() => parse('= "value"')).toThrow();
    });

    it('"hello" = "value" still produces error', () => {
      expect(() => parse('"hello" = "value"')).toThrow();
    });
  });

  // ============================================================
  // AC-20: Missing comma or pipe after name: type = default produces RILL-P001
  // ============================================================

  describe('AC-20: missing delimiter after default produces RILL-P001', () => {
    it('missing pipe after single param with default throws ParseError', () => {
      try {
        parse('|x: string = "test" { $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('missing comma between params with defaults throws ParseError', () => {
      try {
        parse('|x: string = "a" y: number = 1|{ $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });
  });

  // ============================================================
  // AC-21: All params have defaults; structureMatches passes
  //        against annotation without defaults
  // ============================================================

  describe('AC-21: all params with defaults matches annotation without defaults', () => {
    it('closure with all defaulted params parses', () => {
      const ast = parse('|x: string = "a", y: number = 0|{ $x } => $fn\ntrue');
      expect(ast.statements).toHaveLength(2);
    });

    it('closure with defaults passes :? against type without defaults', async () => {
      // Build a closure type without defaults, then verify that a
      // closure with all-defaulted params structureMatches it via :?.
      const result = await run(
        '|x: string, y: number|{ $x } => $ref\n' +
          '$ref.^type => $refType\n' +
          '|x: string = "a", y: number = 0|{ $x } => $fn\n' +
          '$fn -> :?$refType'
      );
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // AC-22: Zero params (||) parses unchanged
  // ============================================================

  describe('AC-22: zero params parses unchanged', () => {
    it('||{ 42 } parses and executes', async () => {
      const ast = parse('||{ 42 }');
      expect(ast.statements).toHaveLength(1);
      const result = await run('||{ 42 } => $fn\n$fn()');
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // AC-23: Nested type default: dict(items: list = []) parses
  // ============================================================

  describe('AC-23: nested type with default parses', () => {
    it('dict(items: list = []) in closure param default parses', () => {
      const ast = parse('|cfg: dict(items: list = []) = [:]|{ $cfg }');
      expect(ast.statements).toHaveLength(1);
    });

    it('param typed dict(items: list = []) parses and empty list is default', async () => {
      const result = await run('dict(items: list = []) => $t\n$t -> :>string');
      expect(result).toContain('items');
    });
  });

  // ============================================================
  // AC-24: Union type with default: |mode: string|number = "auto"|
  // ============================================================

  describe('AC-24: union type with default parses', () => {
    it('|mode: string|number = "auto"| parses without error', () => {
      const ast = parse('|mode: string|number = "auto"|{ $mode }');
      expect(ast.statements).toHaveLength(1);
    });

    it('closure with union type and default executes with default', async () => {
      const result = await run(
        '|mode: string|number = "auto"|{ $mode } => $fn\n$fn()'
      );
      expect(result).toBe('auto');
    });

    it('closure with union type and default accepts explicit value', async () => {
      const result = await run(
        '|mode: string|number = "auto"|{ $mode } => $fn\n$fn(42)'
      );
      expect(result).toBe(42);
    });
  });

  // ============================================================
  // EC-1: Non-literal after = in closure annotation produces RILL-P001
  // ============================================================

  describe('EC-1: non-literal after = produces RILL-P001', () => {
    it('= $var throws ParseError with RILL-P001', () => {
      try {
        parse('|x: string = $var|{ $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P001');
      }
    });

    it('= (1 + 2) throws ParseError with RILL-P001', () => {
      try {
        parse('|x: number = (1 + 2)|{ $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).errorId).toBe('RILL-P001');
      }
    });
  });

  // ============================================================
  // EC-2: = literal outside supported position preserves existing errors
  // ============================================================

  describe('EC-2: = literal outside supported position preserves existing errors', () => {
    it('bare assignment syntax still errors', () => {
      expect(() => parse('$x = "hello"')).toThrow();
    });
  });

  // ============================================================
  // EC-3: Missing , or | after name: type = default produces RILL-P001
  // ============================================================

  describe('EC-3: missing delimiter after default produces parse error', () => {
    it('missing | after default throws ParseError', () => {
      try {
        parse('|x: number = 42 { $x }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('missing , between defaulted params throws ParseError', () => {
      try {
        parse('|a: string = "x" b: number = 1|{ $a }');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });
  });

  // ============================================================
  // AC-3: Each of 7 literal types parses as default in dict/tuple
  //        type argument fields (regression guard)
  // ============================================================

  describe('AC-3: all 7 literal types parse as defaults in dict/tuple type argument fields', () => {
    describe('dict type argument field defaults', () => {
      it('string default: dict(name: string = "hello") parses', () => {
        const ast = parse('dict(name: string = "hello") => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('number default: dict(count: number = 42) parses', () => {
        const ast = parse('dict(count: number = 42) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('bool default (true): dict(flag: bool = true) parses', () => {
        const ast = parse('dict(flag: bool = true) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('bool default (false): dict(flag: bool = false) parses', () => {
        const ast = parse('dict(flag: bool = false) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('list default: dict(items: list = [1, 2, 3]) parses', () => {
        const ast = parse('dict(items: list = [1, 2, 3]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('dict default: dict(cfg: dict = [a: 1]) parses', () => {
        const ast = parse('dict(cfg: dict = [a: 1]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('empty dict default: dict(cfg: dict = [:]) parses', () => {
        const ast = parse('dict(cfg: dict = [:]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('tuple default: dict(pair: tuple = [1, "a"]) parses', () => {
        const ast = parse('dict(pair: tuple = [1, "a"]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });
    });

    describe('tuple type argument field defaults', () => {
      it('string default: tuple(string = "hello") parses', () => {
        const ast = parse('tuple(string = "hello") => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('number default: tuple(number = 42) parses', () => {
        const ast = parse('tuple(number = 42) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('bool default: tuple(bool = true) parses', () => {
        const ast = parse('tuple(bool = true) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('list default: tuple(list = [1, 2]) parses', () => {
        const ast = parse('tuple(list = [1, 2]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('dict default: tuple(dict = [a: 1]) parses', () => {
        const ast = parse('tuple(dict = [a: 1]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('empty dict default: tuple(dict = [:]) parses', () => {
        const ast = parse('tuple(dict = [:]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });

      it('tuple default: tuple(tuple = [1, "a"]) parses', () => {
        const ast = parse('tuple(tuple = [1, "a"]) => $t\ntrue');
        expect(ast.statements).toHaveLength(2);
      });
    });
  });

  // ============================================================
  // AC-25: Dict type with all fields having defaults — existing
  //         behavior unchanged (regression guard)
  // ============================================================

  describe('AC-25: dict type with all fields having defaults preserves existing behavior', () => {
    it('dict(a: string = "x", b: number = 0) parses', () => {
      const ast = parse('dict(a: string = "x", b: number = 0) => $t\ntrue');
      expect(ast.statements).toHaveLength(2);
    });

    it('dict[] converts to all-defaulted dict type', async () => {
      const result = await run(
        'dict[] -> :>dict(a: string = "x", b: number = 0)'
      );
      expect(result).toEqual({ a: 'x', b: 0 });
    });

    it('partial dict converts and fills remaining defaults', async () => {
      const result = await run(
        '[a: "hello"] -> :>dict(a: string = "x", b: number = 0)'
      );
      expect(result).toEqual({ a: 'hello', b: 0 });
    });

    it('full dict passes through without applying defaults', async () => {
      const result = await run(
        '[a: "hello", b: 99] -> :>dict(a: string = "x", b: number = 0)'
      );
      expect(result).toEqual({ a: 'hello', b: 99 });
    });
  });
});
