/**
 * Rill Language Tests: Datetime Type
 * Tests for datetime() constructor, now() function, datetime methods,
 * arithmetic, comparison, serialization, and error conditions.
 */

import { toNative, type RillFunction } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

// Fixed reference instant: 2026-03-13T08:00:00Z
const REF_ISO = '2026-03-13T08:00:00Z';
const REF_UNIX = 1773388800000; // Date.parse(REF_ISO)

describe('Rill Language: Datetime Type', () => {
  // ============================================================
  // 1. Construction
  // ============================================================

  describe('construction', () => {
    it('constructs from ISO 8601 string [AC-1]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .unix`);
      expect(result).toBe(REF_UNIX);
    });

    it('constructs from named components [AC-5]', async () => {
      const result = await run(
        'datetime(...dict[year: 2026, month: 3, day: 13]) -> .iso()'
      );
      expect(result).toBe('2026-03-13T00:00:00Z');
    });

    it('constructs from unix ms [AC-6]', async () => {
      const result = await run('datetime(...dict[unix: 0]) -> .iso()');
      expect(result).toBe('1970-01-01T00:00:00Z');
    });
  });

  // ============================================================
  // 2. Properties
  // ============================================================

  describe('properties', () => {
    it('returns .year', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .year`);
      expect(result).toBe(2026);
    });

    it('returns .month', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .month`);
      expect(result).toBe(3);
    });

    it('returns .day', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .day`);
      expect(result).toBe(13);
    });

    it('returns .hour', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .hour`);
      expect(result).toBe(8);
    });

    it('returns .minute', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .minute`);
      expect(result).toBe(0);
    });

    it('returns .second', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .second`);
      expect(result).toBe(0);
    });

    it('returns .ms', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .ms`);
      expect(result).toBe(0);
    });

    it('returns .unix as UTC ms since epoch [AC-1]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .unix`);
      expect(result).toBe(REF_UNIX);
    });

    it('returns .weekday as integer 1-7 [AC-B3]', async () => {
      // 2026-03-13 is Friday -> weekday 5 (1=Mon, 7=Sun)
      const result = await run(`datetime("${REF_ISO}") -> .weekday`);
      expect(result).toBe(5);
    });

    it('returns .weekday 1 for Monday', async () => {
      // 2026-03-09 is Monday
      const result = await run('datetime("2026-03-09T00:00:00Z") -> .weekday');
      expect(result).toBe(1);
    });

    it('returns .weekday 7 for Sunday', async () => {
      // 2026-03-15 is Sunday
      const result = await run('datetime("2026-03-15T00:00:00Z") -> .weekday');
      expect(result).toBe(7);
    });
  });

  // ============================================================
  // 3. now()
  // ============================================================

  describe('now()', () => {
    it('returns deterministic value via nowMs [AC-7]', async () => {
      const result = await run('now() -> .unix', {
        nowMs: 1710316800000,
      });
      expect(result).toBe(1710316800000);
    });

    it('second now() >= first now() (monotonic) [AC-B9]', async () => {
      const result = await run(
        'now() -> .unix => $first\nnow() -> .unix => $second\n$second >= $first',
        { nowMs: 1710316800000 }
      );
      expect(result).toBe(true);
    });

    it('halts when nowMs is NaN', async () => {
      await expectHaltMessage(
        () => run('now()', { nowMs: NaN }),
        'now() requires ctx.nowMs to be a finite integer'
      );
    });

    it('halts when nowMs is Infinity', async () => {
      await expectHaltMessage(
        () => run('now()', { nowMs: Infinity }),
        'now() requires ctx.nowMs to be a finite integer'
      );
    });

    it('halts when nowMs is a float', async () => {
      await expectHaltMessage(
        () => run('now()', { nowMs: 1710316800000.5 }),
        'now() requires ctx.nowMs to be a finite integer'
      );
    });
  });

  // ============================================================
  // 4. String methods: .iso(), .iso(offset)
  // ============================================================

  describe('string methods', () => {
    it('.iso() returns UTC ISO string [AC-2]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .iso()`);
      expect(result).toBe('2026-03-13T08:00:00Z');
    });

    it('.iso(2) returns +02:00 string [AC-3]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .iso(2)`);
      expect(result).toBe('2026-03-13T10:00:00+02:00');
    });

    it('.iso(5.5) returns +05:30 string [AC-4]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .iso(5.5)`);
      expect(result).toBe('2026-03-13T13:30:00+05:30');
    });

    it('.date() returns YYYY-MM-DD', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .date()`);
      expect(result).toBe('2026-03-13');
    });

    it('.time() returns HH:MM:SS', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .time()`);
      expect(result).toBe('08:00:00');
    });
  });

  // ============================================================
  // 5. Local properties
  // ============================================================

  describe('local properties', () => {
    it('.local_iso contains +01:00 when timezone is 1 [AC-21]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .local_iso`, {
        timezone: 1,
      });
      expect(result).toContain('+01:00');
    });

    it('.local_iso contains Z when no timezone set [AC-22]', async () => {
      const result = (await run(
        `datetime("${REF_ISO}") -> .local_iso`
      )) as string;
      // Default timezone is 0, which produces "Z" suffix
      expect(result).toContain('Z');
    });

    it('.local_date returns date at host timezone', async () => {
      // UTC 2026-03-13T23:00:00Z at timezone +2 is 2026-03-14
      const result = await run(
        'datetime("2026-03-13T23:00:00Z") -> .local_date',
        { timezone: 2 }
      );
      expect(result).toBe('2026-03-14');
    });

    it('.local_offset returns host timezone offset', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .local_offset`, {
        timezone: 5.5,
      });
      expect(result).toBe(5.5);
    });

    it('.local_iso halts when timezone is NaN', async () => {
      await expectHaltMessage(
        () => run(`datetime("${REF_ISO}") -> .local_iso`, { timezone: NaN }),
        'Invalid timezone offset'
      );
    });

    it('.local_date halts when timezone is Infinity', async () => {
      await expectHaltMessage(
        () =>
          run(`datetime("${REF_ISO}") -> .local_date`, {
            timezone: Infinity,
          }),
        'Invalid timezone offset'
      );
    });

    it('.local_time halts when timezone is -Infinity', async () => {
      await expectHaltMessage(
        () =>
          run(`datetime("${REF_ISO}") -> .local_time`, {
            timezone: -Infinity,
          }),
        'Invalid timezone offset'
      );
    });

    it('.local_offset halts when timezone is NaN', async () => {
      await expectHaltMessage(
        () => run(`datetime("${REF_ISO}") -> .local_offset`, { timezone: NaN }),
        'Invalid timezone offset'
      );
    });
  });

  // ============================================================
  // 6. Arithmetic
  // ============================================================

  describe('arithmetic', () => {
    it('.add(duration) clamps Jan 31 to Feb 28 [AC-15]', async () => {
      const result = await run(
        'datetime("2026-01-31T00:00:00Z") -> .add(duration(...dict[months: 1])) -> .iso()'
      );
      expect(result).toBe('2026-02-28T00:00:00Z');
    });

    it('pipe chain .add() -> .iso() works [AC-16]', async () => {
      const result = await run(
        `datetime("${REF_ISO}") -> .add(duration(...dict[hours: 2])) -> .iso()`
      );
      expect(result).toBe('2026-03-13T10:00:00Z');
    });

    it('.diff() returns absolute duration in ms', async () => {
      const result = await run(
        `datetime("${REF_ISO}") -> .diff(datetime(...dict[unix: 0])) => $dur\n$dur -> .total_ms`
      );
      expect(result).toBe(REF_UNIX);
    });

    it('.diff() is absolute regardless of order', async () => {
      const result = await run(
        `datetime(...dict[unix: 0]) -> .diff(datetime("${REF_ISO}")) => $dur\n$dur -> .total_ms`
      );
      expect(result).toBe(REF_UNIX);
    });
  });

  // ============================================================
  // 7. Comparison
  // ============================================================

  describe('comparison', () => {
    it('same instant from different forms -> == true [AC-17]', async () => {
      const result = await run(
        'datetime("2026-03-13T00:00:00Z") == datetime(...dict[year: 2026, month: 3, day: 13])'
      );
      expect(result).toBe(true);
    });

    it('different instants -> == false', async () => {
      const result = await run(
        `datetime("${REF_ISO}") == datetime(...dict[unix: 0])`
      );
      expect(result).toBe(false);
    });

    it('cross-type comparison returns false [EC-5]', async () => {
      const result = await run(`datetime("${REF_ISO}") == 42`);
      expect(result).toBe(false);
    });

    it('cross-type comparison with string returns false [EC-5]', async () => {
      const result = await run(`datetime("${REF_ISO}") == "${REF_ISO}"`);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // 8. JSON
  // ============================================================

  describe('json', () => {
    it('json() returns ISO string with milliseconds [AC-12]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> json()`);
      expect(result).toBe('"2026-03-13T08:00:00.000Z"');
    });

    it('json() round-trip reconstructs same datetime [AC-B4]', async () => {
      // json() produces '"2026-03-13T08:00:00.000Z"' (with JSON quotes).
      // .replace_all strips quotes to get the raw ISO string.
      // datetime() reconstructs from the ISO string, producing the same unix.
      const result = await run(
        `datetime("${REF_ISO}") -> json() -> .replace_all("\\"", "") => $iso\n` +
          'datetime($iso) -> .unix'
      );
      expect(result).toBe(REF_UNIX);
    });
  });

  // ============================================================
  // 9. String interpolation
  // ============================================================

  describe('string interpolation', () => {
    it('interpolated datetime contains ISO UTC string [AC-19]', async () => {
      const result = (await run(
        `datetime("${REF_ISO}") => $dt\n"Created at {$dt}"`
      )) as string;
      // formatValue for datetime uses toISOString()
      expect(result).toContain('2026-03-13T08:00:00.000Z');
      expect(result).toBe('Created at 2026-03-13T08:00:00.000Z');
    });
  });

  // ============================================================
  // 10. Empty
  // ============================================================

  describe('empty', () => {
    it('.empty returns datetime(unix: 0) [AC-B1]', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .empty -> .unix`);
      expect(result).toBe(0);
    });

    it('.empty -> .iso() returns epoch ISO', async () => {
      const result = await run(`datetime("${REF_ISO}") -> .empty -> .iso()`);
      expect(result).toBe('1970-01-01T00:00:00Z');
    });
  });

  // ============================================================
  // 11. Host interop
  // ============================================================

  describe('host interop', () => {
    it('toNativeValue() produces {unix, iso} shape [AC-B7]', async () => {
      const result = await run(`datetime("${REF_ISO}")`);
      const native = toNative(result);
      expect(native.rillTypeName).toBe('datetime');
      expect(native.value).toEqual({
        unix: REF_UNIX,
        iso: '2026-03-13T08:00:00.000Z',
      });
    });
  });

  // ============================================================
  // 12. Error cases
  // ============================================================

  describe('error cases', () => {
    it('datetime() with no args halts [AC-E1]', async () => {
      await expectHaltMessage(
        () => run('datetime()'),
        'datetime() requires arguments'
      );
    });

    it('datetime(month: 13) halts [AC-E2]', async () => {
      await expectHaltMessage(
        () => run('datetime(...dict[year: 2026, month: 13, day: 1])'),
        'Invalid datetime component month: 13'
      );
    });

    it('datetime("now") halts for non-ISO string [AC-E3]', async () => {
      await expectHaltMessage(
        () => run('datetime("now")'),
        'Invalid ISO 8601 string: now'
      );
    });

    it('.add(42) halts RILL-R003 for non-duration [AC-E5]', async () => {
      await expect(run(`datetime("${REF_ISO}") -> .add(42)`)).rejects.toThrow(
        'datetime.add() requires a duration argument'
      );
    });

    it('.diff("str") halts RILL-R003 for non-datetime [AC-E6]', async () => {
      await expect(
        run(`datetime("${REF_ISO}") -> .diff("str")`)
      ).rejects.toThrow('datetime.diff() requires a datetime argument');
    });

    it('datetime(unix: NaN) halts', async () => {
      const getNaN: RillFunction = {
        params: [],
        returnType: { kind: 'number' },
        fn: () => NaN,
      };
      await expectHaltMessage(
        () =>
          run('datetime(...dict[unix: getNaN()])', {
            functions: { getNaN },
          }),
        'Invalid datetime component unix'
      );
    });

    it('datetime(unix: Infinity) halts', async () => {
      const getInf: RillFunction = {
        params: [],
        returnType: { kind: 'number' },
        fn: () => Infinity,
      };
      await expectHaltMessage(
        () =>
          run('datetime(...dict[unix: getInf()])', {
            functions: { getInf },
          }),
        'Invalid datetime component unix'
      );
    });

    it('error messages match spec patterns [EC-1, EC-3]', async () => {
      // EC-1: no args error message
      await expectHaltMessage(() => run('datetime()'), /requires arguments/);

      // EC-3: non-ISO string error message
      await expectHaltMessage(
        () => run('datetime("hello")'),
        /Invalid ISO 8601 string/
      );
    });
  });

  // ============================================================
  // 13. Collection errors
  // ============================================================

  describe('collection errors', () => {
    it('each on datetime halts with collection error [AC-E11, EC-6]', async () => {
      await expect(run(`datetime("${REF_ISO}") -> seq({ $ })`)).rejects.toThrow(
        'Collection operators require list, string, dict, iterator, or stream, got datetime'
      );
    });

    it('map on datetime halts with collection error [EC-6]', async () => {
      await expect(run(`datetime("${REF_ISO}") -> fan({ $ })`)).rejects.toThrow(
        /Collection operators require/
      );
    });

    it('filter on datetime halts with collection error [EC-6]', async () => {
      await expect(
        run(`datetime("${REF_ISO}") -> filter({ true })`)
      ).rejects.toThrow(/Collection operators require/);
    });
  });
});
