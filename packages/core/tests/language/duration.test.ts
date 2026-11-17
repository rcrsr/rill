/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Duration Type
 * Tests for duration constructor, properties, methods, and error conditions.
 *
 * Printed form: duration("1h30m"), suffixes y mo d h m s ms in that order.
 * Named components are passed by spreading a dict: duration(...dict[hours: 25]).
 */

import {
  isDuration,
  structureToTypeValue,
  toNative,
  type RillFunction,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';
import {
  expectHalt,
  expectHaltMessage,
  expectRuntimeError,
} from '../helpers/halt.js';

describe('Rill Language: Duration Type', () => {
  // ============================================================
  // 1. Construction
  // ============================================================

  describe('construction', () => {
    it('constructs from fixed units [AC-8]', async () => {
      // duration(hours: 25)
      const result = await run('duration("25h") -> .days');
      expect(result).toBe(1);
    });

    it('converts years to months [AC-24]', async () => {
      // duration(years: 1)
      const result = await run('duration("1y") -> .months');
      expect(result).toBe(12);
    });

    it('constructs zero duration [AC-B2]', async () => {
      // duration(hours: 0)
      const result = await run('duration("0ms") -> .display');
      expect(result).toBe('0ms');
    });

    it('constructs from ms directly', async () => {
      // duration(ms: 5000)
      const result = await run('duration("5000ms") -> .seconds');
      expect(result).toBe(5);
    });
  });

  // ============================================================
  // 2. Properties
  // ============================================================

  describe('properties', () => {
    it('decomposes 25h into 1d remainder 1h [AC-8]', async () => {
      // duration(hours: 25)
      const days = await run('duration("25h") -> .days');
      const hours = await run('duration("25h") -> .hours');
      expect(days).toBe(1);
      expect(hours).toBe(1);
    });

    it('returns calendar months count', async () => {
      // duration(months: 3)
      const result = await run('duration("3mo") -> .months');
      expect(result).toBe(3);
    });

    it('returns total_ms for fixed duration', async () => {
      // duration(hours: 2) -> .total_ms = 7200000
      const result = await run('duration("2h") -> .total_ms');
      expect(result).toBe(7_200_000);
    });

    it('returns minutes remainder', async () => {
      // duration(hours: 1, minutes: 45) -> .minutes = 45
      const result = await run('duration("1h45m") -> .minutes');
      expect(result).toBe(45);
    });

    it('returns seconds remainder', async () => {
      // duration(seconds: 90) -> .seconds = 30 (90s = 1m30s, remainder 30s)
      const result = await run('duration("90s") -> .seconds');
      expect(result).toBe(30);
    });

    it('returns ms remainder', async () => {
      // duration(ms: 1500) -> .ms = 500 (1500ms = 1s500ms, remainder 500ms)
      const result = await run('duration("1500ms") -> .ms');
      expect(result).toBe(500);
    });
  });

  // ============================================================
  // 3. Display
  // ============================================================

  describe('display', () => {
    it('omits zero components [AC-9]', async () => {
      // duration(days: 1, minutes: 30)
      const result = await run('duration("1d30m") -> .display');
      expect(result).toBe('1d30m');
    });

    it('shows "0ms" for zero duration [AC-10]', async () => {
      // duration(hours: 0) is equivalent to duration()
      const result = await run('duration() -> .display');
      expect(result).toBe('0ms');
    });

    it('combines calendar and fixed components [AC-11]', async () => {
      // duration(months: 1, hours: 6)
      const result = await run('duration("1mo6h") -> .display');
      expect(result).toBe('1mo6h');
    });

    it('shows years and months for large calendar durations', async () => {
      // duration(years: 2, months: 3)
      const result = await run('duration("2y3mo") -> .display');
      expect(result).toBe('2y3mo');
    });

    it('shows hours and minutes', async () => {
      // duration(hours: 2, minutes: 30)
      const result = await run('duration("2h30m") -> .display');
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
        'duration("3h") -> .subtract(duration("1h")) -> .display'
      );
      expect(result).toBe('2h');
    });

    it('multiplies duration by a factor', async () => {
      // duration(hours: 2) -> .multiply(3)
      const result = await run('duration("2h") -> .multiply(3) -> .display');
      expect(result).toBe('6h');
    });

    it('adds durations', async () => {
      // duration(hours: 1) -> .add(duration(minutes: 30))
      const result = await run(
        'duration("1h") -> .add(duration("30m")) -> .display'
      );
      expect(result).toBe('1h30m');
    });

    it('handles mixed duration add with month overflow [AC-B10]', async () => {
      // duration(months: 10) -> .add(duration(months: 5, hours: 2))
      const result = await run(
        'duration("10mo") -> .add(duration("5mo2h")) -> .display'
      );
      expect(result).toBe('1y3mo2h');
    });

    it('multiplies by zero', async () => {
      // duration(hours: 5) -> .multiply(0)
      const result = await run('duration("5h") -> .multiply(0) -> .display');
      expect(result).toBe('0ms');
    });
  });

  // ============================================================
  // 5. Comparison
  // ============================================================

  describe('comparison', () => {
    it('equates equivalent durations 48h == 2d [AC-18]', async () => {
      // duration(hours: 48) == duration(days: 2)
      const result = await run('duration("48h") == duration("2d")');
      expect(result).toBe(true);
    });

    it('returns false for unequal durations', async () => {
      const result = await run('duration("1h") == duration("2h")');
      expect(result).toBe(false);
    });

    it('supports != operator', async () => {
      const result = await run('duration("1h") != duration("2h")');
      expect(result).toBe(true);
    });

    it('orders fixed durations with < operator', async () => {
      const result = await run('duration("1h") < duration("2h")');
      expect(result).toBe(true);
    });

    it('orders fixed durations with > operator', async () => {
      const result = await run('duration("3h") > duration("1h")');
      expect(result).toBe(true);
    });

    it('returns false for equal durations using >', async () => {
      const result = await run('duration("2h") > duration("2h")');
      expect(result).toBe(false);
    });

    it('halts with TYPE_MISMATCH for duration == non-duration', async () => {
      await expectHalt(() => run('duration("1h") == 3600000'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  // ============================================================
  // 6. JSON
  // ============================================================

  describe('json', () => {
    it('serializes fixed duration as ms number [AC-13]', async () => {
      // duration(hours: 2, minutes: 30) -> json() = "9000000"
      const result = await run('duration("2h30m") -> json()');
      expect(result).toBe('9000000');
    });

    it('serializes calendar duration as object [AC-14]', async () => {
      // duration(months: 1, hours: 3) -> json()
      const result = await run('duration("1mo3h") -> json()');
      expect(result).toBe('{"months":1,"ms":10800000}');
    });

    it('round-trips fixed duration via ms [AC-B5]', async () => {
      // Capture total_ms, reconstruct, verify equality
      const result = await run(
        'duration("2h30m") -> .total_ms => $ms\n' +
          'duration("{$ms}ms") -> .total_ms'
      );
      expect(result).toBe(9_000_000);
    });

    it('round-trips fixed duration via equality [AC-B5]', async () => {
      const result = await run('duration("2h30m") == duration("9000000ms")');
      expect(result).toBe(true);
    });

    it('round-trips calendar duration via months + ms [AC-B6]', async () => {
      // duration(months: 2, hours: 5) has months=2, ms=18000000
      // Reconstruct: duration("2mo18000000ms")
      const result = await run(
        'duration("2mo5h") == duration("2mo18000000ms")'
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
        'duration("2h15m") => $span\n"Elapsed: {$span}"'
      );
      expect(result).toBe('Elapsed: 2h15m');
    });

    it('interpolates zero duration', async () => {
      const result = await run('duration() => $span\n"Time: {$span}"');
      expect(result).toBe('Time: 0ms');
    });
  });

  // ============================================================
  // 8. Zero
  // ============================================================

  describe('zero', () => {
    it('returns duration(ms: 0) from .zero', async () => {
      // duration(hours: 5) -> .zero -> .display
      const result = await run('duration("5h") -> .zero -> .display');
      expect(result).toBe('0ms');
    });

    it('zero duration has zero total_ms', async () => {
      const result = await run('duration("1h") -> .zero -> .total_ms');
      expect(result).toBe(0);
    });

    it('zero duration has zero months', async () => {
      const result = await run('duration("3mo") -> .zero -> .months');
      expect(result).toBe(0);
    });

    it('halts on .empty: duration has no .empty method', async () => {
      await expect(run('duration("5h") -> .empty')).rejects.toThrow(
        "Method 'empty' not supported on duration"
      );
    });
  });

  // ============================================================
  // 9. Host Interop
  // ============================================================

  describe('host interop', () => {
    it('toNativeValue() produces {months, ms} shape [AC-B8]', async () => {
      // duration(months: 2, hours: 3)
      const result = await run('duration("2mo3h")');
      const native = toNative(result);
      expect(native.value).toEqual({ months: 2, ms: 10_800_000 });
    });

    it('toNativeValue() for fixed duration has months: 0', async () => {
      // duration(hours: 5)
      const result = await run('duration("5h")');
      const native = toNative(result);
      expect(native.value).toEqual({ months: 0, ms: 18_000_000 });
    });

    it('isDuration() returns true for duration values', async () => {
      const result = await run('duration("1h")');
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
        () => run('duration(...dict[hours: -2])'),
        'duration hours must be non-negative'
      );
    });

    it('halts on negative days [EC-2]', async () => {
      // duration(days: -1)
      await expectHaltMessage(
        () => run('duration(...dict[days: -1])'),
        'duration days must be non-negative'
      );
    });

    it('halts on negative months [EC-2]', async () => {
      // duration(months: -3)
      await expectHaltMessage(
        () => run('duration(...dict[months: -3])'),
        'duration months must be non-negative'
      );
    });

    it('halts on incomparable ordering with RILL-R002 [AC-E7]', async () => {
      // duration(months: 1) > duration(days: 30)
      await expect(run('duration("1mo") > duration("30d")')).rejects.toThrow(
        'Cannot order durations with different calendar components'
      );
    });

    it('halts on negative subtract result with RILL-R003 [AC-E8]', async () => {
      // duration(hours: 1) -> .subtract(duration(hours: 3))
      await expect(
        run('duration("1h") -> .subtract(duration("3h"))')
      ).rejects.toThrow('duration.subtract() would produce negative result');
    });

    it('halts on negative multiply factor with RILL-R003 [AC-E9]', async () => {
      // $dur -> .multiply(-1)
      await expect(
        run('duration("2h") => $dur\n$dur -> .multiply(-1)')
      ).rejects.toThrow('duration.multiply() requires non-negative number');
    });

    it('halts on fractional month result from multiply', async () => {
      // duration(months: 1) -> .multiply(0.5)
      await expect(run('duration("1mo") -> .multiply(0.5)')).rejects.toThrow(
        'duration.multiply() would produce a fractional month value'
      );
    });

    it('halts on non-finite result from multiply', async () => {
      const getInf: RillFunction = {
        params: [],
        returnType: structureToTypeValue({ kind: 'number' }),
        fn: () => Infinity,
      };
      await expectHaltMessage(
        () =>
          run('duration("2h") -> .multiply(getInf())', {
            functions: { getInf },
          }),
        "Host function 'getInf' returned a non-finite number at <root>: Infinity"
      );
    });

    it('halts on .total_ms for calendar duration with RILL-R003 [AC-E10]', async () => {
      // duration(months: 1) -> .total_ms
      await expect(run('duration("1mo") -> .total_ms')).rejects.toThrow(
        'total_ms is not defined for calendar durations'
      );
    });

    it('halts on cross-type ordering duration vs number [EC-5]', async () => {
      // duration(hours: 1) > 100
      await expect(run('duration("1h") > 100')).rejects.toThrow(
        'Cannot compare duration with number using >'
      );
    });

    it('halts on non-number parameter [EC-4]', async () => {
      // duration(hours: "two") - positional equivalent
      await expectHaltMessage(
        () => run('duration(...dict[hours: "two"])'),
        'duration hours must be a finite number: two'
      );
    });

    it('halts on NaN duration parameter', async () => {
      const getNaN: RillFunction = {
        params: [],
        returnType: structureToTypeValue({ kind: 'number' }),
        fn: () => NaN,
      };
      await expectHaltMessage(
        () =>
          run('duration(...dict[days: getNaN()])', { functions: { getNaN } }),
        "Host function 'getNaN' returned a non-finite number at <root>: NaN"
      );
    });

    it('halts on Infinity duration parameter', async () => {
      const getInf: RillFunction = {
        params: [],
        returnType: structureToTypeValue({ kind: 'number' }),
        fn: () => Infinity,
      };
      await expectHaltMessage(
        () =>
          run('duration(...dict[hours: getInf()])', { functions: { getInf } }),
        "Host function 'getInf' returned a non-finite number at <root>: Infinity"
      );
    });
  });

  // ============================================================
  // 10b. Text Form
  // ============================================================

  describe('text form', () => {
    const fromString = rule('duration.from-string').it;
    const noPositional = rule('duration.no-positional').it;
    const malformed = rule('duration.string-malformed').it;
    const roundTrip = rule('duration.round-trip').it;

    fromString('parses components equal to the spread dict form', async () => {
      const result = await run(
        'duration("1m30s") == duration(...dict[minutes: 1, seconds: 30])'
      );
      expect(result).toBe(true);
    });

    it('parses zero as 0ms', async () => {
      const result = await run('duration("0ms") -> .total_ms');
      expect(result).toBe(0);
    });

    noPositional('halts RILL-R001 on a positional number', async () => {
      await expectRuntimeError(() => run('duration(500)'), {
        code: 'RILL-R001',
      });
    });

    malformed.each(['30s1m', '1m1m', '', '1.5h', '-1s', '1 h'])(
      'halts INVALID_INPUT on malformed text %j and a guard catches it',
      async (text) => {
        await expectHalt(() => run(`duration("${text}")`), {
          code: 'INVALID_INPUT',
          messagePattern: 'duration() cannot parse',
        });
        const caught = await run(
          `guard { duration("${text}") } => $r\n$r.!code == #INVALID_INPUT`
        );
        expect(caught).toBe(true);
      }
    );

    fromString(
      'accepts a decimal ms count equal to the spread form',
      async () => {
        const result = await run(
          'duration("0.5ms") == duration(...dict[ms: 0.5])'
        );
        expect(result).toBe(true);
      }
    );

    roundTrip('round-trips fractional ms through interpolation', async () => {
      const result = await run(
        'duration(...dict[ms: 0.5]) => $d\nduration("{$d}") == $d'
      );
      expect(result).toBe(true);
    });

    it('halts INVALID_INPUT when a string and components are both given', async () => {
      await expectHalt(() => run('duration("1h", 0, 0, 0, 5)'), {
        code: 'INVALID_INPUT',
      });
    });

    const range = rule('duration.range').it;

    range('round-trips the largest whole-day duration', async () => {
      const result = await run(
        'duration(...dict[days: 104249991]) => $d\nduration("{$d}") == $d'
      );
      expect(result).toBe(true);
    });

    range('halts INVALID_INPUT one day past the range', async () => {
      await expectHalt(() => run('duration(...dict[days: 104249992])'), {
        code: 'INVALID_INPUT',
      });
      await expectHalt(() => run('duration("104249992d")'), {
        code: 'INVALID_INPUT',
      });
    });

    range('round-trips the largest millisecond count', async () => {
      const result = await run(
        'duration(...dict[ms: 9007199254740991]) => $d\nduration("{$d}") == $d'
      );
      expect(result).toBe(true);
    });

    range('halts INVALID_INPUT when .add overflows', async () => {
      await expectHalt(
        () =>
          run(
            'duration(...dict[ms: 9007199254740991]) -> .add(duration("1ms"))'
          ),
        { code: 'INVALID_INPUT' }
      );
    });

    range('halts INVALID_INPUT when .multiply overflows', async () => {
      await expectHalt(
        () => run('duration(...dict[ms: 9007199254740991]) -> .multiply(2)'),
        { code: 'INVALID_INPUT' }
      );
    });

    roundTrip('round-trips printed text through interpolation', async () => {
      for (const text of ['0ms', '1s', '2h30m', '1y2mo3d4h5m6s7ms', '500ms']) {
        const result = await run(
          `duration("${text}") => $d\nduration("{$d}") == $d`
        );
        expect(result).toBe(true);
      }
    });
  });

  // ============================================================
  // 11. Collection Errors
  // ============================================================

  describe('collection errors', () => {
    it('each on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(run('duration("1h") -> seq({ $ })')).rejects.toThrow(
        'Collection operators require list, tuple, string, dict, ordered, iterator, or stream, got duration'
      );
    });

    it('map on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(run('duration("1h") -> fan({ $ })')).rejects.toThrow(
        /Collection operators require/
      );
    });

    it('filter on duration halts with collection error [AC-E12, EC-6]', async () => {
      await expect(run('duration("1h") -> filter({ true })')).rejects.toThrow(
        /Collection operators require/
      );
    });
  });
});
