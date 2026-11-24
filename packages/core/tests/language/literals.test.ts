/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Literals
 * Tests for strings, numbers, booleans, tuples, and dicts
 */

import { describe, expect, it } from 'vitest';
import type { RillValue } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';

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

    rule('string.escape').it('handles escape: newline', async () => {
      expect(await run('"a\\nb"')).toBe('a\nb');
    });

    rule('string.escape').it('handles escape: tab', async () => {
      expect(await run('"a\\tb"')).toBe('a\tb');
    });

    rule('string.escape').it('handles escape: backslash', async () => {
      expect(await run('"a\\\\b"')).toBe('a\\b');
    });

    rule('string.escape').it('handles escape: quote', async () => {
      expect(await run('"a\\"b"')).toBe('a"b');
    });

    rule('string.interpolation', 'string.print').it(
      'interpolates variable',
      async () => {
        expect(await run('"x" => $v\n"val:{$v}"')).toBe('val:x');
      }
    );

    it('interpolates pipe variable in block', async () => {
      // Direct $ interpolation in pipe target isn't supported; use block
      expect(await run('"x" -> { "{$}" }')).toBe('x');
    });

    it('interpolates field access', async () => {
      expect(await run('dict[a: "b"] => $d\n"{$d.a}"')).toBe('b');
    });
  });

  describe('Numbers', () => {
    rule('number.literal').it('evaluates integer', async () => {
      expect(await run('42')).toBe(42);
    });

    it('evaluates zero', async () => {
      expect(await run('0')).toBe(0);
    });

    rule('number.literal').it('evaluates negative integer', async () => {
      expect(await run('-5')).toBe(-5);
    });

    rule('number.literal').it('evaluates decimal', async () => {
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
      expect(await run('list[]')).toEqual([]);
    });

    it('evaluates single element tuple', async () => {
      expect(await run('list["a"]')).toEqual(['a']);
    });

    it('evaluates multiple elements', async () => {
      expect(await run('list[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('evaluates nested tuples', async () => {
      expect(await run('list[list[1, 2], list[3, 4]]')).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('accesses first element by index', async () => {
      expect(await run('list["a", "b"] => $t\n$t[0]')).toBe('a');
    });

    it('accesses second element by index', async () => {
      expect(await run('list["a", "b"] => $t\n$t[1]')).toBe('b');
    });

    it('errors for out of bounds index', async () => {
      await expect(run('list["a"] => $t\n$t[5]')).rejects.toThrow(
        'List index out of bounds'
      );
    });

    it('errors for index on empty list', async () => {
      await expect(run('list[] => $t\n$t[0]')).rejects.toThrow(
        'List index out of bounds'
      );
    });
  });

  describe('Dicts', () => {
    it('evaluates empty dict', async () => {
      expect(await run('dict[]')).toEqual({});
    });

    it('evaluates single entry', async () => {
      expect(await run('dict[a: 1]')).toEqual({ a: 1 });
    });

    it('evaluates multiple entries', async () => {
      expect(await run('dict[a: 1, b: 2]')).toEqual({ a: 1, b: 2 });
    });

    it('evaluates string values', async () => {
      expect(await run('dict[x: "hello"]')).toEqual({ x: 'hello' });
    });

    it('accesses field', async () => {
      expect(await run('dict[a: 1, b: 2] => $d\n$d.a')).toBe(1);
    });

    it('errors for missing field', async () => {
      await expect(run('dict[a: 1] => $d\n$d.missing')).rejects.toThrow(
        "Dict has no field 'missing'"
      );
    });

    it('accesses nested dict field', async () => {
      expect(await run('dict[x: dict[y: 1]] => $d\n$d.x.y')).toBe(1);
    });
  });

  // Note: Runtime evaluation tests for literal keys will be added in Phase 2
  // Parser verification is in tests/language/parser-syntax-errors.test.ts

  describe('List Spread', () => {
    it('spreads variable into list literal with additional element (AC-1)', async () => {
      const script = 'list[1, 2] => $a\nlist[...$a, 3]';
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('concatenates lists with multiple spreads (AC-2)', async () => {
      const script = 'list[1, 2] => $a\nlist[3, 4] => $b\nlist[...$a, ...$b]';
      expect(await run(script)).toEqual([1, 2, 3, 4]);
    });

    it('spreads empty list resulting in empty contribution (AC-3)', async () => {
      const script = 'list[...list[], 1]';
      expect(await run(script)).toEqual([1]);
    });

    it('spreads result of piped expression (AC-4)', async () => {
      const script = 'list[1, 2, 3] => $nums\nlist[...($nums -> fan({$ * 2}))]';
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('spreads list accessed via property/index (AC-5)', async () => {
      const script =
        'list[list[1, 2], list[3, 4]] => $nested\nlist[...$nested[0]]';
      expect(await run(script)).toEqual([1, 2]);
    });

    describe('Boundary Conditions', () => {
      it('spreads empty list yielding empty list (AC-15)', async () => {
        expect(await run('list[...list[]]')).toEqual([]);
      });

      it('spreads single element list (AC-16)', async () => {
        expect(await run('list[...list[5]]')).toEqual([5]);
      });

      it('spreads 10,000 elements (AC-18)', async () => {
        // Build list programmatically to avoid iteration limit
        const largeList = Array.from({ length: 10000 }, (_, i) => i);
        const script = 'list[...$large]';
        const result = await run(script, {
          variables: { large: largeList },
        });

        expect(result).toHaveLength(10000);
        expect((result as RillValue[])[0]).toBe(0);
        expect((result as RillValue[])[9999]).toBe(9999);
      });
    });

    describe('Error Cases', () => {
      it('throws runtime error when spreading string value (AC-11)', async () => {
        const script = '"hello" => $str\nlist[...$str]';
        await expect(run(script)).rejects.toThrow(
          'Spread in list literal requires list or tuple, got string'
        );
      });

      it('throws runtime error when spreading number value (AC-12)', async () => {
        const script = '42 => $num\nlist[...$num]';
        await expect(run(script)).rejects.toThrow(
          'Spread in list literal requires list or tuple, got number'
        );
      });

      it('throws parse error when ... not followed by expression (EC-1)', async () => {
        const script = 'list[...]';
        await expect(run(script)).rejects.toThrow(
          "Expected expression after '...'"
        );
      });

      it('spreads a tuple into a list', async () => {
        expect(await run('list[...tuple[1, 2]]')).toEqual([1, 2]);
      });

      it('spreads a tuple into a tuple', async () => {
        expect(await run('tuple[...tuple[1]]')).toMatchObject({
          __rill_tuple: true,
          entries: [1],
        });
      });

      it('rejects spreading an ordered, naming the kind', async () => {
        const error = await run('list[...ordered[a: 1]]').catch(
          (e: unknown) => e as Error
        );
        expect(error).toMatchObject({ errorId: 'RILL-R002' });
        expect((error as Error).message).toContain('got ordered');
        expect((error as Error).message).not.toContain('object');
      });

      it('rejects spreading an iterator, naming the kind', async () => {
        const error = await run('list[...range(0, 2)]').catch(
          (e: unknown) => e as Error
        );
        expect(error).toMatchObject({ errorId: 'RILL-R002' });
        expect((error as Error).message).toContain('got iterator');
        expect((error as Error).message).not.toContain('object');
      });

      it('throws runtime type error for non-list spread (EC-3)', async () => {
        const script = 'true => $bool\nlist[...$bool]';
        await expect(run(script)).rejects.toThrow(
          'Spread in list literal requires list or tuple, got bool'
        );
      });
    });
  });

  describe('Lexer Errors', () => {
    it('throws LexerError for unexpected character (EC-3)', async () => {
      await expect(run('`')).rejects.toThrow('Unexpected character: `');
    });

    it('throws error for heredoc syntax with helpful hint (removed feature)', async () => {
      // Heredoc syntax (<<EOF) was removed in favor of triple-quote strings
      // The lexer tokenizes < as LT, but parser detects << pattern and provides helpful hint
      await expect(run('<<EOF\ntest\nEOF')).rejects.toThrow(
        'Heredoc syntax (<<EOF) was removed, use triple-quote strings (""") instead'
      );
    });

    it('throws LexerError when $ is followed by a digit', async () => {
      await expect(run('$1')).rejects.toThrow(
        'Invalid variable name: $ must be followed by a letter or _'
      );
    });

    rule('number.malformed').it(
      'throws LexerError for digit separators in a number literal',
      async () => {
        await expect(run('1_000')).rejects.toThrow(
          'digit separators are not supported'
        );
      }
    );

    it('throws LexerError when a number is immediately followed by an identifier character', async () => {
      await expect(run('1abc')).rejects.toThrow(
        "malformed number literal: unexpected 'a' after number"
      );
    });
  });

  describe('number literal forms and printing', () => {
    rule('number.malformed').it(
      'rejects an exponent and a radix prefix with RILL-L003',
      async () => {
        await expect(run('1e3')).rejects.toMatchObject({
          errorId: 'RILL-L003',
        });
        await expect(run('0x10')).rejects.toMatchObject({
          errorId: 'RILL-L003',
        });
      }
    );

    rule('number.bare-point').it(
      'rejects a leading or trailing bare point with RILL-P001',
      async () => {
        await expect(run('.5')).rejects.toMatchObject({ errorId: 'RILL-P001' });
        await expect(run('5.')).rejects.toMatchObject({ errorId: 'RILL-P001' });
      }
    );

    rule('number.value').it('holds one binary64 value', async () => {
      expect(await run('0.1 + 0.2')).toBe(0.30000000000000004);
      expect(await run('0.1 + 0.2 == 0.3')).toBe(false);
    });

    rule('number.precision').it(
      'rounds an integer beyond 2^53 to the nearest binary64 value',
      async () => {
        expect(await run('9007199254740993 == 9007199254740992')).toBe(true);
      }
    );

    rule('number.print').it(
      'prints the shortest round-trip form, integral values without a point',
      async () => {
        expect(await run('"{1.0}"')).toBe('1');
        expect(await run('"{0 * -1}"')).toBe('0');
        expect(await run('"{3.14}"')).toBe('3.14');
      }
    );

    rule('number.print-exponent').it(
      'prints extreme magnitudes in exponent form',
      async () => {
        expect(await run('"{1000000000000000000000}"')).toBe('1e+21');
        expect(await run('"{100000000000000000000}"')).toBe(
          '100000000000000000000'
        );
        expect(await run('"{0.00000015}"')).toBe('1.5e-7');
        expect(await run('"{0.000001}"')).toBe('0.000001');
      }
    );
  });
});
