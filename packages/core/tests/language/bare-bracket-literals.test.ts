/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Bare Bracket Literals
 * A bare bracket list or dict is shorthand for the keyword form, and values
 * print in the keyword spelling.
 */

import { describe, expect } from 'vitest';
import { parse, parseWithRecovery, ParseError } from '@rcrsr/rill';

import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Bare Bracket Literals', () => {
  rule('list.bare').it('equals the keyword list at every depth', async () => {
    expect(await run('[1, 2] == list[1, 2]')).toBe(true);
    expect(await run('[[1], [2]] == list[list[1], list[2]]')).toBe(true);
    expect(await run('[1, 2].^type == list[1, 2].^type')).toBe(true);
  });

  rule('dict.bare').it(
    'equals the keyword dict and the empty dict',
    async () => {
      expect(await run('[a: 1] == dict[a: 1]')).toBe(true);
      expect(await run('[a: 1, b: [1]] == dict[a: 1, b: list[1]]')).toBe(true);
      expect(await run('[:] == dict[]')).toBe(true);
      expect(await run('[a: 1].^type == dict[a: 1].^type')).toBe(true);
    }
  );

  rule('dict.bare', 'dict.key-string').it(
    'reads quoted, number, and bool keys as the keyword form does',
    async () => {
      expect(await run('["a b": 1] == dict["a b": 1]')).toBe(true);
      expect(await run('[1: "x"] == dict["1": "x"]')).toBe(true);
      expect(await run('[true: 1] == dict["true": 1]')).toBe(true);
    }
  );

  rule('dict.bare', 'dict.key-duplicate').it(
    'rejects a key spelled twice, as the keyword form does',
    () => {
      for (const src of ['[a: 1, a: 2]', '[1: "x", "1": "y"]']) {
        let err: unknown;
        try {
          parse(src);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ParseError);
        expect(err).toHaveProperty('errorId', 'RILL-P027');
      }
    }
  );

  rule('list.value-print').it(
    'prints a list in the keyword spelling',
    async () => {
      expect(await run('[1, 2] -> string')).toBe('list[1, 2]');
      expect(await run('[[1], [2]] -> string')).toBe('list[list[1], list[2]]');
      expect(await run('[] -> string')).toBe('list[]');
      expect(await run('"{[1, 2]}"')).toBe('list[1, 2]');
    }
  );

  rule('dict.value-print').it(
    'prints a dict in the keyword spelling',
    async () => {
      expect(await run('[a: 1] -> string')).toBe('dict[a: 1]');
      expect(await run('[a: 1, b: [1]] -> string')).toBe(
        'dict[a: 1, b: list[1]]'
      );
      expect(await run('[:] -> string')).toBe('dict[]');
    }
  );

  rule('dict.bare', 'list.bare').it(
    'builds the same value inside guard',
    async () => {
      expect(await run('guard { [1, 2] } => $r\n$r')).toEqual([1, 2]);
      expect(await run('guard { [a: 1] == dict[a: 1] } => $r\n$r')).toBe(true);
    }
  );

  rule('dict.bare').it(
    'accepts spread, variable, computed, keyword, and multi-key entries',
    async () => {
      const d = 'dict[a: 1] => $d\n"b" => $k\n';
      expect(await run(d + '[...$d, b: 2] == dict[...$d, b: 2]')).toBe(true);
      expect(
        await run(d + '[...$d, ...$d, b: 2] == dict[...$d, ...$d, b: 2]')
      ).toBe(true);
      expect(await run(d + '[b: 2, ...$d] == dict[b: 2, ...$d]')).toBe(true);
      expect(await run(d + '[$k: 1] == dict[$k: 1]')).toBe(true);
      // a number-valued computed key halts in both spellings
      await expect(run('[(1+1): 2]')).rejects.toThrow(/expected string/);
      await expect(run('dict[(1+1): 2]')).rejects.toThrow(/expected string/);
      expect(
        await run('[("a" -> .upper): 2] == dict[("a" -> .upper): 2]')
      ).toBe(true);
      expect(await run('[break: 1] == dict[break: 1]')).toBe(true);
      expect(await run('[list["a", "b"]: 1] == dict[list["a", "b"]: 1]')).toBe(
        true
      );
      expect(await run('[["a", "b"]: 1] == dict[["a", "b"]: 1]')).toBe(true);
      expect(await run('[-1: 1] == dict[-1: 1]')).toBe(true);
    }
  );

  rule('dict.bare').it('keeps a lone spread a list spread', async () => {
    expect(await run('list[1] => $l\n[...$l] == list[1]')).toBe(true);
  });

  rule('list.bare-empty').it('reads [] as the empty list', async () => {
    expect(await run('[] == list[]')).toBe(true);
    expect(await run('[].^type == list[].^type')).toBe(true);
    expect(await run('[].^type == list')).toBe(true);
  });

  rule('list.bare-mixed').it(
    'rejects positional and keyed entries together',
    () => {
      for (const src of ['[1, a: 2]', '[a: 1, 1]']) {
        let err: unknown;
        try {
          parse(src);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ParseError);
        expect(err).toHaveProperty('errorId', 'RILL-P001');
      }
    }
  );

  rule('dict.bare').it(
    'reads a bare `$x:` and `(expr):` entry as a dict key',
    async () => {
      expect(await run('"k" => $x\n[$x: number] -> string')).toBe(
        'dict[k: number]'
      );
      expect(await run('[("a" -> .upper): 5] -> string')).toBe('dict[A: 5]');
    }
  );

  rule('list.bare').it(
    'reads a parenthesized assertion as a list element',
    async () => {
      expect(await run('5 => $x\n[($x:number)] -> string')).toBe('list[5]');
      expect(await run('[((1 + 1):number), 2] -> string')).toBe('list[2, 2]');
      expect(await run('5 => $x\nlist[$x:number] -> string')).toBe('list[5]');
    }
  );

  rule('list.bare').it(
    'keeps ordinary positional brackets and spreads lists',
    async () => {
      const setup = 'list[1] => $a\nlist[2] => $b\n"a" => $s\n';
      expect(await run(`${setup}[$a, $b] -> string`)).toBe(
        'list[list[1], list[2]]'
      );
      expect(await run('[(1 + 1), 2] -> string')).toBe('list[2, 2]');
      expect(await run('[[1], 2] -> string')).toBe('list[list[1], 2]');
      expect(await run(`${setup}[$s -> .upper] -> string`)).toBe('list["A"]');
      expect(await run(`${setup}[...$a, ...$b] -> string`)).toBe('list[1, 2]');
      expect(await run(`${setup}[...$a, 1] -> string`)).toBe('list[1, 1]');
    }
  );

  rule('dict.bare').it(
    'reads spreads followed by a keyed entry as a dict',
    async () => {
      const setup = 'dict[a: 1] => $d\n';
      expect(await run(`${setup}[...$d,\n b: 2] -> string`)).toBe(
        'dict[a: 1, b: 2]'
      );
      expect(await run(`${setup}[b: 2, ...$d] -> string`)).toBe(
        'dict[a: 1, b: 2]'
      );
      expect(await run(`${setup}[...$d, ...$d, b: 2] -> string`)).toBe(
        'dict[a: 1, b: 2]'
      );
    }
  );

  rule('dict.bare').it(
    'parses deeply nested spread brackets without exponential cost',
    () => {
      const src = `${'[...'.repeat(40)}$x${']'.repeat(40)}`;
      const started = performance.now();
      let err: unknown;
      try {
        parse(src);
      } catch (e) {
        err = e;
      }
      expect(performance.now() - started).toBeLessThan(1000);
      if (err !== undefined) {
        expect(err).toBeInstanceOf(ParseError);
        expect(err).toHaveProperty('errorId', 'RILL-P015');
      }
    }
  );

  rule('dict.bare').it(
    'recovers from an unfinished spread-led bracket without crashing',
    () => {
      for (const src of ['[...$x, ]', '[...$x, a: 1']) {
        const result = parseWithRecovery(src);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    }
  );
});
