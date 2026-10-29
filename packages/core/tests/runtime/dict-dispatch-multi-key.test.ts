/**
 * Dict dispatch with multi-key entries.
 *
 * A dict held in a variable expands each multi-key entry into one typed key
 * per element, so dispatch goes through the variable-dict path. A dict literal
 * keeps the list key and matches the input against each element in order.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('Dict dispatch with multi-key entries', () => {
  describe('through a dict held in a variable', () => {
    it('dispatches each string key of a multi-key entry', async () => {
      const setup = '[["a", "b"]: "ab", "c": "c"] => $d\n';
      expect(await run(`${setup}"a" -> $d`)).toBe('ab');
      expect(await run(`${setup}"b" -> $d`)).toBe('ab');
      expect(await run(`${setup}"c" -> $d`)).toBe('c');
    });

    it('dispatches each number key of a multi-key entry', async () => {
      const setup = '[[1, 2]: "low", [3]: "mid"] => $d\n';
      expect(await run(`${setup}1 -> $d`)).toBe('low');
      expect(await run(`${setup}2 -> $d`)).toBe('low');
      expect(await run(`${setup}3 -> $d`)).toBe('mid');
    });

    it('halts when a string input meets number keys', async () => {
      await expectHalt(() => run('[[1, 2]: "low"] => $d\n"2" -> $d'), {
        code: 'RILL_R009',
      });
    });

    it('auto-invokes a closure value with the input as $', async () => {
      expect(await run('[[1, 2]: |x| "got {$x}"] => $d\n2 -> $d')).toBe(
        'got 2'
      );
    });
  });

  describe('through a dict literal', () => {
    it('halts when a number input meets string-valued list keys', async () => {
      await expectHalt(() => run('1 -> dict[list["1", "2"]: "x"]'), {
        code: 'RILL_R009',
      });
    });

    it('returns the default when no list element matches', async () => {
      expect(await run('1 -> dict[list["1", "2"]: "x"] ?? "d"')).toBe('d');
    });

    it('matches a boolean list key', async () => {
      expect(await run('true -> dict[list[true, false]: "x"]')).toBe('x');
    });

    it('returns the first matching entry', async () => {
      expect(
        await run('"b" -> dict[list["a", "b"]: "first", list["b"]: "second"]')
      ).toBe('first');
    });

    it('falls through to a later entry when the first does not match', async () => {
      expect(
        await run('"c" -> dict[list["a", "b"]: "first", list["c"]: "second"]')
      ).toBe('second');
    });
  });
});
