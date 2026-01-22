/**
 * Rill Runtime Tests: Built-in Methods
 * Tests for string methods, pattern methods, comparison methods
 */

import { describe, expect, it } from 'vitest';

import { createLogCollector, run } from '../helpers/runtime.js';

describe('Rill Runtime: Built-in Methods', () => {
  describe('.empty', () => {
    it('returns true for empty string', async () => {
      expect(await run('"" -> .empty')).toBe(true);
    });

    it('returns false for non-empty string', async () => {
      expect(await run('"x" -> .empty')).toBe(false);
    });

    it('returns true for null', async () => {
      expect(await run('$undefined -> .empty')).toBe(true);
    });

    it('returns true for empty tuple', async () => {
      expect(await run('[] -> .empty')).toBe(true);
    });

    it('returns false for non-empty tuple', async () => {
      expect(await run('[1] -> .empty')).toBe(false);
    });

    it('returns true for empty dict', async () => {
      expect(await run('[:] -> .empty')).toBe(true);
    });

    it('returns false for non-empty dict', async () => {
      expect(await run('[a: 1] -> .empty')).toBe(false);
    });
  });

  describe('.lines', () => {
    it('splits on newlines', async () => {
      expect(await run('"a\\nb\\nc" -> .lines')).toEqual(['a', 'b', 'c']);
    });

    it('returns single element for no newlines', async () => {
      expect(await run('"abc" -> .lines')).toEqual(['abc']);
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .lines')).toEqual(['']);
    });

    it('handles trailing newline', async () => {
      expect(await run('"a\\nb\\n" -> .lines')).toEqual(['a', 'b', '']);
    });
  });

  describe('log() global function', () => {
    it('passes through value unchanged', async () => {
      const { logs, callbacks } = createLogCollector();
      const result = await run('"hello" -> log', { callbacks });
      expect(result).toBe('hello');
      expect(logs).toEqual(['hello']);
    });

    it('logs and continues in chain', async () => {
      const { logs, callbacks } = createLogCollector();
      const result = await run('"test" -> log -> .contains("e")', {
        callbacks,
      });
      expect(result).toBe(true);
      expect(logs).toEqual(['test']);
    });

    it('logs numbers', async () => {
      const { logs, callbacks } = createLogCollector();
      await run('42 -> log', { callbacks });
      expect(logs).toEqual([42]);
    });

    it('logs tuples', async () => {
      const { logs, callbacks } = createLogCollector();
      await run('[1, 2, 3] -> log', { callbacks });
      expect(logs).toEqual([[1, 2, 3]]);
    });
  });

  describe('.contains', () => {
    it('returns true when substring found', async () => {
      expect(await run('"hello world" -> .contains("world")')).toBe(true);
    });

    it('returns false when substring not found', async () => {
      expect(await run('"hello world" -> .contains("xyz")')).toBe(false);
    });

    it('returns true for empty substring', async () => {
      expect(await run('"hello" -> .contains("")')).toBe(true);
    });

    it('returns false for empty string searching non-empty', async () => {
      expect(await run('"" -> .contains("x")')).toBe(false);
    });

    it('is case sensitive', async () => {
      expect(await run('"Hello" -> .contains("hello")')).toBe(false);
    });
  });

  describe('.match', () => {
    it('returns match info with matched text', async () => {
      const result = await run('"hello world" -> .match("world")');
      expect(result).toEqual({ matched: 'world', index: 6, groups: [] });
    });

    it('returns empty dict for no match', async () => {
      expect(await run('"hello" -> .match("world")')).toEqual({});
    });

    it('returns capture groups', async () => {
      const result = await run('"error: 42" -> .match("error: (\\\\d+)")');
      expect(result).toEqual({
        matched: 'error: 42',
        index: 0,
        groups: ['42'],
      });
    });

    it('returns multiple capture groups', async () => {
      const result = await run(
        '"v1.2.3" -> .match("v(\\\\d+)\\\\.(\\\\d+)\\\\.(\\\\d+)")'
      );
      expect(result).toEqual({
        matched: 'v1.2.3',
        index: 0,
        groups: ['1', '2', '3'],
      });
    });

    it('returns empty dict for invalid regex', async () => {
      expect(await run('"test" -> .match("[")')).toEqual({});
    });

    it('matches at any position and reports index', async () => {
      const result = await run('"abc123xyz" -> .match("[0-9]+")');
      expect(result).toEqual({ matched: '123', index: 3, groups: [] });
    });

    it('works in conditionals with .empty check', async () => {
      expect(
        await run(
          '"error: 42" -> .match("error: (\\\\d+)") -> !.empty ? $.groups[0] ! "none"'
        )
      ).toBe('42');
    });

    it('returns empty for no match in conditional', async () => {
      expect(
        await run(
          '"hello" -> .match("error: (\\\\d+)") -> !.empty ? $.groups[0] ! "none"'
        )
      ).toBe('none');
    });
  });

  describe('.is_match', () => {
    it('returns true when pattern matches', async () => {
      expect(await run('"hello123" -> .is_match("[0-9]+")')).toBe(true);
    });

    it('returns false when pattern does not match', async () => {
      expect(await run('"hello" -> .is_match("[0-9]+")')).toBe(false);
    });

    it('returns false for invalid regex', async () => {
      expect(await run('"test" -> .is_match("[")')).toBe(false);
    });

    it('matches partial patterns', async () => {
      expect(await run('"abc123xyz" -> .is_match("[0-9]")')).toBe(true);
    });
  });

  describe('.starts_with', () => {
    it('returns true when string starts with prefix', async () => {
      expect(await run('"hello world" -> .starts_with("hello")')).toBe(true);
    });

    it('returns false when string does not start with prefix', async () => {
      expect(await run('"hello world" -> .starts_with("world")')).toBe(false);
    });

    it('returns true for empty prefix', async () => {
      expect(await run('"hello" -> .starts_with("")')).toBe(true);
    });

    it('is case sensitive', async () => {
      expect(await run('"Hello" -> .starts_with("hello")')).toBe(false);
    });
  });

  describe('.ends_with', () => {
    it('returns true when string ends with suffix', async () => {
      expect(await run('"file.txt" -> .ends_with(".txt")')).toBe(true);
    });

    it('returns false when string does not end with suffix', async () => {
      expect(await run('"file.txt" -> .ends_with(".md")')).toBe(false);
    });

    it('returns true for empty suffix', async () => {
      expect(await run('"hello" -> .ends_with("")')).toBe(true);
    });

    it('is case sensitive', async () => {
      expect(await run('"File.TXT" -> .ends_with(".txt")')).toBe(false);
    });
  });

  describe('.lower', () => {
    it('converts to lowercase', async () => {
      expect(await run('"Hello World" -> .lower')).toBe('hello world');
    });

    it('handles already lowercase', async () => {
      expect(await run('"hello" -> .lower')).toBe('hello');
    });

    it('handles mixed case', async () => {
      expect(await run('"HeLLo WoRLD" -> .lower')).toBe('hello world');
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .lower')).toBe('');
    });
  });

  describe('.upper', () => {
    it('converts to uppercase', async () => {
      expect(await run('"Hello World" -> .upper')).toBe('HELLO WORLD');
    });

    it('handles already uppercase', async () => {
      expect(await run('"HELLO" -> .upper')).toBe('HELLO');
    });

    it('handles mixed case', async () => {
      expect(await run('"HeLLo WoRLD" -> .upper')).toBe('HELLO WORLD');
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .upper')).toBe('');
    });
  });

  describe('.replace', () => {
    it('replaces first match', async () => {
      expect(await run('"a-b-c" -> .replace("-", "_")')).toBe('a_b-c');
    });

    it('replaces regex pattern', async () => {
      expect(await run('"a1b2c3" -> .replace("[0-9]", "X")')).toBe('aXb2c3');
    });

    it('returns original for no match', async () => {
      expect(await run('"hello" -> .replace("x", "y")')).toBe('hello');
    });

    it('returns original for invalid regex', async () => {
      expect(await run('"test" -> .replace("[", "_")')).toBe('test');
    });

    it('handles empty replacement', async () => {
      expect(await run('"hello" -> .replace("l", "")')).toBe('helo');
    });
  });

  describe('.replace_all', () => {
    it('replaces all matches', async () => {
      expect(await run('"a-b-c" -> .replace_all("-", "_")')).toBe('a_b_c');
    });

    it('replaces all regex matches', async () => {
      expect(await run('"a1b2c3" -> .replace_all("[0-9]", "X")')).toBe(
        'aXbXcX'
      );
    });

    it('returns original for no match', async () => {
      expect(await run('"hello" -> .replace_all("x", "y")')).toBe('hello');
    });

    it('returns original for invalid regex', async () => {
      expect(await run('"test" -> .replace_all("[", "_")')).toBe('test');
    });

    it('handles empty replacement', async () => {
      expect(await run('"hello" -> .replace_all("l", "")')).toBe('heo');
    });
  });

  describe('.index_of', () => {
    it('returns position of first match', async () => {
      expect(await run('"hello world" -> .index_of("o")')).toBe(4);
    });

    it('returns -1 for no match', async () => {
      expect(await run('"hello" -> .index_of("x")')).toBe(-1);
    });

    it('returns 0 for match at start', async () => {
      expect(await run('"hello" -> .index_of("h")')).toBe(0);
    });

    it('finds substring position', async () => {
      expect(await run('"hello world" -> .index_of("world")')).toBe(6);
    });

    it('handles empty search string', async () => {
      expect(await run('"hello" -> .index_of("")')).toBe(0);
    });
  });

  describe('.repeat', () => {
    it('repeats string n times', async () => {
      expect(await run('"ab" -> .repeat(3)')).toBe('ababab');
    });

    it('returns empty for zero repeats', async () => {
      expect(await run('"ab" -> .repeat(0)')).toBe('');
    });

    it('returns original for one repeat', async () => {
      expect(await run('"ab" -> .repeat(1)')).toBe('ab');
    });

    it('handles negative number', async () => {
      expect(await run('"ab" -> .repeat(-1)')).toBe('');
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .repeat(5)')).toBe('');
    });
  });

  describe('.pad_start', () => {
    it('pads start with spaces by default', async () => {
      expect(await run('"42" -> .pad_start(5)')).toBe('   42');
    });

    it('pads start with custom fill', async () => {
      expect(await run('"42" -> .pad_start(5, "0")')).toBe('00042');
    });

    it('does not truncate if already long enough', async () => {
      expect(await run('"hello" -> .pad_start(3)')).toBe('hello');
    });

    it('handles multi-char fill', async () => {
      expect(await run('"1" -> .pad_start(5, "ab")')).toBe('abab1');
    });
  });

  describe('.pad_end', () => {
    it('pads end with spaces by default', async () => {
      expect(await run('"42" -> .pad_end(5)')).toBe('42   ');
    });

    it('pads end with custom fill', async () => {
      expect(await run('"42" -> .pad_end(5, "0")')).toBe('42000');
    });

    it('does not truncate if already long enough', async () => {
      expect(await run('"hello" -> .pad_end(3)')).toBe('hello');
    });

    it('handles multi-char fill', async () => {
      expect(await run('"1" -> .pad_end(5, "ab")')).toBe('1abab');
    });
  });

  describe('.eq', () => {
    it('returns true for equal strings', async () => {
      expect(await run('"a" -> .eq("a")')).toBe(true);
    });

    it('returns false for unequal strings', async () => {
      expect(await run('"a" -> .eq("b")')).toBe(false);
    });

    it('returns true for equal numbers', async () => {
      expect(await run('42 -> .eq(42)')).toBe(true);
    });

    it('returns false for unequal numbers', async () => {
      expect(await run('42 -> .eq(43)')).toBe(false);
    });

    it('returns true for equal booleans', async () => {
      expect(await run('true -> .eq(true)')).toBe(true);
    });
  });

  describe('.ne', () => {
    it('returns true for unequal strings', async () => {
      expect(await run('"a" -> .ne("b")')).toBe(true);
    });

    it('returns false for equal strings', async () => {
      expect(await run('"a" -> .ne("a")')).toBe(false);
    });

    it('returns true for unequal numbers', async () => {
      expect(await run('42 -> .ne(43)')).toBe(true);
    });

    it('returns false for equal numbers', async () => {
      expect(await run('42 -> .ne(42)')).toBe(false);
    });
  });

  describe('.lt', () => {
    it('returns true when less than', async () => {
      expect(await run('1 -> .lt(2)')).toBe(true);
    });

    it('returns false when equal', async () => {
      expect(await run('2 -> .lt(2)')).toBe(false);
    });

    it('returns false when greater than', async () => {
      expect(await run('3 -> .lt(2)')).toBe(false);
    });

    it('compares strings lexicographically', async () => {
      expect(await run('"a" -> .lt("b")')).toBe(true);
    });
  });

  describe('.gt', () => {
    it('returns true when greater than', async () => {
      expect(await run('2 -> .gt(1)')).toBe(true);
    });

    it('returns false when equal', async () => {
      expect(await run('2 -> .gt(2)')).toBe(false);
    });

    it('returns false when less than', async () => {
      expect(await run('1 -> .gt(2)')).toBe(false);
    });

    it('compares strings lexicographically', async () => {
      expect(await run('"b" -> .gt("a")')).toBe(true);
    });
  });

  describe('.le', () => {
    it('returns true when less than', async () => {
      expect(await run('1 -> .le(2)')).toBe(true);
    });

    it('returns true when equal', async () => {
      expect(await run('2 -> .le(2)')).toBe(true);
    });

    it('returns false when greater than', async () => {
      expect(await run('3 -> .le(2)')).toBe(false);
    });
  });

  describe('.ge', () => {
    it('returns true when greater than', async () => {
      expect(await run('3 -> .ge(2)')).toBe(true);
    });

    it('returns true when equal', async () => {
      expect(await run('2 -> .ge(2)')).toBe(true);
    });

    it('returns false when less than', async () => {
      expect(await run('1 -> .ge(2)')).toBe(false);
    });
  });
});
