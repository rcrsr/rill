/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: built-in method calls and string methods
 * Covers method-call mechanics shared by every receiver kind, regex
 * patterns, and string method edges not covered in methods.test.ts.
 */

import { parse, ParseError } from '@rcrsr/rill';
import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: built-in method calls', () => {
  rule('method.no-spread').it(
    'rejects a spread in a method argument list with RILL-P006',
    () => {
      expect(() => parse('"a,b" -> .split(...list[","])')).toThrow(ParseError);
      try {
        parse('"a,b" -> .split(...list[","])');
      } catch (err) {
        expect((err as ParseError).errorId).toBe('RILL-P006');
      }
    }
  );

  rule('method.receiver').it(
    'calls a method on a literal, a group, and a call result',
    async () => {
      expect(await run('"abc".len')).toBe(3);
      expect(await run('("a" -> .upper).len')).toBe(1);
      expect(await run('"a,b".split(",").len')).toBe(2);
    }
  );

  rule('method.no-parens').it(
    'calls a method with no arguments with or without parentheses',
    async () => {
      expect(await run('"abc" -> .len')).toBe(3);
      expect(await run('"abc" -> .len()')).toBe(3);
      expect(await run('"abc".upper')).toBe('ABC');
      expect(await run('"abc".upper()')).toBe('ABC');
    }
  );

  rule('method.unknown').it(
    'an unknown method name halts RILL-R007, and guard catches it',
    async () => {
      await expect(run('"abc" -> .nope')).rejects.toMatchObject({
        errorId: 'RILL-R007',
      });
      expect(await run('guard { "abc" -> .nope } => $r\n$r.!code')).toEqual(
        await run('#RILL_R007')
      );
    }
  );

  rule('method.wrong-kind').it(
    'a method another kind defines halts RILL-R003, and guard catches it',
    async () => {
      await expect(run('5 -> .trim')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
      await expect(run('list[1] -> .upper()')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
      expect(await run('guard { 5 -> .trim } => $r\n$r.!code')).toEqual(
        await run('#RILL_R003')
      );
    }
  );

  rule('method.arguments').it(
    'binds method arguments as a call does',
    async () => {
      await expect(run('"abc" -> .starts_with()')).rejects.toMatchObject({
        errorId: 'RILL-R044',
      });
      await expect(run('"abc" -> .len(1)')).rejects.toMatchObject({
        errorId: 'RILL-R045',
      });
      await expect(run('"abc" -> .starts_with(1)')).rejects.toMatchObject({
        errorId: 'RILL-R001',
      });
      expect(await run('"5" -> .pad_start(3)')).toBe('  5');
    }
  );
});

describe('Rill Language: regex patterns', () => {
  rule('regex.syntax').it(
    'reads a pattern as a Unicode-mode ECMAScript expression',
    async () => {
      expect(await run('"😀" -> .is_match("^.$")')).toBe(true);
      expect(await run('"ab" -> .is_match("(?<=a)b")')).toBe(true);
      expect(await run('"😀😀" -> .replace_all(".", "x")')).toBe('xx');
    }
  );

  rule('regex.case', 'regex.invalid').it(
    'matches case-sensitively and rejects an inline flag group',
    async () => {
      expect(await run('"ABC" -> .is_match("b")')).toBe(false);
      await expectHalt(() => run('"aBc" -> .is_match("(?i)b")'), {
        code: 'INVALID_INPUT',
      });
    }
  );
});

describe('Rill Language: string methods', () => {
  rule('string.len.count').it('counts code points', async () => {
    expect(await run('"😀a" -> .len')).toBe(2);
    expect(await run('"" -> .len')).toBe(0);
  });

  rule('string.trim.ends').it(
    'removes tabs, carriage returns, and newlines at both ends only',
    async () => {
      expect(await run('"\\t a b \\r\\n" -> .trim')).toBe('a b');
    }
  );

  rule('string.head.first', 'string.tail.last').it(
    'reads whole code points at either end',
    async () => {
      expect(await run('"😀a" -> .head')).toBe('😀');
      expect(await run('"a😀" -> .tail')).toBe('😀');
    }
  );

  rule('string.split.separator').it(
    'cuts at separator text, keeping empty pieces',
    async () => {
      expect(await run('"a,b,,c" -> .split(",")')).toEqual(['a', 'b', '', 'c']);
      expect(await run('",a," -> .split(",")')).toEqual(['', 'a', '']);
      expect(await run('"a.b" -> .split(".")')).toEqual(['a', 'b']);
      expect(await run('"a--b" -> .split("--")')).toEqual(['a', 'b']);
    }
  );

  rule('string.split.no-match').it(
    'yields the receiver alone when the separator is absent',
    async () => {
      expect(await run('"ab" -> .split(",")')).toEqual(['ab']);
      expect(await run('"" -> .split(",")')).toEqual(['']);
    }
  );

  rule('string.split.empty').it(
    'splits into code points on an empty separator',
    async () => {
      expect(await run('"😀a" -> .split("")')).toEqual(['😀', 'a']);
    }
  );

  rule('string.split.default').it(
    'splits at a newline by default',
    async () => {
      expect(await run('"a\\nb" -> .split')).toEqual(['a', 'b']);
    }
  );

  rule('string.lines.newline').it(
    'keeps a carriage return in its line',
    async () => {
      expect(await run('"a\\r\\nb" -> .lines')).toEqual(['a\r', 'b']);
    }
  );

  rule('string.lower.case', 'string.upper.case').it(
    'maps case by the Unicode default mapping',
    async () => {
      expect(await run('"ÄÖx" -> .lower')).toBe('äöx');
      expect(await run('"straße" -> .upper')).toBe('STRASSE');
    }
  );

  rule('string.replace.literal', 'string.replace_all.literal').it(
    'inserts the replacement as written',
    async () => {
      expect(await run('"ab" -> .replace("(a)(b)", "$2$1")')).toBe('$2$1');
      expect(await run('"x" -> .replace_all("x", "$&$&")')).toBe('$&$&');
    }
  );

  rule('string.replace_all.every').it(
    'replaces an empty match at every position',
    async () => {
      expect(await run('"ab" -> .replace_all("x*", "-")')).toBe('-a-b-');
    }
  );

  rule('string.contains.text').it(
    'reads the search as text, not a pattern',
    async () => {
      expect(await run('"a.c" -> .contains(".")')).toBe(true);
      expect(await run('"abc" -> .contains(".")')).toBe(false);
    }
  );

  rule('string.match.first').it(
    'reports the match index in code points',
    async () => {
      expect(await run('"😀ab" -> .match("b").index')).toBe(2);
    }
  );

  rule('string.index_of.position').it(
    'counts the position in code points',
    async () => {
      expect(await run('"😀a" -> .index_of("a")')).toBe(1);
    }
  );

  rule('string.repeat.invalid').it('halts on a fractional count', async () => {
    await expectHalt(() => run('"ab" -> .repeat(1.5)'), {
      code: 'INVALID_INPUT',
    });
  });

  rule('string.pad_start.fill', 'string.pad_end.fill').it(
    'pads to a length in code points',
    async () => {
      expect(await run('"😀" -> .pad_start(3, "x")')).toBe('xx😀');
      expect(await run('"😀" -> .pad_end(3, "x")')).toBe('😀xx');
    }
  );

  rule('string.pad_start.unchanged', 'string.pad_end.unchanged').it(
    'leaves the receiver unchanged for an empty fill',
    async () => {
      expect(await run('"5" -> .pad_start(3, "")')).toBe('5');
      expect(await run('"5" -> .pad_end(3, "")')).toBe('5');
    }
  );

  rule('string.pad_start.invalid', 'string.pad_end.invalid').it(
    'halts on a negative or fractional length',
    async () => {
      for (const src of [
        '"5" -> .pad_start(-1)',
        '"5" -> .pad_start(2.5, "0")',
        '"5" -> .pad_end(-1)',
        '"5" -> .pad_end(2.5, "0")',
      ]) {
        await expectHalt(() => run(src), { code: 'INVALID_INPUT' });
      }
    }
  );

  rule(
    'string.lt.operator',
    'string.gt.operator',
    'string.le.operator',
    'string.ge.operator'
  ).it('orders as the operators do, and halts where they halt', async () => {
    expect(await run('"B" -> .lt("a")')).toBe(true);
    expect(await run('"a" -> .gt("b")')).toBe(false);
    expect(await run('"a" -> .le("a")')).toBe(true);
    expect(await run('"B" -> .ge("a")')).toBe(false);
    for (const op of ['lt', 'gt', 'le', 'ge']) {
      await expect(run(`"a" -> .${op}(1)`)).rejects.toMatchObject({
        errorId: 'RILL-R002',
      });
    }
  });
});
