import { describe, expect, it } from 'vitest';
import {
  DURATION_UNITS,
  decomposeDuration,
  formatDurationText,
  parseDurationText,
} from '../../src/runtime/core/types/duration-units.js';

describe('parseDurationText', () => {
  it('accepts single and multi-component runs in table order', () => {
    expect(parseDurationText('5s')).toEqual({ months: 0, ms: 5000 });
    expect(parseDurationText('1y2mo3d4h5m6s7ms')).toEqual({
      months: 14,
      ms: 3 * 86400000 + 4 * 3600000 + 5 * 60000 + 6000 + 7,
    });
  });

  it('matches the longest suffix first', () => {
    expect(parseDurationText('2mo')).toEqual({ months: 2, ms: 0 });
    expect(parseDurationText('2ms')).toEqual({ months: 0, ms: 2 });
    expect(parseDurationText('2m')).toEqual({ months: 0, ms: 120000 });
    expect(parseDurationText('1m2ms')).toEqual({ months: 0, ms: 60002 });
  });

  it('rejects out-of-order suffixes', () => {
    expect(parseDurationText('5s1m')).toBeUndefined();
    expect(parseDurationText('1mo1y')).toBeUndefined();
  });

  it('rejects duplicate suffixes', () => {
    expect(parseDurationText('1s2s')).toBeUndefined();
  });

  it('rejects signs, whitespace, and the empty string', () => {
    expect(parseDurationText('-5s')).toBeUndefined();
    expect(parseDurationText('+5s')).toBeUndefined();
    expect(parseDurationText('5 s')).toBeUndefined();
    expect(parseDurationText(' 5s')).toBeUndefined();
    expect(parseDurationText('5s ')).toBeUndefined();
    expect(parseDurationText('')).toBeUndefined();
  });

  it('rejects missing digits, missing suffixes, and unknown suffixes', () => {
    expect(parseDurationText('s')).toBeUndefined();
    expect(parseDurationText('5')).toBeUndefined();
    expect(parseDurationText('5x')).toBeUndefined();
    expect(parseDurationText('1.5s')).toBeUndefined();
  });

  it('rejects components above the safe integer range', () => {
    expect(parseDurationText('9007199254740991ms')).toEqual({
      months: 0,
      ms: Number.MAX_SAFE_INTEGER,
    });
    expect(parseDurationText('9007199254740992ms')).toBeUndefined();
  });

  it('rejects a non-finite total', () => {
    const big = `${Number.MAX_SAFE_INTEGER}`;
    expect(parseDurationText(`${big}d${big}h`)).toBeDefined();
    expect(parseDurationText('9'.repeat(400) + 'ms')).toBeUndefined();
  });
});

describe('formatDurationText', () => {
  it('prints the zero duration as 0ms', () => {
    expect(formatDurationText({ months: 0, ms: 0 })).toBe('0ms');
  });

  it('normalizes parsed text', () => {
    const cases: Array<[string, string]> = [
      ['90s', '1m30s'],
      ['14mo', '1y2mo'],
      ['0y', '0ms'],
      ['25h', '1d1h'],
      ['1500ms', '1s500ms'],
      ['1y2mo3d4h5m6s7ms', '1y2mo3d4h5m6s7ms'],
    ];
    for (const [input, normalized] of cases) {
      const parsed = parseDurationText(input);
      expect(parsed).toBeDefined();
      if (parsed === undefined) continue;
      expect(formatDurationText(parsed)).toBe(normalized);
    }
  });
});

describe('decomposeDuration', () => {
  it('splits months and ms into per-unit components', () => {
    expect(decomposeDuration({ months: 14, ms: 90061001 })).toEqual({
      years: 1,
      months: 2,
      days: 1,
      hours: 1,
      minutes: 1,
      seconds: 1,
      ms: 1,
    });
  });
});

describe('duration text round trip', () => {
  it('parses what it formats for generated integer durations', () => {
    let state = 12345;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state;
    };
    const unitMs = DURATION_UNITS.filter((u) => u.field === 'ms').map(
      (u) => u.factor
    );
    for (let i = 0; i < 500; i++) {
      const months = next() % 5000;
      const scale = unitMs[next() % unitMs.length] ?? 1;
      const ms =
        (next() % 100000) * scale + (next() % 3 === 0 ? 0 : next() % 1000);
      const text = formatDurationText({ months, ms });
      expect(parseDurationText(text)).toEqual({ months, ms });
    }
    expect(parseDurationText(formatDurationText({ months: 0, ms: 0 }))).toEqual(
      {
        months: 0,
        ms: 0,
      }
    );
  });
});
