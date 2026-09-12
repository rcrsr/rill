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
import { expectHalt } from '../helpers/halt.js';

const EMOJI = '😀'; // U+1F600, 2 UTF-16 code units, 1 code point

/** True if `s` contains an unpaired UTF-16 surrogate half. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (isLow) {
      return true;
    }
  }
  return false;
}

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

describe('#340: regex string methods run in Unicode (u) mode', () => {
  it('.match matches a whole astral character, not a lone surrogate', async () => {
    const result = await run(`"${EMOJI}" -> .match(".")`);
    expect(result).toEqual({ matched: EMOJI, index: 0, groups: [] });
    expect(hasLoneSurrogate((result as { matched: string }).matched)).toBe(
      false
    );
  });

  it('.match reports the index as a code-point offset', async () => {
    const result = await run(`"a${EMOJI}b" -> .match("b")`);
    expect(result).toEqual({ matched: 'b', index: 2, groups: [] });
  });

  it('.match reports a code-point index with a non-zero astral prefix', async () => {
    const result = await run(`"${EMOJI}a" -> .match("a") -> .index`);
    expect(result).toBe(1);
  });

  it('.match reports a code-point index and groups with a two-astral prefix', async () => {
    const result = await run(
      `"${EMOJI}${EMOJI}ab" -> .match("(a)(b)") -> .index`
    );
    expect(result).toBe(2);
    const withGroups = await run(`"${EMOJI}${EMOJI}ab" -> .match("(a)(b)")`);
    expect(withGroups).toEqual({
      matched: 'ab',
      index: 2,
      groups: ['a', 'b'],
    });
  });

  it('.is_match matches an astral character against a single-dot pattern', async () => {
    expect(await run(`"${EMOJI}" -> .is_match("^.$")`)).toBe(true);
  });

  it('.replace replaces a whole astral character with no lone surrogate left behind', async () => {
    expect(await run(`"${EMOJI}" -> .replace(".", "X")`)).toBe('X');
  });

  it('.replace_all replaces every astral character at code-point boundaries', async () => {
    const result = await run(`"a${EMOJI}b${EMOJI}c" -> .replace_all(".", "X")`);
    expect(result).toBe('XXXXX');
    expect(hasLoneSurrogate(result as string)).toBe(false);
  });

  it('.replace_all leaves astral characters intact when matched and reinserted', async () => {
    const result = await run(`"a${EMOJI}b" -> .replace_all("a", "")`);
    expect(result).toBe(`${EMOJI}b`);
    expect(hasLoneSurrogate(result as string)).toBe(false);
  });

  it('.replace halts INVALID_INPUT for a pattern invalid only under u mode', async () => {
    await expectHalt(() => run(`"a" -> .replace("\\\\-", "x")`), {
      code: 'INVALID_INPUT',
    });
  });

  it('.replace_all halts INVALID_INPUT for a pattern invalid only under u mode', async () => {
    await expectHalt(() => run(`"a" -> .replace_all("\\\\-", "x")`), {
      code: 'INVALID_INPUT',
    });
  });

  it('.match halts INVALID_INPUT for a pattern invalid only under u mode', async () => {
    await expectHalt(() => run(`"a" -> .match("\\\\-")`), {
      code: 'INVALID_INPUT',
    });
  });

  it('.is_match halts INVALID_INPUT for a pattern invalid only under u mode', async () => {
    await expectHalt(() => run(`"a" -> .is_match("\\\\-")`), {
      code: 'INVALID_INPUT',
    });
  });
});

describe('#356: pad_start/pad_end pad by code point, not code unit', () => {
  it('.pad_start reaches the target length in code points for an astral receiver', async () => {
    const result = await run(`"${EMOJI}" -> .pad_start(3, "x")`);
    expect(result).toBe(`xx${EMOJI}`);
    expect(Array.from(result as string)).toHaveLength(3);
  });

  it('.pad_end reaches the target length in code points for an astral receiver', async () => {
    const result = await run(`"${EMOJI}" -> .pad_end(3, "x")`);
    expect(result).toBe(`${EMOJI}xx`);
    expect(Array.from(result as string)).toHaveLength(3);
  });

  it('.pad_start never splits an astral fill character across a surrogate pair', async () => {
    const result = await run(`"a" -> .pad_start(3, "${EMOJI}")`);
    expect(result).toBe(`${EMOJI}${EMOJI}a`);
    expect(Array.from(result as string)).toHaveLength(3);
    expect(hasLoneSurrogate(result as string)).toBe(false);
  });

  it('.pad_end never splits an astral fill character across a surrogate pair', async () => {
    const result = await run(`"a" -> .pad_end(3, "${EMOJI}")`);
    expect(result).toBe(`a${EMOJI}${EMOJI}`);
    expect(Array.from(result as string)).toHaveLength(3);
    expect(hasLoneSurrogate(result as string)).toBe(false);
  });

  it('.pad_start behaves as before for BMP-only strings', async () => {
    expect(await run(`"7" -> .pad_start(3, "0")`)).toBe('007');
  });

  it('.pad_end behaves as before for BMP-only strings', async () => {
    expect(await run(`"7" -> .pad_end(3, "0")`)).toBe('700');
  });

  it('.pad_start returns the receiver unchanged when already at or above length', async () => {
    expect(await run(`"abc" -> .pad_start(2, "0")`)).toBe('abc');
  });

  it('.pad_start halts INVALID_INPUT for an over-large length', async () => {
    await expectHalt(() => run(`"a" -> .pad_start(999999999999, "0")`), {
      code: 'INVALID_INPUT',
    });
  });

  it('.pad_end halts INVALID_INPUT for an over-large length', async () => {
    await expectHalt(() => run(`"a" -> .pad_end(999999999999, "0")`), {
      code: 'INVALID_INPUT',
    });
  });
});

describe('#357: replacement metacharacters are inserted literally', () => {
  it('.replace inserts a literal "$&" instead of the matched substring', async () => {
    expect(await run(`"ab" -> .replace("a", "$&")`)).toBe('$&b');
  });

  it('.replace_all inserts a literal "$1" instead of a capture group', async () => {
    expect(await run(`"ab" -> .replace_all("a", "$1")`)).toBe('$1b');
  });

  it('.replace_all inserts a literal "$$" instead of a single "$"', async () => {
    expect(await run(`"ab" -> .replace_all("a", "$$")`)).toBe('$$b');
  });
});
