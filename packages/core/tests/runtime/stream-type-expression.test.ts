/**
 * Rill Runtime Tests: stream(T):R in expression position
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('stream type expression', () => {
  it('prints the resolution type in the signature', async () => {
    expect(await run('stream(number):string.signature')).toBe(
      'stream(number):string'
    );
  });

  it.each(['type', 'any'])(
    'builds a stream type whose outer is %s',
    async (name) => {
      expect(
        await run(`stream(number):${name} => $t\n$t.outer.signature`)
      ).toBe(name);
    }
  );

  it('prints a stream type without a resolution type as stream(number)', async () => {
    expect(await run('stream(number) => $t\n$t.signature')).toBe(
      'stream(number)'
    );
  });

  it('halts RILL-P003 for a non-type name after the colon', async () => {
    await expect(run('stream(number):foo')).rejects.toMatchObject({
      errorId: 'RILL-P003',
    });
  });

  it('keeps stream(number):$t an assertion', async () => {
    await expectHalt(() => run('string => $t\nstream(number):$t'), {
      code: 'TYPE_MISMATCH',
    });
  });

  describe('unspecified slots in a type check', () => {
    const make = `
      || {
        1 -> yield
        "done"
      } :stream(number):string => $gen
      $gen() => $s
    `;

    it.each([
      'stream:string',
      'stream(any):string',
      'stream(number):any',
      'stream(any):any',
      'stream(any)',
      'stream',
    ])('matches a stream(number):string value against :?%s', async (type) => {
      expect(await run(`${make}\n$s :?${type}`)).toBe(true);
    });

    it('rejects a stream(number):string value against :?stream(string)', async () => {
      expect(await run(`${make}\n$s :?stream(string)`)).toBe(false);
    });
  });

  describe('bare outer with field defaults and annotations', () => {
    it('parses stream:dict(a: number = 1)', async () => {
      expect(await run('stream:dict(a: number = 1) => $t\n$t.signature')).toBe(
        'stream(any):dict(a: number = 1)'
      );
    });

    it('parses stream(number):dict(a: number = 1)', async () => {
      expect(
        await run('stream(number):dict(a: number = 1) => $t\n$t.signature')
      ).toBe('stream(number):dict(a: number = 1)');
    });

    it('parses a bare stream outer in a closure return position', async () => {
      expect(
        await run(
          `|| { 1 -> yield
          dict[a: 1] } :stream:dict(a: number = 1) => $f
          $f.^type.signature`
        )
      ).toContain('stream');
    });

    it('parses stream:tuple with an annotated position', async () => {
      await expect(
        run('stream:tuple(^("d") number) => $t\n$t.signature')
      ).resolves.toContain('stream');
    });
  });

  describe('outer type diagnostics', () => {
    it.each(['stream(number):string|number', 'stream:string|number'])(
      'raises RILL-P011 naming the union outer for %s',
      async (src) => {
        await expect(run(src)).rejects.toMatchObject({
          errorId: 'RILL-P011',
          message: expect.stringContaining('union(string, number)') as string,
        });
      }
    );

    it('raises RILL-P006 for an outer after two chunk types', async () => {
      await expect(run('stream(number, string):bool')).rejects.toMatchObject({
        errorId: 'RILL-P006',
      });
    });
  });

  describe('current behavior (known limits)', () => {
    it('accepts a stream resolution type inside a type argument', async () => {
      expect(await run('list(stream(number):string) => $t\n$t.signature')).toBe(
        'list(stream(number):string)'
      );
    });

    it('treats a newline after the colon as an assertion', async () => {
      await expectHalt(() => run('stream(number):\nstring'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });
});
