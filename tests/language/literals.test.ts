/**
 * Rill Runtime Tests: Literals
 * Tests for strings, numbers, booleans, tuples, and dicts
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Literals', () => {
  describe('Strings', () => {
    it('evaluates simple string', async () => {
      expect(await run('"hello"')).toBe('hello');
    });

    it('evaluates empty string', async () => {
      expect(await run('""')).toBe('');
    });

    it('evaluates string with spaces', async () => {
      expect(await run('"hello world"')).toBe('hello world');
    });

    it('handles escape: newline', async () => {
      expect(await run('"a\\nb"')).toBe('a\nb');
    });

    it('handles escape: tab', async () => {
      expect(await run('"a\\tb"')).toBe('a\tb');
    });

    it('handles escape: backslash', async () => {
      expect(await run('"a\\\\b"')).toBe('a\\b');
    });

    it('handles escape: quote', async () => {
      expect(await run('"a\\"b"')).toBe('a"b');
    });

    it('interpolates variable', async () => {
      expect(await run('"x" :> $v\n"val:{$v}"')).toBe('val:x');
    });

    it('interpolates pipe variable in block', async () => {
      // Direct $ interpolation in pipe target isn't supported; use block
      expect(await run('"x" -> { "{$}" }')).toBe('x');
    });

    it('interpolates field access', async () => {
      expect(await run('[a: "b"] :> $d\n"{$d.a}"')).toBe('b');
    });
  });

  describe('Numbers', () => {
    it('evaluates integer', async () => {
      expect(await run('42')).toBe(42);
    });

    it('evaluates zero', async () => {
      expect(await run('0')).toBe(0);
    });

    it('evaluates negative integer', async () => {
      expect(await run('-5')).toBe(-5);
    });

    it('evaluates decimal', async () => {
      expect(await run('3.14')).toBe(3.14);
    });

    it('evaluates negative decimal', async () => {
      expect(await run('-0.5')).toBe(-0.5);
    });
  });

  describe('Booleans', () => {
    it('evaluates true', async () => {
      expect(await run('true')).toBe(true);
    });

    it('evaluates false', async () => {
      expect(await run('false')).toBe(false);
    });
  });

  describe('Tuples', () => {
    it('evaluates empty tuple', async () => {
      expect(await run('[]')).toEqual([]);
    });

    it('evaluates single element tuple', async () => {
      expect(await run('["a"]')).toEqual(['a']);
    });

    it('evaluates multiple elements', async () => {
      expect(await run('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('evaluates mixed types', async () => {
      expect(await run('["a", 1, true]')).toEqual(['a', 1, true]);
    });

    it('evaluates nested tuples', async () => {
      expect(await run('[[1, 2], [3, 4]]')).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('accesses first element by index', async () => {
      expect(await run('["a", "b"] :> $t\n$t[0]')).toBe('a');
    });

    it('accesses second element by index', async () => {
      expect(await run('["a", "b"] :> $t\n$t[1]')).toBe('b');
    });

    it('errors for out of bounds index', async () => {
      await expect(run('["a"] :> $t\n$t[5]')).rejects.toThrow(
        'List index out of bounds'
      );
    });

    it('errors for index on empty list', async () => {
      await expect(run('[] :> $t\n$t[0]')).rejects.toThrow(
        'List index out of bounds'
      );
    });
  });

  describe('Dicts', () => {
    it('evaluates empty dict', async () => {
      expect(await run('[:]')).toEqual({});
    });

    it('evaluates single entry', async () => {
      expect(await run('[a: 1]')).toEqual({ a: 1 });
    });

    it('evaluates multiple entries', async () => {
      expect(await run('[a: 1, b: 2]')).toEqual({ a: 1, b: 2 });
    });

    it('evaluates string values', async () => {
      expect(await run('[x: "hello"]')).toEqual({ x: 'hello' });
    });

    it('accesses field', async () => {
      expect(await run('[a: 1, b: 2] :> $d\n$d.a')).toBe(1);
    });

    it('errors for missing field', async () => {
      await expect(run('[a: 1] :> $d\n$d.missing')).rejects.toThrow(
        "Dict has no field 'missing'"
      );
    });

    it('accesses nested dict field', async () => {
      expect(await run('[x: [y: 1]] :> $d\n$d.x.y')).toBe(1);
    });
  });
});
