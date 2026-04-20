/**
 * Rill Language Tests: Duration Type
 * Tests for duration constructor, properties, methods, and error conditions.
 *
 * Positional param order: years, months, days, hours, minutes, seconds, ms
 * Named-arg syntax (duration(hours: 25)) is not yet supported by the parser.
 * Tests use positional args as a workaround until parser support lands.
 */

import { isDuration, toNative, type RillFunction } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

describe('Rill Language: Duration Type', () => {
  // ============================================================
  // 1. Construction
  // ============================================================

  describe('construction', () => {
    it('constructs from fixed units [AC-8]', async () => {
      // duration(hours: 25)
      const result = await run('duration(0, 0, 0, 25) -> .days');
      expect(result).toBe(1);
    });

    it('constructs from calendar units [AC-11]', async () => {
      // duration(months: 1, hours: 6)
      const result = await run('duration(0, 1, 0, 6) -> .display');
      expect(result).toBe('1mo6h');
    });

    it('converts years to months [AC-24]', async () => {
      // duration(years: 1)
      const result = await run('duration(1) -> .months');
      expect(result).toBe(12);
    });

    it('constructs zero duration [AC-B2]', async () => {
      // duration(hours: 0)
      const result = await run('duration(0, 0, 0, 0) -> .display');
      expect(result).toBe('0ms');
    });

    it('constructs from days and minutes [AC-9]', async () => {
      // duration(days: 1, minutes: 30)
      const result = await run('duration(0, 0, 1, 0, 30) -> .display');
      expect(result).toBe('1d30m');
    });

    it('constructs from ms directly', async () => {
      // duration(ms: 5000)
      const result = await run('duration(0, 0, 0, 0, 0, 0, 5000) -> .seconds');
      expect(result).toBe(5);
    });
  });

  // ============================================================
  // 2. Properties
  // ============================================================

  describe('properties', () => {
    it('decomposes 25h into 1d remainder 1h [AC-8]', async () => {
      // duration(hours: 25)
      const days = await run('duration(0, 0, 0, 25) -> .days');
      const hours = await run('duration(0, 0, 0, 25) -> .hours');
      expect(days).toBe(1);
      expect(hours).toBe(1);
    });

    it('returns calendar months count', async () => {
      // duration(months: 3)
      const result = await run('duration(0, 3) -> .months');
      expect(result).toBe(3);
    });

    it('returns total_ms for fixed duration', async () => {
      // duration(hours: 2) -> .total_ms = 7200000
      const result = await run('duration(0, 0, 0, 2) -> .total_ms');
      expect(result).toBe(7_200_000);
    });

    it('returns minutes remainder', async () => {
      // duration(hours: 1, minutes: 45) -> .minutes = 45
      const result = await run('duration(0, 0, 0, 1, 45) -> .minutes');
      expect(result).toBe(45);
    });

    it('returns seconds remainder', async () => {
      // duration(seconds: 90) -> .seconds = 30 (90s = 1m30s, remainder 30s)
      const result = await run('duration(0, 0, 0, 0, 0, 90) -> .seconds');
      expect(result).toBe(30);
    });

    it('returns ms remainder', async () => {
      // duration(ms: 1500) -> .ms = 500 (1500ms = 1s500ms, remainder 500ms)
      const result = await run('duration(0, 0, 0, 0, 0, 0, 1500) -> .ms');
      expect(result).toBe(500);
    });
  });

  // ============================================================
  // 3. Display
  // ============================================================

  describe('display', () => {
    it('omits zero components [AC-9]', async () => {
      // duration(days: 1, minutes: 30)
      const result = await run('duration(0, 0, 1, 0, 30) -> .display');
      expect(result).toBe('1d30m');
    });

    it('shows "0ms" for zero duration [AC-10]', async () => {
      // duration(hours: 0) is equivalent to duration()
      const result = await run('duration() -> .display');
      expect(result).toBe('0ms');
    });

    it('combines calendar and fixed components [AC-11]', async () => {
      // duration(months: 1, hours: 6)
      const result = await run('duration(0, 1, 0, 6) -> .display');
      expect(result).toBe('1mo6h');
    });

    it('shows years and months for large calendar durations', async () => {
      // duration(years: 2, months: 3)
      const result = await run('duration(2, 3) -> .display');
      expect(result).toBe('2y3mo');
    });

    it('shows hours and minutes', async () => {
      // duration(hours: 2, minutes: 30)
      const result = await run('duration(0, 0, 0, 2, 30) -> .display');
      expect(result).toBe('2h30m');
    });
  });

  // ============================================================
  // 4. Arithmetic
  // ============================================================

  describe('arithmetic', () => {
    it('subtracts durations [AC-23]', async () => {
      // duration(hours: 3) -> .subtract(duration(hours: 1))
      const result = await run(
        'duration(0, 0, 0, 3) -> .subtract(duration(0, 0, 0, 1)) -> .display'
      );
      expect(result).toBe('2h');
    });

    it('multiplies duration by a factor', async () => {
      // duration(hours: 2) -> .multiply(3)
      const result = await run(
        'duration(0, 0, 0, 2) -> .multiply(3) -> .display'
      );
      expect(result).toBe('6h');
    });

    it('adds durations', async () => {
      // duration(hours: 1) -> .add(duration(minutes: 30))
      const result = await run(
        'duration(0, 0, 0, 1) -> .add(duration(0, 0, 0, 0, 30)) -> .display'
      );
      expect(result).toBe('1h30m');
    });

    it('handles mixed duration add with month overflow [AC-B10]', async () => {
      // duration(months: 10) -> .add(duration(months: 5, hours: 2))
      const result = await run(
        'duration(0, 10) -> .add(duration(0, 5, 0, 2)) -> .display'
      );
      expect(result).toBe('1y3mo2h');
    });

    it('multiplies by zero', async () => {
      // duration(hours: 5) -> .multiply(0)
      const result = await run(
        'duration(0, 0, 0, 5) -> .multiply(0) -> .display'
      );
      expect(result).toBe('0ms');
    });
  });

  // ============================================================
  // 5. Comparison
  // ============================================================

  describe('comparison', () => {
    it('equates equivalent durations 48h == 2d [AC-18]', async () => {
      // duration(hours: 48) == duration(days: 2)
      const result = await run('duration(0, 0, 0, 48) == duration(0, 0, 2)');
      expect(result).toBe(true);
    });

    it('returns false for unequal durations', async () => {
      const result = await run('duration(0, 0, 0, 1) == duration(0, 0, 0, 2)');
      expect(result).toBe(false);
    });

    it('supports != operator', async () => {
      const result = await run('duration(0, 0, 0, 1) != duration(0, 0, 0, 2)');
      expect(result).toBe(true);
    });

    it('orders fixed durations with < operator', async () => {
      const result = await run('duration(0, 0, 0, 1) < duration(0, 0, 0, 2)');
      expect(result).toBe(true);
    });

    it('orders fixed durations with > operator', async () => {
      const result = await run('duration(0, 0, 0, 3) > duration(0, 0, 0, 1)');
      expect(result).toBe(true);
    });

    it('returns false for equal durations using >', async () => {
      const result = await run('duration(0, 0, 0, 2) > duration(0, 0, 0, 2)');
      expect(result).toBe(false);
    });

    it('returns false for duration == non-duration [EC-5]', async () => {
      const result = await run('duration(0, 0, 0, 1) == 3600000');
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // 6. JSON
  // ============================================================

  describe('json', () => {
    it('serializes fixed duration as ms number [AC-13]', async () => {
      // duration(hours: 2, minutes: 30) -> json() = "9000000"
      const result = await run('duration(0, 0, 0, 2, 30) -> json()');
      expect(result).toBe('9000000');
    });

    it('serializes calendar duration as object [AC-14]', async () => {
      // duration(months: 1, hours: 3) -> json()
      const result = await run('duration(0, 1, 0, 3) -> json()');
      expect(result).toBe('{"months":1,"ms":10800000}');
    });

    it('round-trips fixed duration via ms [AC-B5]', async () => {
      // Capture total_ms, reconstruct, verify equality
      const result = await run(
        'duration(0, 0, 0, 2, 30) -> .total_ms => $ms\n' +
          'duration(0, 0, 0, 0, 0, 0, $ms) -> .total_ms'
      );
      expect(result).toBe(9_000_000);
    });

    it('round-trips fixed duration via equality [AC-B5]', async () => {
      const result = await run(
        'duration(0, 0, 0, 2, 30) == duration(0, 0, 0, 0, 0, 0, 9000000)'
      );
      expect(result).toBe(true);
    });

    it('round-trips calendar duration via months + ms [AC-B6]', async () => {
      // duration(months: 2, hours: 5) has months=2, ms=18000000
      // Reconstruct: duration(0, 2, 0, 0, 0, 0, 18000000)
      const result = await run(
        'duration(0, 2, 0, 5) == duration(0, 2, 0, 0, 0, 0, 18000000)'
      );
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // 7. String Interpolation
  // ============================================================

  describe('string interpolation', () => {
    it('interpolates .display in template [AC-20]', async () => {
      // duration(hours: 2, minutes: 15) => $span; "Elapsed: {$span}"
      const result = await run(
        'duration(0, 0, 0, 2, 15) => $span\n"Elapsed: {$span}"'
      );
      expect(result).toBe('Elapsed: 2h15m');
    });

    it('interpolates zero duration', async () => {
      const result = await run('duration() => $span\n"Time: {$span}"');
      expect(result).toBe('Time: 0ms');
    });
  });

  // ============================================================
  // 8. Empty
  // ============================================================

  describe('empty', () => {
    it('returns duration(ms: 0) from .empty [AC-B2]', async () => {
      // duration(hours: 5) -> .empty -> .display
      const result = await run('duration(0, 0, 0, 5) -> .empty -> .display');
      expect(result).toBe('0ms');
    });

    it('empty duration has zero total_ms', async () => {
      const result = await run('duration(0, 0, 0, 1) -> .empty -> .total_ms');
      expect(result).toBe(0);
    });

    it('empty duration has zero months', async () => {
      const result = await run('duration(0, 3) -> .empty -> .months');
      expect(result).toBe(0);
    });
  });

  // ============================================================
  // 9. Host Interop
  // ============================================================

  describe('host interop', () => {
    it('toNativeValue() produces {months, ms} shape [AC-B8]', async () => {
      // duration(months: 2, hours: 3)
      const result = await run('duration(0, 2, 0, 3)');
      const native = toNative(result);
      expect(native.value).toEqual({ months: 2, ms: 10_800_000 });
    });

    it('toNativeValue() for fixed duration has months: 0', async () => {
      // duration(hours: 5)
      const result = await run('duration(0, 0, 0, 5)');
      const native = toNative(result);
      expect(native.value).toEqual({ months: 0, ms: 18_000_000 });
    });

    it('isDuration() returns true for duration values', async () => {
      const result = await run('duration(0, 0, 0, 1)');
      expect(isDuration(result)).toBe(true);
    });

    it('isDuration() returns false for non-duration values', () => {
      expect(isDuration(42)).toBe(false);
      expect(isDuration('2h')).toBe(false);
      expect(isDuration(null)).toBe(false);
    });
  });

  // ============================================================
  // 10. Error Cases
  // ============================================================

  describe('error cases', () => {
    it('halts on negative hours [AC-E4]', async () => {
      // duration(hours: -2)
      await expectHaltMessage(
        () => run('duration(0, 0, 0, -2)'),
        'duration hours must be non-negative'
      );
    });

    it('halts on negative days [EC-2]', async () => {
      // duration(days: -1)
      await expectHaltMessage(
        () => run('duration(0, 0, -1)'),
        'duration days must be non-negative'
      );
    });

    it('halts on negative months [EC-2]', async () => {
      // duration(months: -3)
      await expectHaltMessage(
        () => run('duration(0, -3)'),
        'duration months must be non-negative'
      );
    });

    it('halts on incomparable ordering with RILL-R002 [AC-E7]', async () => {
      // duration(months: 1) > duration(days: 30)
      await expect(run('duration(0, 1) > duration(0, 0, 30)')).rejects.toThrow(
        'Cannot order durations with different calendar components'
      );
    });

    it('halts on negative subtract result with RILL-R003 [AC-E8]', async () => {
      // duration(hours: 1) -> .subtract(duration(hours: 3))
      await expect(
        run('duration(0, 0, 0, 1) -> .subtract(duration(0, 0, 0, 3))')
      ).rejects.toThrow('duration.subtract() would produce negative result');
    });

    it('halts on negative multiply factor with RILL-R003 [AC-E9]', async () => {
      // $dur -> .multiply(-1)
      await expect(
        run('duration(0, 0, 0, 2) => $dur\n$dur -> .multiply(-1)')
      ).rejects.toThrow('duration.multiply() requires non-negative number');
    });

    it('halts on .total_ms for calendar duration with RILL-R003 [AC-E10]', async () => {
      // duration(months: 1) -> .total_ms
      await expect(run('duration(0, 1) -> .total_ms')).rejects.toThrow(
        'total_ms is not defined for calendar durations'
      );
    });

    it('halts on cross-type ordering duration vs number [EC-5]', async () => {
      // duration(hours: 1) > 100
      await expect(run('duration(0, 0, 0, 1) > 100')).rejects.toThrow(
        'Cannot compare duration with number using >'
      );
    });

    it('halts on non-number parameter [EC-4]', async () => {
      // duration(hours: "two") - positional equivalent
      await expectHaltMessage(
        () => run('duration(0, 0, 0, "two")'),
        'duration hours must be a finite number: two'
      );
    });

    it('halts on NaN duration parameter', async () => {
      const getNaN: RillFunction = {
        params: [],
        returnType: { kind: 'number' },
        fn: () => NaN,
      };
      await expectHaltMessage(
        () => run('duration(0, 0, getNaN())', { functions: { getNaN } }),
        'duration days must be a finite number'
      );
    });

    it('halts on Infinity duration parameter', async () => {
      const getInf: RillFunction = {
        params: [],
        returnType: { kind: 'number' },
        fn: () => Infinity,
      };
      await expectHaltMessage(
        () => run('duration(0, 0, 0, getInf())', { functions: { getInf } }),
        'duration hours must be a finite number'
      );
    });
  });

  // ============================================================
  // 11. Collection Errors
  // ============================================================

  describe('collection errors', () => {
    it('each on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(run('duration(0, 0, 0, 1) -> each { $ }')).rejects.toThrow(
        'Collection operators require list, string, dict, iterator, or stream, got duration'
      );
    });

    it('map on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(run('duration(0, 0, 0, 1) -> map { $ }')).rejects.toThrow(
        /Collection operators require/
      );
    });

    it('filter on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(
        run('duration(0, 0, 0, 1) -> filter { true }')
      ).rejects.toThrow(/Collection operators require/);
    });
  });
});
