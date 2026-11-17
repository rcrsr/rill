import { describe, expect, it } from 'vitest';
import { deserializeValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt, expectHaltSync } from '../helpers/halt.js';
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

  it('rejects a total beyond the safe range', () => {
    const big = `${Number.MAX_SAFE_INTEGER}`;
    expect(parseDurationText(`${big}d${big}h`)).toBeUndefined();
    expect(parseDurationText('9'.repeat(400) + 'ms')).toBeUndefined();
  });
});

describe('parseDurationText decimal ms', () => {
  it('accepts a decimal ms count alone or after other units', () => {
    expect(parseDurationText('0.5ms')).toEqual({ months: 0, ms: 0.5 });
    expect(parseDurationText('1s500.5ms')).toEqual({ months: 0, ms: 1500.5 });
  });

  it('rejects a decimal on every other unit', () => {
    for (const text of ['1.5y', '1.5mo', '1.5d', '1.5h', '1.5m', '1.5s']) {
      expect(parseDurationText(text)).toBeUndefined();
    }
  });

  it('rejects malformed decimal ms text', () => {
    for (const text of [
      '1.ms',
      '.5ms',
      '1e3ms',
      '1.5e3ms',
      '+1.5ms',
      '1..5ms',
    ]) {
      expect(parseDurationText(text)).toBeUndefined();
    }
  });
});

describe('formatDurationText', () => {
  it('prints fractional ms and never emits exponent form', () => {
    expect(formatDurationText({ months: 0, ms: 0.5 })).toBe('0.5ms');
    expect(formatDurationText({ months: 0, ms: 1500.5 })).toBe('1s500.5ms');
    expect(formatDurationText({ months: 0, ms: 1e-7 })).toBe('0.0000001ms');
    expect(formatDurationText({ months: 0, ms: 1.5e-9 })).toBe(
      '0.0000000015ms'
    );
  });

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

describe('fractional ms', () => {
  it('prints the clean decimal, not float residue', () => {
    expect(formatDurationText({ months: 0, ms: 1000.3 })).toBe('1s0.3ms');
    expect(formatDurationText({ months: 0, ms: 90061001.7 })).toBe(
      '1d1h1m1s1.7ms'
    );
  });

  it('round-trips clean decimal text exactly', () => {
    for (const ms of [1000.3, 2500.7, 61000.1, 90061001.7, 86400000.25]) {
      expect(parseDurationText(formatDurationText({ months: 0, ms }))).toEqual({
        months: 0,
        ms,
      });
    }
  });

  it('decomposes to a clean remainder for the ms accessor', () => {
    const parts = decomposeDuration({ months: 0, ms: 1000.3 });
    expect(parts.seconds).toBe(1);
    expect(parts.ms).toBe(0.3);
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

  it('parses what it formats for fractional and noisy ms', () => {
    const values = [
      0.5,
      0.1 + 0.2,
      1e-7,
      1.5e-9,
      5e-324,
      1000.1,
      86400000.25,
      3 * 1.1,
      1 * 1.5,
    ];
    for (const ms of values) {
      const text = formatDurationText({ months: 0, ms });
      expect(text).not.toMatch(/e/);
      expect(parseDurationText(text)).toEqual({ months: 0, ms });
    }
  });
});

describe('duration range', () => {
  it('parseDurationText rejects out-of-range totals', () => {
    expect(parseDurationText('9007199254740991ms')).toEqual({
      months: 0,
      ms: 9007199254740991,
    });
    expect(parseDurationText('9007199254740992ms')).toBeUndefined();
    expect(parseDurationText('104249992d')).toBeUndefined();
    expect(parseDurationText('1d9007199254740991ms')).toBeUndefined();
    expect(parseDurationText('9007199254740992mo')).toBeUndefined();
  });

  it('datetime .diff halts INVALID_INPUT past the range', async () => {
    await expectHalt(
      () =>
        run(
          'datetime("-271821-04-20T00:00:00Z") -> .diff(datetime("+275760-09-13T00:00:00Z"))'
        ),
      { code: 'INVALID_INPUT' }
    );
  });

  it('deserialize halts INVALID_INPUT on out-of-range components', () => {
    expectHaltSync(() => deserializeValue(9007199254740992, 'duration'), {
      code: 'INVALID_INPUT',
    });
    expectHaltSync(() => deserializeValue({ months: 1, ms: -1 }, 'duration'), {
      code: 'INVALID_INPUT',
    });
  });
});
