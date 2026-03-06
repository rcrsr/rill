/**
 * Rill Runtime Tests: Built-in Methods (formerly functions)
 * Tests for identity, str, num, len, join, split, trim, first, last, at
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Built-in Functions', () => {
  describe('identity', () => {
    it('returns string unchanged', async () => {
      expect(await run('identity("x")')).toBe('x');
    });

    it('returns number unchanged', async () => {
      expect(await run('identity(42)')).toBe(42);
    });

    it('returns tuple unchanged', async () => {
      expect(await run('identity([1, 2, 3])')).toEqual([1, 2, 3]);
    });

    it('works with pipe', async () => {
      expect(await run('"test" -> identity')).toBe('test');
    });
  });
});

describe('Rill Runtime: Built-in Methods', () => {
  describe('.str', () => {
    it('converts number to string', async () => {
      expect(await run('42 -> .str')).toBe('42');
    });

    it('converts negative number to string', async () => {
      expect(await run('-5 -> .str')).toBe('-5');
    });

    it('converts decimal to string', async () => {
      expect(await run('3.14 -> .str')).toBe('3.14');
    });

    it('converts true to string', async () => {
      expect(await run('true -> .str')).toBe('true');
    });

    it('converts false to string', async () => {
      expect(await run('false -> .str')).toBe('false');
    });

    it('errors for undefined variable (no null in rill)', async () => {
      await expect(run('$undefined -> .str')).rejects.toThrow(
        'Undefined variable'
      );
    });

    it('returns string unchanged', async () => {
      expect(await run('"hello" -> .str')).toBe('hello');
    });
  });

  describe('.num', () => {
    it('converts string to number', async () => {
      expect(await run('"42" -> .num')).toBe(42);
    });

    it('converts negative string to number', async () => {
      expect(await run('"-5" -> .num')).toBe(-5);
    });

    it('converts decimal string to number', async () => {
      expect(await run('"3.14" -> .num')).toBe(3.14);
    });

    it('converts true to 1', async () => {
      expect(await run('true -> .num')).toBe(1);
    });

    it('converts false to 0', async () => {
      expect(await run('false -> .num')).toBe(0);
    });

    it('returns 0 for invalid string', async () => {
      expect(await run('"abc" -> .num')).toBe(0);
    });

    it('returns number unchanged', async () => {
      expect(await run('42 -> .num')).toBe(42);
    });
  });

  describe('.len', () => {
    it('returns string length', async () => {
      expect(await run('"hello" -> .len')).toBe(5);
    });

    it('returns empty string length as 0', async () => {
      expect(await run('"" -> .len')).toBe(0);
    });

    it('returns tuple length', async () => {
      expect(await run('[1, 2, 3] -> .len')).toBe(3);
    });

    it('returns empty tuple length as 0', async () => {
      expect(await run('[] -> .len')).toBe(0);
    });

    it('returns dict entry count', async () => {
      expect(await run('[a: 1, b: 2] -> .len')).toBe(2);
    });

    it('returns empty dict length as 0', async () => {
      expect(await run('[:] -> .len')).toBe(0);
    });

    it('works with method chain', async () => {
      expect(await run('"test" -> .len')).toBe(4);
    });
  });

  describe('.join', () => {
    it('joins with default separator (comma)', async () => {
      expect(await run('["a", "b", "c"] -> .join')).toBe('a,b,c');
    });

    it('joins with custom separator', async () => {
      expect(await run('["a", "b", "c"] -> .join("-")')).toBe('a-b-c');
    });

    it('joins with empty separator', async () => {
      expect(await run('["a", "b", "c"] -> .join("")')).toBe('abc');
    });

    it('joins single element', async () => {
      expect(await run('["only"] -> .join')).toBe('only');
    });

    it('returns empty string for empty tuple', async () => {
      expect(await run('[] -> .join')).toBe('');
    });

    it('converts non-string elements', async () => {
      expect(await run('[1, 2, 3] -> .join(":")')).toBe('1:2:3');
    });
  });

  describe('.split', () => {
    it('splits with default separator (newline)', async () => {
      expect(await run('"a\\nb\\nc" -> .split')).toEqual(['a', 'b', 'c']);
    });

    it('splits with custom separator', async () => {
      expect(await run('"a-b-c" -> .split("-")')).toEqual(['a', 'b', 'c']);
    });

    it('returns single element for no matches', async () => {
      expect(await run('"abc" -> .split("-")')).toEqual(['abc']);
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .split("-")')).toEqual(['']);
    });

    it('works with method chain', async () => {
      expect(await run('"a:b:c" -> .split(":")')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('.trim', () => {
    it('trims leading whitespace', async () => {
      expect(await run('"  hello" -> .trim')).toBe('hello');
    });

    it('trims trailing whitespace', async () => {
      expect(await run('"hello  " -> .trim')).toBe('hello');
    });

    it('trims both ends', async () => {
      expect(await run('"  hello  " -> .trim')).toBe('hello');
    });

    it('trims tabs and newlines', async () => {
      expect(await run('"\\t\\nhello\\n\\t" -> .trim')).toBe('hello');
    });

    it('returns empty for whitespace only', async () => {
      expect(await run('"   " -> .trim')).toBe('');
    });

    it('returns unchanged if no whitespace', async () => {
      expect(await run('"hello" -> .trim')).toBe('hello');
    });

    it('works with method chain', async () => {
      expect(await run('"  test  " -> .trim')).toBe('test');
    });
  });

  describe('.head', () => {
    it('returns first list element', async () => {
      expect(await run('["a", "b", "c"] -> .head')).toBe('a');
    });

    it('returns first string character', async () => {
      expect(await run('"abc" -> .head')).toBe('a');
    });

    it('errors on empty list', async () => {
      await expect(run('[] -> .head')).rejects.toThrow(
        'Cannot get head of empty list'
      );
    });

    it('errors on empty string', async () => {
      await expect(run('"" -> .head')).rejects.toThrow(
        'Cannot get head of empty string'
      );
    });

    it('works with method chain', async () => {
      expect(await run('[1, 2, 3] -> .head')).toBe(1);
    });
  });

  describe('.tail', () => {
    it('returns last list element', async () => {
      expect(await run('["a", "b", "c"] -> .tail')).toBe('c');
    });

    it('returns last string character', async () => {
      expect(await run('"abc" -> .tail')).toBe('c');
    });

    it('errors on empty list', async () => {
      await expect(run('[] -> .tail')).rejects.toThrow(
        'Cannot get tail of empty list'
      );
    });

    it('errors on empty string', async () => {
      await expect(run('"" -> .tail')).rejects.toThrow(
        'Cannot get tail of empty string'
      );
    });

    it('works with method chain', async () => {
      expect(await run('[1, 2, 3] -> .tail')).toBe(3);
    });
  });

  describe('.at', () => {
    it('returns tuple element at index', async () => {
      expect(await run('["a", "b", "c"] -> .at(1)')).toBe('b');
    });

    it('returns first element at index 0', async () => {
      expect(await run('["a", "b", "c"] -> .at(0)')).toBe('a');
    });

    it('returns string character at index', async () => {
      expect(await run('"abc" -> .at(2)')).toBe('c');
    });

    it('errors for out of bounds', async () => {
      await expect(run('["a"] -> .at(5)')).rejects.toThrow(
        'List index out of bounds'
      );
    });

    it('errors for negative index', async () => {
      await expect(run('["a", "b"] -> .at(-1)')).rejects.toThrow(
        'List index out of bounds'
      );
    });
  });
});

describe('Rill Runtime: Closures', () => {
  describe('Function Literals', () => {
    it('creates and invokes a closure', async () => {
      expect(await run('|x| { $x } => $fn\n$fn("hello")')).toBe('hello');
    });

    it('invokes closure with pipe-style', async () => {
      expect(await run('|x| { $x } => $fn\n"hello" -> $fn()')).toBe('hello');
    });

    it('uses default parameter value', async () => {
      expect(await run('|x: string = "default"| { $x } => $fn\n$fn()')).toBe(
        'default'
      );
    });

    it('overrides default parameter', async () => {
      expect(
        await run('|x: string = "default"| { $x } => $fn\n$fn("custom")')
      ).toBe('custom');
    });

    it('captures outer scope variables', async () => {
      expect(
        await run(
          '"outer" => $ctx\n|x| { "{$ctx}: {$x}" } => $fn\n$fn("inner")'
        )
      ).toBe('outer: inner');
    });
  });

  describe('Implied $ for Closures', () => {
    it('$fn() receives $ implicitly when closure has params', async () => {
      expect(await run('|x| { $x } => $fn\n"hello" -> $fn()')).toBe('hello');
    });

    it('$fn() in for loop receives loop value', async () => {
      expect(
        await run('|x| { $x } => $echo\n[1, 2, 3] -> each { $echo() }')
      ).toEqual([1, 2, 3]);
    });

    it('$fn() does not receive $ when args are explicit', async () => {
      expect(
        await run('|x| { $x } => $fn\n"ignored" -> { $fn("explicit") }')
      ).toBe('explicit');
    });
  });

  describe('Parameter Type Checking', () => {
    it('accepts correct type for string parameter', async () => {
      expect(await run('|x: string| { $x } => $fn\n$fn("hello")')).toBe(
        'hello'
      );
    });

    it('accepts correct type for number parameter', async () => {
      expect(await run('|x: number| { $x } => $fn\n$fn(42)')).toBe(42);
    });

    it('accepts correct type for bool parameter', async () => {
      expect(await run('|x: bool| { $x } => $fn\n$fn(true)')).toBe(true);
    });

    it('rejects number for string parameter', async () => {
      await expect(run('|x: string| { $x } => $fn\n$fn(42)')).rejects.toThrow(
        'Parameter type mismatch: x expects string, got number'
      );
    });

    it('rejects string for number parameter', async () => {
      await expect(
        run('|x: number| { $x } => $fn\n$fn("hello")')
      ).rejects.toThrow(
        'Parameter type mismatch: x expects number, got string'
      );
    });

    it('rejects string for bool parameter', async () => {
      await expect(run('|x: bool| { $x } => $fn\n$fn("true")')).rejects.toThrow(
        'Parameter type mismatch: x expects bool, got string'
      );
    });

    it('rejects number in for loop with string param', async () => {
      await expect(
        run('|r: string| { $r } => $fn\n[1, 2, 3] -> each { $fn() }')
      ).rejects.toThrow(
        'Parameter type mismatch: r expects string, got number'
      );
    });

    it('accepts string in for loop with string param', async () => {
      expect(
        await run('|r: string| { $r } => $fn\n["a", "b"] -> each { $fn() }')
      ).toEqual(['a', 'b']);
    });

    it('validates type with typed default', async () => {
      expect(await run('|x: string = "default"| { $x } => $fn\n$fn()')).toBe(
        'default'
      );
    });

    it('validates type when overriding default', async () => {
      await expect(
        run('|x: string = "default"| { $x } => $fn\n$fn(123)')
      ).rejects.toThrow(
        'Parameter type mismatch: x expects string, got number'
      );
    });
  });
});
