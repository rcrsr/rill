/**
 * Rill Runtime Tests: string operations unified on Unicode code points (#296).
 *
 * Every string operation — .len, .head, .tail, .at, .index_of, .split(""),
 * the .first() iterator, and slice<> — indexes and counts by Unicode code
 * point, not UTF-16 code unit. Astral characters (e.g. "😀" = U+1F600, two
 * UTF-16 code units) occupy a single position and are never split into lone
 * surrogates. This matches how seq/fan/take/skip already traverse strings.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

const EMOJI = '😀'; // U+1F600, 2 UTF-16 code units, 1 code point

describe('#296: string ops count by code point', () => {
  it('.len counts an astral character once', async () => {
    expect(await run(`"${EMOJI}" -> .len`)).toBe(1);
    expect(await run(`"a${EMOJI}b" -> .len`)).toBe(3);
  });

  it('.head returns a whole astral character, not a lone surrogate', async () => {
    expect(await run(`"${EMOJI}b" -> .head`)).toBe(EMOJI);
  });

  it('.tail returns a whole astral character, not a lone surrogate', async () => {
    expect(await run(`"a${EMOJI}" -> .tail`)).toBe(EMOJI);
  });

  it('.at indexes by code point', async () => {
    expect(await run(`"a${EMOJI}b" -> .at(1)`)).toBe(EMOJI);
    expect(await run(`"a${EMOJI}b" -> .at(2)`)).toBe('b');
  });

  it('.index_of returns a code-point offset', async () => {
    // "b" sits after "a" and one astral char: UTF-16 offset 3, code-point 2.
    expect(await run(`"a${EMOJI}b" -> .index_of("b")`)).toBe(2);
    expect(await run(`"a${EMOJI}b" -> .index_of("z")`)).toBe(-1);
  });

  it('.split("") splits into code points, not surrogate halves', async () => {
    const result = await run(`"a${EMOJI}b" -> .split("")`);
    expect(result).toEqual(['a', EMOJI, 'b']);
  });

  it('slice<> indexes by code point', async () => {
    expect(await run(`"a${EMOJI}b" -> slice<0:2>`)).toBe(`a${EMOJI}`);
    expect(await run(`"a${EMOJI}b" -> slice<1:2>`)).toBe(EMOJI);
    expect(await run(`"a${EMOJI}b" -> slice<-1:>`)).toBe('b');
  });

  it('slice<> never emits a lone surrogate', async () => {
    // Slicing across the middle of the astral char must not split it.
    const result = await run(`"${EMOJI}${EMOJI}" -> slice<0:1>`);
    expect(result).toBe(EMOJI);
    expect([...(result as string)]).toHaveLength(1);
  });

  it('.first() string iterator yields whole code points', async () => {
    // seq over the .first() iterator collects each element.
    const result = await run(`"a${EMOJI}b" -> .first() -> seq({ $ })`);
    expect(result).toEqual(['a', EMOJI, 'b']);
  });

  it('slice<> still halts on a fractional bound (#268 preserved)', async () => {
    let caught: unknown;
    try {
      await run(`"a${EMOJI}b" -> slice<0:1.5>`);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
  });
});
