/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: datetime methods
 * Covers component readers, formatters, local formatters, arithmetic, and
 * ordering methods on datetime edges not covered in datetime.test.ts.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

const DT = 'datetime("2026-03-13T08:09:10.123Z")';

describe('Rill Language: datetime calendar fields', () => {
  rule('datetime-calendar.gregorian').it(
    'reads fields on the proleptic Gregorian calendar with a year 0',
    async () => {
      expect(
        await run('datetime(...dict[year: 0, month: 1, day: 1]) -> .iso')
      ).toBe('0000-01-01T00:00:00Z');
      expect(
        await run(
          'datetime(...dict[year: 1, month: 1, day: 1]) -> .unix => $u\ndatetime(...dict[unix: $u - 1]) -> .year'
        )
      ).toBe(0);
      expect(
        await run(
          'datetime(...dict[year: 1900, month: 3, day: 1]) -> .diff(datetime(...dict[year: 1900, month: 2, day: 28])) -> "{$}"'
        )
      ).toBe('1d');
      expect(
        await run(
          'datetime(...dict[year: 2000, month: 3, day: 1]) -> .diff(datetime(...dict[year: 2000, month: 2, day: 28])) -> "{$}"'
        )
      ).toBe('2d');
    }
  );

  rule('datetime-calendar.offset').it(
    'reads the fields h hours ahead of UTC for a negative or fractional h',
    async () => {
      expect(await run(`${DT} -> .iso(-5)`)).toBe(
        '2026-03-13T03:09:10.123-05:00'
      );
      expect(await run(`${DT} -> .date(-9)`)).toBe('2026-03-12');
      expect(await run(`${DT} -> .time(0.5)`)).toBe('08:39:10');
    }
  );

  rule('datetime-calendar.offset-default').it(
    'formats at offset 0 when no offset is given',
    async () => {
      expect(await run(`${DT} -> .iso`)).toBe(await run(`${DT} -> .iso(0)`));
      expect(await run(`${DT} -> .date`)).toBe(await run(`${DT} -> .date(0)`));
      expect(await run(`${DT} -> .time`)).toBe(await run(`${DT} -> .time(0)`));
    }
  );

  rule('datetime-calendar.year-text').it(
    'prints a year in 0 to 9999 as four digits and any other as a signed six',
    async () => {
      expect(
        await run('datetime(...dict[year: 50, month: 1, day: 1]) -> .date')
      ).toBe('0050-01-01');
      expect(
        await run('datetime(...dict[year: -1, month: 1, day: 1]) -> .iso')
      ).toBe('-000001-01-01T00:00:00Z');
      expect(
        await run('datetime(...dict[year: 10000, month: 1, day: 1]) -> .date')
      ).toBe('+010000-01-01');
    }
  );
});

describe('Rill Language: datetime component readers', () => {
  rule(
    'datetime.year.utc',
    'datetime.month.utc',
    'datetime.day.utc',
    'datetime.hour.utc',
    'datetime.minute.utc',
    'datetime.second.utc',
    'datetime.ms.utc'
  ).it('reads each UTC field, before and after the epoch', async () => {
    expect(
      await run(
        `${DT} => $d\nlist[$d.year, $d.month, $d.day, $d.hour, $d.minute, $d.second, $d.ms]`
      )
    ).toEqual([2026, 3, 13, 8, 9, 10, 123]);
    expect(
      await run(
        'datetime(...dict[unix: -1]) => $d\nlist[$d.year, $d.month, $d.day, $d.hour, $d.minute, $d.second, $d.ms]'
      )
    ).toEqual([1969, 12, 31, 23, 59, 59, 999]);
  });

  rule('datetime.unix.count').it(
    'counts milliseconds from the epoch, negative before it',
    async () => {
      expect(await run(`${DT} -> .unix`)).toBe(1773389350123);
      expect(await run('datetime("1969-12-31T23:59:59.999Z") -> .unix')).toBe(
        -1
      );
    }
  );

  rule('datetime.weekday.iso').it(
    'reads the weekday of the UTC date before the epoch',
    async () => {
      expect(await run('datetime("1970-01-01") -> .weekday')).toBe(4);
      expect(await run('datetime(...dict[unix: -1]) -> .weekday')).toBe(3);
    }
  );
});

describe('Rill Language: datetime formatters', () => {
  rule('datetime.iso.format', 'datetime.iso.millis').it(
    'prints milliseconds as three digits only when not zero',
    async () => {
      expect(await run('datetime("2026-03-13T00:00:00.010Z") -> .iso')).toBe(
        '2026-03-13T00:00:00.010Z'
      );
      expect(await run('datetime("2026-03-13T00:00:00Z") -> .iso')).toBe(
        '2026-03-13T00:00:00Z'
      );
    }
  );

  rule('datetime.iso.suffix').it(
    'prints Z at offset 0 and a signed HH:MM otherwise',
    async () => {
      expect(await run(`${DT} -> .iso(0)`)).toBe('2026-03-13T08:09:10.123Z');
      expect(await run(`${DT} -> .iso(-5.5)`)).toBe(
        '2026-03-13T02:39:10.123-05:30'
      );
      expect(await run(`${DT} -> .iso(-0.5)`)).toBe(
        '2026-03-13T07:39:10.123-00:30'
      );
      expect(await run(`${DT} -> .iso(1.25)`)).toBe(
        '2026-03-13T09:24:10.123+01:15'
      );
    }
  );

  rule('datetime.iso.offset-range').it(
    'halts on an offset of 24 hours or more, and guard catches it',
    async () => {
      for (const src of [
        `${DT} -> .iso(24)`,
        `${DT} -> .iso(-24)`,
        `${DT} -> .iso(30)`,
      ]) {
        await expectHalt(() => run(src), { code: 'INVALID_INPUT' });
      }
      expect(await run(`guard { ${DT} -> .iso(24) } => $r\n$r.!code`)).toEqual(
        await run('#INVALID_INPUT')
      );
    }
  );

  rule('datetime.date.format').it(
    'prints the date at the offset as YYYY-MM-DD',
    async () => {
      expect(await run('datetime("2026-03-13T23:30:00Z") -> .date(1)')).toBe(
        '2026-03-14'
      );
      expect(await run('datetime("2026-01-05") -> .date')).toBe('2026-01-05');
    }
  );

  rule('datetime.time.format', 'datetime.time.no-millis').it(
    'prints HH:MM:SS and drops the milliseconds without rounding',
    async () => {
      expect(await run('datetime("2026-03-13T23:59:59.999Z") -> .time')).toBe(
        '23:59:59'
      );
      expect(await run('datetime("2026-03-13T23:30:00Z") -> .time(1)')).toBe(
        '00:30:00'
      );
    }
  );
});

describe('Rill Language: datetime local formatters', () => {
  rule('datetime.local_offset.host').it(
    'yields the host offset, and 0 whatever the process time zone',
    async () => {
      expect(await run(`${DT} -> .local_offset`, { timezone: -5.5 })).toBe(
        -5.5
      );
      const saved = process.env['TZ'];
      process.env['TZ'] = 'America/New_York';
      try {
        expect(await run(`${DT} -> .local_offset`)).toBe(0);
        expect(await run(`${DT} -> .local_iso`)).toBe(
          '2026-03-13T08:09:10.123Z'
        );
      } finally {
        if (saved === undefined) delete process.env['TZ'];
        else process.env['TZ'] = saved;
      }
    }
  );

  rule('datetime.local_offset.invalid').it(
    'halts #INVALID_INPUT on a host offset that is not finite',
    async () => {
      for (const timezone of [NaN, Infinity]) {
        await expectHalt(() => run(`${DT} -> .local_offset`, { timezone }), {
          code: 'INVALID_INPUT',
        });
      }
    }
  );

  rule(
    'datetime.local_iso.offset',
    'datetime.local_date.offset',
    'datetime.local_time.offset'
  ).it('formats as .iso, .date, and .time do at the host offset', async () => {
    for (const timezone of [2, -5.5]) {
      expect(
        await run(
          'datetime("2026-03-13T23:30:00.250Z") => $d\nlist[$d.local_iso == $d.iso($d.local_offset), $d.local_date == $d.date($d.local_offset), $d.local_time == $d.time($d.local_offset)]',
          { timezone }
        )
      ).toEqual([true, true, true]);
    }
    expect(
      await run('datetime("2026-03-13T23:30:00Z") -> .local_iso', {
        timezone: 2,
      })
    ).toBe('2026-03-14T01:30:00+02:00');
    for (const src of ['.local_iso', '.local_date', '.local_time']) {
      await expectHalt(() => run(`${DT} -> ${src}`, { timezone: NaN }), {
        code: 'INVALID_INPUT',
      });
    }
    await expectHalt(() => run(`${DT} -> .local_iso`, { timezone: 30 }), {
      code: 'INVALID_INPUT',
    });
  });
});

describe('Rill Language: datetime arithmetic', () => {
  rule('datetime.add.months').it(
    'moves by months keeping the time and clamping the day',
    async () => {
      expect(
        await run(
          'datetime("2024-01-31T10:00:00Z") -> .add(duration("1mo")) -> .iso'
        )
      ).toBe('2024-02-29T10:00:00Z');
      expect(
        await run(
          'datetime("2024-02-29T10:00:00Z") -> .add(duration("1y")) -> .iso'
        )
      ).toBe('2025-02-28T10:00:00Z');
      expect(
        await run(
          'datetime("2026-01-31T10:00:00Z") -> .add(duration("13mo")) -> .iso'
        )
      ).toBe('2027-02-28T10:00:00Z');
    }
  );

  rule('datetime.add.ms').it(
    'adds the millisecond count after the months',
    async () => {
      expect(
        await run(
          'datetime("2026-01-31T10:00:00Z") -> .add(duration("1mo1d")) -> .iso'
        )
      ).toBe('2026-03-01T10:00:00Z');
      expect(
        await run(
          'datetime("2026-03-13T10:00:00Z") -> .add(duration("1h30m1ms")) -> .iso'
        )
      ).toBe('2026-03-13T11:30:00.001Z');
    }
  );

  rule('datetime.add.type').it(
    'halts #TYPE_MISMATCH on an argument that is not a duration',
    async () => {
      for (const arg of ['42', '"1h"', 'datetime("2026-03-13")']) {
        await expectHalt(() => run(`${DT} -> .add(${arg})`), {
          code: 'TYPE_MISMATCH',
        });
      }
    }
  );

  rule('datetime.diff.absolute').it(
    'yields a zero-month duration of the absolute distance',
    async () => {
      expect(
        await run(
          'datetime("2026-03-12T09:00:00Z") -> .diff(datetime("2026-03-13T10:00:00Z")) -> "{$}"'
        )
      ).toBe('1d1h');
      expect(
        await run(
          'datetime("2026-03-13") -> .diff(datetime("2025-03-13")) -> .months'
        )
      ).toBe(0);
      expect(await run(`${DT} -> .diff(${DT}) -> "{$}"`)).toBe('0ms');
    }
  );

  rule('datetime.diff.type').it(
    'halts #TYPE_MISMATCH on an argument that is not a datetime',
    async () => {
      for (const arg of ['"x"', 'duration("1h")']) {
        await expectHalt(() => run(`${DT} -> .diff(${arg})`), {
          code: 'TYPE_MISMATCH',
        });
      }
    }
  );
});

describe('Rill Language: datetime ordering methods', () => {
  rule(
    'datetime.lt.operator',
    'datetime.gt.operator',
    'datetime.le.operator',
    'datetime.ge.operator'
  ).it('orders as the operators do, and halts where they halt', async () => {
    const a = 'datetime("2026-03-13")';
    const b = 'datetime("2026-03-14")';
    expect(
      await run(
        `list[${a}.lt(${b}), ${a}.gt(${b}), ${a}.le(${a}), ${a}.ge(${b}), ${a}.lt(${a}), ${a}.gt(${a})]`
      )
    ).toEqual([true, false, true, false, false, false]);
    for (const op of ['lt', 'gt', 'le', 'ge']) {
      await expect(run(`${a} -> .${op}(1)`)).rejects.toMatchObject({
        errorId: 'RILL-R002',
      });
    }
    expect(await run(`guard { ${a} -> .lt("x") } => $r\n$r.!code`)).toEqual(
      await run('#RILL_R002')
    );
  });
});
