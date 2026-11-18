/**
 * Rill Language Tests: Type Field Keys
 * Dict and ordered type fields accept every static key spelling a dict
 * literal accepts, and a repeated key is a parse error.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Type Field Keys', () => {
  describe('key spellings', () => {
    it('matches a quoted dict type key against the literal type', async () => {
      expect(await run('dict("a b": number) == dict["a b": 1].^type')).toBe(
        true
      );
    });

    it('matches a quoted ordered type key against the literal type', async () => {
      expect(
        await run('ordered("a b": number) == ordered["a b": 1].^type')
      ).toBe(true);
    });

    it.each([
      ['dict(1: number)', 'dict("1": number)'],
      ['dict(-1: number)', 'dict("-1": number)'],
      ['dict(true: bool)', 'dict("true": bool)'],
      ['dict(while: number)', 'dict("while": number)'],
    ])('treats %s as its quoted form', async (bare, quoted) => {
      expect(await run(`${bare} == ${quoted}`)).toBe(true);
    });

    it('asserts a dict against a quoted-key type', async () => {
      expect(await run('dict["a b": 1] -> :?dict("a b": number)')).toBe(true);
    });

    it('fills a quoted-key default on conversion', async () => {
      expect(
        await run('dict[] -> dict("a b": number = 1) => $d\n$d["a b"]')
      ).toBe(1);
    });
  });

  describe('duplicate keys', () => {
    it.each([
      'dict(a: number, a: string)',
      'dict("a b": number, "a b": string)',
      'dict(1: number, "1": string)',
      'ordered(a: number, "a": string)',
    ])('rejects %s with RILL-P027', async (src) => {
      await expect(run(src)).rejects.toMatchObject({ errorId: 'RILL-P027' });
    });

    it('is not caught by guard', async () => {
      await expect(
        run('guard { dict(a: number, a: string) }')
      ).rejects.toMatchObject({ errorId: 'RILL-P027' });
    });
  });

  describe('printing', () => {
    it.each([
      ['dict("a b": number, c: string)', 'dict("a b": number, c: string)'],
      ['dict(1: number)', 'dict("1": number)'],
      ['dict(true: bool)', 'dict("true": bool)'],
      [
        'ordered(b: number, "a b": string)',
        'ordered(b: number, "a b": string)',
      ],
      ['dict("a{{b": number)', 'dict("a{{b": number)'],
    ])('prints %s as %s', async (src, printed) => {
      expect(await run(`${src}.signature`)).toBe(printed);
    });

    it('parses a printed brace key back to an equal type', async () => {
      const printed = await run('dict("a{{b": number).signature');
      expect(await run(`${printed} == dict["a{{b": 1].^type`)).toBe(true);
    });

    it('prints an ordered literal with a quoted key parseably', async () => {
      expect(await run('"{ordered["a b": 1]}"')).toBe('ordered["a b": 1]');
    });
  });

  describe('printing defaults', () => {
    it.each([
      [
        'dict(a: dict(x: number) = dict[x: 1])',
        'dict(a: dict(x: number) = dict[x: 1])',
      ],
      ['dict(a: dict() = dict[])', 'dict(a: dict = dict[])'],
      [
        'dict(a: list(number) = list[1, 2])',
        'dict(a: list(number) = list[1, 2])',
      ],
      ['dict(a: list = list[])', 'dict(a: list = list[])'],
      [
        'dict(a: dict("b c": number) = dict["b c": 1])',
        'dict(a: dict("b c": number) = dict["b c": 1])',
      ],
    ])('prints %s as %s', async (src, printed) => {
      expect(await run(`${src}.signature`)).toBe(printed);
    });

    it.each([
      'dict(a: dict(x: number) = dict[x: 1])',
      'dict(a: dict() = dict[])',
      'dict(a: list(number) = list[1, 2])',
      'dict(a: list = list[])',
    ])(
      'parses the printed signature of %s back to an equal type',
      async (src) => {
        const printed = await run(`${src}.signature`);
        expect(await run(`${printed} == ${src}`)).toBe(true);
      }
    );
  });

  describe('other constructors', () => {
    it.each(['tuple("a": number)', 'list("a": number)'])(
      'keeps %s a parse error other than RILL-P027',
      async (src) => {
        const err: unknown = await run(src).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as { errorId?: string }).errorId).not.toBe('RILL-P027');
      }
    );
  });
});
