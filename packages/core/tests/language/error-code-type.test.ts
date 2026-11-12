/**
 * Rill Language Tests: the built-in error_code type
 *
 * error_code is the closed set of error codes a halt or invalidate may
 * carry: every builtin atom except #ok and #IGNORE. every `.!code` value is a member
 * of union(#ok, error_code).
 */

import { describe, expect, it } from 'vitest';
import { ERROR_CODES, parse } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

function atom(name: string): { __rill_atom: true; atom: { name: string } } {
  return expect.objectContaining({
    __rill_atom: true,
    atom: expect.objectContaining({ name }),
  });
}

describe('Rill Language: error_code type', () => {
  describe('assertion', () => {
    it('returns an error-code atom unchanged', async () => {
      expect(await run('#TIMEOUT -> :error_code')).toEqual(atom('TIMEOUT'));
    });

    it('halts #TYPE_MISMATCH for #ok', async () => {
      await expectHalt(() => run('#ok -> :error_code'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'Type assertion failed: expected error_code, got #ok',
      });
    });

    it.each(['#IGNORE', '#FOO', '"TIMEOUT"'])(
      'reports %s as not an error_code',
      async (literal) => {
        expect(await run(`${literal} -> :?error_code`)).toBe(false);
      }
    );
  });

  describe('membership', () => {
    it.each(ERROR_CODES)('accepts #%s', async (code) => {
      expect(await run(`#${code} -> :?error_code`)).toBe(true);
    });

    it('equals the union of every error-code literal', async () => {
      const members = ERROR_CODES.map((c) => `#${c}`).join(', ');
      expect(await run(`error_code == union(${members})`)).toBe(true);
    });
  });

  describe('type value', () => {
    it('names itself error_code', async () => {
      expect(await run('error_code.name')).toBe('error_code');
    });

    it('collapses with its own members and with atom in a union', async () => {
      expect(await run('union(#TIMEOUT, error_code) == error_code')).toBe(true);
      expect(await run('union(atom, error_code) == atom')).toBe(true);
    });

    it('rejects type arguments', async () => {
      await expectHalt(() => run('#TIMEOUT -> :error_code(string)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('rejects error_code as a parameter name', () => {
      expect(() => parse('|error_code: string| {}')).toThrow(
        expect.objectContaining({ errorId: 'RILL-P003' })
      );
    });
  });

  describe('signature display', () => {
    it('prints error_code as a single word', async () => {
      expect(await run('error_code.signature')).toBe('error_code');
    });

    it('prints a union with #ok and error_code compactly', async () => {
      expect(await run('union(#ok, error_code).signature')).toBe(
        'union(#ok, error_code)'
      );
    });

    it('prints a union missing one error code in full', async () => {
      const members = ERROR_CODES.slice(1)
        .map((c) => `#${c}`)
        .join(', ');
      expect(await run(`union(${members}).signature`)).toBe(
        `union(${members})`
      );
    });
  });

  describe('.!code membership', () => {
    it('holds a member of union(#ok, error_code) for a valid value', async () => {
      expect(await run('"x".!code -> :?union(#ok, error_code)')).toBe(true);
    });

    it('holds a member of union(#ok, error_code) for a recovered invalid value', async () => {
      expect(
        await run(
          '(guard { "1x" -> atom } => $r).!code -> :?union(#ok, error_code)'
        )
      ).toBe(true);
    });

    it('leaves the type of an atom value as atom', async () => {
      expect(await run('#TIMEOUT.^type == atom')).toBe(true);
    });

    it('accepts an error code captured from an invalid value', async () => {
      expect(
        await run(`
          guard { "1x" -> atom } => $r
          $r.!code => $c:error_code
          $c -> :?error_code
        `)
      ).toBe(true);
    });

    it('halts when the code of a valid value is asserted', async () => {
      await expectHalt(() => run('"x".!code => $c:error_code'), {
        code: 'RILL_R001',
      });
    });
  });

  describe('closure parameter', () => {
    it('accepts an error code', async () => {
      expect(
        await run('|c: error_code| { $c -> string } => $f\n$f(#TIMEOUT)')
      ).toBe('TIMEOUT');
    });

    it('halts for #ok', async () => {
      await expect(
        run('|c: error_code| { $c -> string } => $f\n$f(#ok)')
      ).rejects.toHaveProperty('errorId', 'RILL-R001');
    });
  });
});
