import type { SourceLocation } from '../../../../types.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { throwFatalHostHalt, throwTypeHalt } from '../../../core/types/halt.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import type {
  RillDatetime,
  RillDuration,
  RillValue,
} from '../../../core/types/structures.js';
import { isDatetime, isDuration } from '../../../core/types/guards.js';
import {
  requireDatetime,
  requireDuration,
} from '../../../core/types/protocols/shared.js';
import type { RillMethod } from '../shared.js';
import { orderedCompare } from '../methods/bodies.js';
import {
  maxDayInMonth,
  componentsToUnix,
  formatIso,
  formatDate,
  formatTime,
  validateIsoOffset,
} from './construct.js';

// ============================================================
// RECEIVER NARROWING
// ============================================================

function datetimeReceiver(
  receiver: RillValue,
  method: string,
  ctx: RuntimeContext,
  location: SourceLocation | undefined
): RillDatetime {
  if (isDatetime(receiver)) return receiver;
  return requireDatetime(receiver, {
    location,
    sourceId: ctx.sourceId,
    fn: method,
    preserveHostShape: true,
  });
}

function durationReceiver(
  receiver: RillValue,
  method: string,
  ctx: RuntimeContext,
  location: SourceLocation | undefined
): RillDuration {
  if (isDuration(receiver)) return receiver;
  return requireDuration(receiver, {
    location,
    sourceId: ctx.sourceId,
    fn: method,
    preserveHostShape: true,
  });
}

// ============================================================
// DATETIME METHOD BODIES
// ============================================================

/** .year property - UTC year */
export const mDtYear: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'year', ctx, location);
  return new Date(dt.unix).getUTCFullYear();
};

/** .month property - UTC month (1-12) */
export const mDtMonth: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'month', ctx, location);
  return new Date(dt.unix).getUTCMonth() + 1;
};

/** .day property - UTC day of month (1-31) */
export const mDtDay: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'day', ctx, location);
  return new Date(dt.unix).getUTCDate();
};

/** .hour property - UTC hour (0-23) */
export const mDtHour: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'hour', ctx, location);
  return new Date(dt.unix).getUTCHours();
};

/** .minute property - UTC minute (0-59) */
export const mDtMinute: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'minute', ctx, location);
  return new Date(dt.unix).getUTCMinutes();
};

/** .second property - UTC second (0-59) */
export const mDtSecond: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'second', ctx, location);
  return new Date(dt.unix).getUTCSeconds();
};

/** .ms property - UTC millisecond (0-999) */
export const mDtMs: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'ms', ctx, location);
  return new Date(dt.unix).getUTCMilliseconds();
};

/** .unix property - raw UTC ms since epoch */
export const mDtUnix: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'unix', ctx, location);
  return dt.unix;
};

/** .weekday property - 1 (Monday) through 7 (Sunday) */
export const mDtWeekday: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'weekday', ctx, location);
  const jsDay = new Date(dt.unix).getUTCDay(); // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay; // Convert to 1=Mon, 7=Sun
};

/** .zero property - returns datetime(unix: 0) */
export const mDtZero: RillMethod = () => {
  return { __rill_datetime: true, unix: 0 };
};

/** .iso(offset?) - full ISO 8601 with timezone indicator */
export const mDtIso: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'iso', ctx, location);
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  validateIsoOffset(offset, location, 'iso');
  return formatIso(dt.unix, offset);
};

/** .date(offset?) - "YYYY-MM-DD" portion */
export const mDtDate: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'date', ctx, location);
  const offset = typeof args[0] === 'number' ? args[0] : 0;
  return formatDate(dt.unix, offset);
};

/** .time(offset?) - "HH:MM:SS" portion */
export const mDtTime: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'time', ctx, location);
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
  const dt = datetimeReceiver(receiver, 'local_iso', ctx, location);
  const offset = getTimezoneOffset(ctx, location);
  validateIsoOffset(offset, location, 'local_iso');
  return formatIso(dt.unix, offset);
};

/** .local_date property - "YYYY-MM-DD" at host timezone */
export const mDtLocalDate: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'local_date', ctx, location);
  const offset = getTimezoneOffset(ctx, location);
  return formatDate(dt.unix, offset);
};

/** .local_time property - "HH:MM:SS" at host timezone */
export const mDtLocalTime: RillMethod = (receiver, _args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'local_time', ctx, location);
  const offset = getTimezoneOffset(ctx, location);
  return formatTime(dt.unix, offset);
};

/** .local_offset property - host timezone offset in hours */
export const mDtLocalOffset: RillMethod = (_receiver, _args, ctx, location) => {
  return getTimezoneOffset(ctx, location);
};

/** .add(dur) - add a duration to a datetime */
export const mDtAdd: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'add', ctx, location);
  const dur = args[0] ?? null;
  if (!isDuration(dur)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'add', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'datetime.add() requires a duration argument'
    );
  }
  const d = dur;
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

  return { __rill_datetime: true, unix: resultMs };
};

/** .diff(other) - absolute difference between two datetimes as duration */
export const mDtDiff: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'diff', ctx, location);
  const other = args[0] ?? null;
  if (!isDatetime(other)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'diff', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'datetime.diff() requires a datetime argument'
    );
  }
  const otherDt = other;
  const diffMs = Math.abs(dt.unix - otherDt.unix);
  // Always non-negative, months = 0
  return {
    __rill_duration: true,
    months: 0,
    ms: diffMs,
  };
};

/** .eq(other) - datetime equality */
export const mDtEq: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'eq', ctx, location);
  const other = args[0] ?? null;
  if (!isDatetime(other)) return false;
  return dt.unix === other.unix;
};

/** .ne(other) - datetime inequality */
export const mDtNe: RillMethod = (receiver, args, ctx, location) => {
  const dt = datetimeReceiver(receiver, 'ne', ctx, location);
  const other = args[0] ?? null;
  if (!isDatetime(other)) return true;
  return dt.unix !== other.unix;
};

/** .lt(other) - datetime less-than */
export const mDtLt: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'lt') < 0;

/** .gt(other) - datetime greater-than */
export const mDtGt: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'gt') > 0;

/** .le(other) - datetime less-than-or-equal */
export const mDtLe: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'le') <= 0;

/** .ge(other) - datetime greater-than-or-equal */
export const mDtGe: RillMethod = (receiver, args, ctx, location) =>
  orderedCompare(receiver, args, ctx, location, 'ge') >= 0;

// ============================================================
// DURATION METHOD BODIES
// ============================================================

/** .months property - calendar month count */
export const mDurMonths: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'months', ctx, location);
  return dur.months;
};

/** .days property - floor(ms / 86400000) */
export const mDurDays: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'days', ctx, location);
  return Math.floor(dur.ms / 86_400_000);
};

/** .hours property - remainder after days */
export const mDurHours: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'hours', ctx, location);
  const afterDays = dur.ms % 86_400_000;
  return Math.floor(afterDays / 3_600_000);
};

/** .minutes property - remainder after hours */
export const mDurMinutes: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'minutes', ctx, location);
  const afterHours = dur.ms % 3_600_000;
  return Math.floor(afterHours / 60_000);
};

/** .seconds property - remainder after minutes */
export const mDurSeconds: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'seconds', ctx, location);
  const afterMinutes = dur.ms % 60_000;
  return Math.floor(afterMinutes / 1_000);
};

/** .ms property - remainder after seconds */
export const mDurMs: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'ms', ctx, location);
  return dur.ms % 1_000;
};

/** .total_ms property - raw ms; halts when months > 0 */
export const mDurTotalMs: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'total_ms', ctx, location);
  if (dur.months > 0) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'total_ms',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'total_ms is not defined for calendar durations'
    );
  }
  return dur.ms;
};

/** .display property - compact format omitting zero components */
export const mDurDisplay: RillMethod = (receiver, _args, ctx, location) => {
  const dur = durationReceiver(receiver, 'display', ctx, location);
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
  };
};

/** .add(other) - sum months fields, sum ms fields */
export const mDurAdd: RillMethod = (receiver, args, ctx, location) => {
  const dur = durationReceiver(receiver, 'add', ctx, location);
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throwFatalHostHalt(
      { location, sourceId: ctx.sourceId, fn: 'add', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.add() requires a duration argument'
    );
  }
  const otherDur = other;
  return {
    __rill_duration: true,
    months: dur.months + otherDur.months,
    ms: dur.ms + otherDur.ms,
  };
};

/** .subtract(other) - halt if result would be negative in either field */
export const mDurSubtract: RillMethod = (receiver, args, ctx, location) => {
  const dur = durationReceiver(receiver, 'subtract', ctx, location);
  const other = args[0] ?? null;
  if (!isDuration(other)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'subtract',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.subtract() requires a duration argument'
    );
  }
  const otherDur = other;
  const resultMonths = dur.months - otherDur.months;
  const resultMs = dur.ms - otherDur.ms;
  if (resultMonths < 0 || resultMs < 0) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'subtract',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.subtract() would produce negative result'
    );
  }
  return {
    __rill_duration: true,
    months: resultMonths,
    ms: resultMs,
  };
};

/** .multiply(n) - months and ms each multiplied independently */
export const mDurMultiply: RillMethod = (receiver, args, ctx, location) => {
  const dur = durationReceiver(receiver, 'multiply', ctx, location);
  const n = args[0] ?? null;
  if (typeof n !== 'number') {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'multiply',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.multiply() requires a number argument'
    );
  }
  if (n < 0) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'multiply',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.multiply() requires non-negative number'
    );
  }
  const months = dur.months * n;
  const ms = dur.ms * n;
  if (!Number.isFinite(months) || !Number.isFinite(ms)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'multiply',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.multiply() would produce a non-finite result'
    );
  }
  if (!Number.isInteger(months)) {
    throwFatalHostHalt(
      {
        location,
        sourceId: ctx.sourceId,
        fn: 'multiply',
        preserveHostShape: true,
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'duration.multiply() would produce a fractional month value'
    );
  }
  return {
    __rill_duration: true,
    months,
    ms,
  };
};
