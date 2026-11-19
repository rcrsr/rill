/**
 * Dict dispatch with multi-key entries.
 *
 * A dict held in a variable expands each multi-key entry into one string key
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

    it('dispatches the quoted spelling of each number key of a multi-key entry', async () => {
      const setup = '[["1", "2"]: "low", ["3"]: "mid"] => $d\n';
      expect(await run(`${setup}"1" -> $d`)).toBe('low');
      expect(await run(`${setup}"2" -> $d`)).toBe('low');
      expect(await run(`${setup}"3" -> $d`)).toBe('mid');
    });

    it('halts when a number element is not quoted', async () => {
      await expectHalt(() => run('[[1, 2]: "low"] => $d'), {
        code: 'RILL_R002',
        messagePattern: 'Multi-key dict entry keys must be string, got number',
      });
    });

    it('halts #TYPE_MISMATCH when a number input meets number-spelled keys', async () => {
      await expectHalt(() => run('[["1", "2"]: "low"] => $d\n2 -> $d'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('auto-invokes a fn value with the input as $', async () => {
      expect(
        await run('[["1", "2"]: fn(x) { "got {$x}" }] => $d\n"2" -> $d')
      ).toBe('got 2');
    });
  });

  describe('through a dict literal', () => {
    it('halts when a number input meets string-valued list keys', async () => {
      await expectHalt(() => run('1 -> dict[list["1", "2"]: "x"]'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('does not let the default mask a number input', async () => {
      await expectHalt(() => run('1 -> dict[list["1", "2"]: "x"] ?? "d"'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('returns the default when no list element matches', async () => {
      expect(await run('"3" -> dict[list["1", "2"]: "x"] ?? "d"')).toBe('d');
    });

    it('halts when a list key element is a bool', async () => {
      await expectHalt(() => run('"true" -> dict[list[true, false]: "x"]'), {
        code: 'RILL_R002',
        messagePattern: 'Multi-key dict entry keys must be string, got bool',
      });
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
