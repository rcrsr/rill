import type { SourceLocation } from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import { ERROR_IDS } from '../../../../error-registry.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import type {
  RillDatetime,
  RillDuration,
  RillValue,
} from '../../../core/types/structures.js';
import { isDatetime, isDuration } from '../../../core/types/guards.js';
import type { RillMethod } from '../shared.js';
import {
  maxDayInMonth,
  componentsToUnix,
  formatIso,
  formatDate,
  formatTime,
} from './construct.js';

// ============================================================
// DATETIME METHOD BODIES
// ============================================================

/** .year property - UTC year */
export const mDtYear: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCFullYear();
};

/** .month property - UTC month (1-12) */
export const mDtMonth: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMonth() + 1;
};

/** .day property - UTC day of month (1-31) */
export const mDtDay: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCDate();
};

/** .hour property - UTC hour (0-23) */
export const mDtHour: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCHours();
};

/** .minute property - UTC minute (0-59) */
export const mDtMinute: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMinutes();
};

/** .second property - UTC second (0-59) */
export const mDtSecond: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCSeconds();
};

/** .ms property - UTC millisecond (0-999) */
export const mDtMs: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return new Date(dt.unix).getUTCMilliseconds();
};

/** .unix property - raw UTC ms since epoch */
export const mDtUnix: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  return dt.unix;
};

/** .weekday property - 1 (Monday) through 7 (Sunday) */
export const mDtWeekday: RillMethod = (receiver) => {
  const dt = receiver as unknown as RillDatetime;
  const jsDay = new Date(dt.unix).getUTCDay(); // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay; // Convert to 1=Mon, 7=Sun
};

/** .zero property - returns datetime(unix: 0) */
export const mDtZero: RillMethod = () => {
  return { __rill_datetime: true, unix: 0 } as unknown as RillValue;
};

/** .iso(offset?) - full ISO 8601 with timezone indicator */
export const mDtIso: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatIso(dt.unix, offset);
};

/** .date(offset?) - "YYYY-MM-DD" portion */
export const mDtDate: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatDate(dt.unix, offset);
};

/** .time(offset?) - "HH:MM:SS" portion */
export const mDtTime: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatTime(dt.unix, offset);
};

/** Validate and return the timezone offset from ctx, defaulting to 0 */
function getTimezoneOffset(
  ctx: RuntimeContext,
  location?: SourceLocation
): number {
  const tz = ctx.timezone;
  if (tz === undefined) return 0;
  if (!Number.isFinite(tz)) {
    throwTypeHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'timezone',
      },
      'INVALID_INPUT',
      `Invalid timezone offset: ${tz}`,
      'runtime',
      undefined,
      'host'
    );
  }
  return tz;
}

/** .local_iso property - ISO 8601 with host timezone offset */
export const mDtLocalIso: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatIso(dt.unix, offset);
};

/** .local_date property - "YYYY-MM-DD" at host timezone */
export const mDtLocalDate: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatDate(dt.unix, offset);
};

/** .local_time property - "HH:MM:SS" at host timezone */
export const mDtLocalTime: RillMethod = (receiver, _args, ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const offset = getTimezoneOffset(ctx, location);
  return formatTime(dt.unix, offset);
};

/** .local_offset property - host timezone offset in hours */
export const mDtLocalOffset: RillMethod = (_receiver, _args, ctx, location) => {
  return getTimezoneOffset(ctx, location);
};

/** .add(dur) - add a duration to a datetime */
export const mDtAdd: RillMethod = (receiver, args, _ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const dur = args[0] ?? null;
  if (!isDuration(dur)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'datetime.add() requires a duration argument',
      location
    );
  }
  const d = dur as unknown as RillDuration;
  let resultMs = dt.unix;

  // Apply calendar months first (PostgreSQL order)
  if (d.months !== 0) {
    const date = new Date(resultMs);
    let targetMonth = date.getUTCMonth() + d.months;
    let targetYear = date.getUTCFullYear();

    // Normalize month overflow
    targetYear += Math.floor(targetMonth / 12);
    targetMonth = targetMonth % 12;
    if (targetMonth < 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    // Clamp day to last valid day of target month
    const maxDay = maxDayInMonth(targetYear, targetMonth + 1);
    const clampedDay = Math.min(date.getUTCDate(), maxDay);

    resultMs = componentsToUnix(
      targetYear,
      targetMonth + 1,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
      location
    );
  }

  // Then apply milliseconds
  resultMs += d.ms;

  // JS Date only represents timestamps within ±8,640,000,000,000,000ms
  // (±100,000,000 days) of the epoch. Arithmetic can stay finite yet land
  // outside that range, which later formats as Invalid Date / NaN fields.
  if (!Number.isFinite(resultMs) || Math.abs(resultMs) > 8640000000000000) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime.add() produced an invalid result',
      'runtime'
    );
  }

  return { __rill_datetime: true, unix: resultMs } as unknown as RillValue;
};

/** .diff(other) - absolute difference between two datetimes as duration */
export const mDtDiff: RillMethod = (receiver, args, _ctx, location) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'datetime.diff() requires a datetime argument',
      location
    );
  }
  const otherDt = other as unknown as RillDatetime;
  const diffMs = Math.abs(dt.unix - otherDt.unix);
  // Always non-negative, months = 0
  return {
    __rill_duration: true,
    months: 0,
    ms: diffMs,
  } as unknown as RillValue;
};

/** .eq(other) - datetime equality */
export const mDtEq: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix === (other as unknown as RillDatetime).unix;
};

/** .ne(other) - datetime inequality */
export const mDtNe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return true;
  return dt.unix !== (other as unknown as RillDatetime).unix;
};

/** .lt(other) - datetime less-than */
export const mDtLt: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix < (other as unknown as RillDatetime).unix;
};

/** .gt(other) - datetime greater-than */
export const mDtGt: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix > (other as unknown as RillDatetime).unix;
};

/** .le(other) - datetime less-than-or-equal */
export const mDtLe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix <= (other as unknown as RillDatetime).unix;
};

/** .ge(other) - datetime greater-than-or-equal */
export const mDtGe: RillMethod = (receiver, args) => {
  const dt = receiver as unknown as RillDatetime;
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix >= (other as unknown as RillDatetime).unix;
};

// ============================================================
// DURATION METHOD BODIES
// ============================================================

/** .months property - calendar month count */
export const mDurMonths: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return dur.months;
};

/** .days property - floor(ms / 86400000) */
export const mDurDays: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return Math.floor(dur.ms / 86_400_000);
};

/** .hours property - remainder after days */
export const mDurHours: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterDays = dur.ms % 86_400_000;
  return Math.floor(afterDays / 3_600_000);
};

/** .minutes property - remainder after hours */
export const mDurMinutes: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterHours = dur.ms % 3_600_000;
  return Math.floor(afterHours / 60_000);
};

/** .seconds property - remainder after minutes */
export const mDurSeconds: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const afterMinutes = dur.ms % 60_000;
  return Math.floor(afterMinutes / 1_000);
};

/** .ms property - remainder after seconds */
export const mDurMs: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  return dur.ms % 1_000;
};

/** .total_ms property - raw ms; halts when months > 0 */
export const mDurTotalMs: RillMethod = (receiver, _args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  if (dur.months > 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'total_ms is not defined for calendar durations',
      location
    );
  }
  return dur.ms;
};

/** .display property - compact format omitting zero components */
export const mDurDisplay: RillMethod = (receiver) => {
  const dur = receiver as unknown as RillDuration;
  const parts: string[] = [];

  // Calendar portion
  const years = Math.floor(dur.months / 12);
  const remainingMonths = dur.months % 12;
  if (years > 0) parts.push(`${years}y`);
  if (remainingMonths > 0) parts.push(`${remainingMonths}mo`);

  // Clock portion (largest-first decomposition)
  let remaining = dur.ms;
  const days = Math.floor(remaining / 86_400_000);
  remaining = remaining % 86_400_000;
  const hours = Math.floor(remaining / 3_600_000);
  remaining = remaining % 3_600_000;
  const minutes = Math.floor(remaining / 60_000);
  remaining = remaining % 60_000;
  const seconds = Math.floor(remaining / 1_000);
  const ms = remaining % 1_000;

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (ms > 0) parts.push(`${ms}ms`);

  // Zero duration displays as "0ms"
  if (parts.length === 0) return '0ms';
  return parts.join('');
};

/** .zero property - returns duration(ms: 0) */
export const mDurZero: RillMethod = () => {
  return {
    __rill_duration: true,
    months: 0,
    ms: 0,
  } as unknown as RillValue;
};

/** .add(other) - sum months fields, sum ms fields */
export const mDurAdd: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.add() requires a duration argument',
      location
    );
  }
  const otherDur = other as unknown as RillDuration;
  return {
    __rill_duration: true,
    months: dur.months + otherDur.months,
    ms: dur.ms + otherDur.ms,
  } as unknown as RillValue;
};

/** .subtract(other) - halt if result would be negative in either field */
export const mDurSubtract: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.subtract() requires a duration argument',
      location
    );
  }
  const otherDur = other as unknown as RillDuration;
  const resultMonths = dur.months - otherDur.months;
  const resultMs = dur.ms - otherDur.ms;
  if (resultMonths < 0 || resultMs < 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.subtract() would produce negative result',
      location
    );
  }
  return {
    __rill_duration: true,
    months: resultMonths,
    ms: resultMs,
  } as unknown as RillValue;
};

/** .multiply(n) - months and ms each multiplied independently */
export const mDurMultiply: RillMethod = (receiver, args, _ctx, location) => {
  const dur = receiver as unknown as RillDuration;
  const n = args[0] ?? null;
  if (typeof n !== 'number') {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.multiply() requires a number argument',
      location
    );
  }
  if (n < 0) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R003,
      'duration.multiply() requires non-negative number',
      location
    );
  }
  return {
    __rill_duration: true,
    months: dur.months * n,
    ms: dur.ms * n,
  } as unknown as RillValue;
};
