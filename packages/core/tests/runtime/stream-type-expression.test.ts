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

  describe('current behavior (known limits)', () => {
    it('halts RILL-P014 for a stream resolution type inside a type argument', async () => {
      await expect(run('list(stream(number):string)')).rejects.toMatchObject({
        errorId: 'RILL-P014',
      });
    });

    it('treats a newline after the colon as an assertion', async () => {
      await expectHalt(() => run('stream(number):\nstring'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });
});
