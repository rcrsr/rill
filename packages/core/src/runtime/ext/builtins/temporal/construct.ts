import type { SourceLocation } from '../../../../types.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import type { RillValue } from '../../../core/types/structures.js';
import { formatValue } from '../../../core/types/registrations.js';

// ============================================================
// DATETIME CONSTRUCTION HELPERS
// ============================================================

/** ISO 8601 regex: YYYY-MM-DDTHH:MM:SS[.mmm][Z|+HH:MM|-HH:MM] */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** Valid datetime named component keys */
const DATETIME_COMPONENT_KEYS = new Set([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'ms',
]);

/** Days in each month (non-leap year). Index 0 unused. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function maxDayInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month]!;
}

/**
 * Build a unix ms timestamp from calendar components using setUTCFullYear,
 * which avoids Date.UTC's legacy two-digit-year rule (years 0-99 mapped to
 * 1900-1999). Halts with #INVALID_INPUT if the resulting timestamp is NaN.
 */
export function componentsToUnix(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  location?: SourceLocation
): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, ms);
  const unix = d.getTime();
  if (Number.isNaN(unix)) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime components: year=${year}, month=${month}, day=${day}`,
      'runtime'
    );
  }
  return unix;
}

function validateComponent(
  name: string,
  value: number,
  min: number,
  max: number,
  location?: SourceLocation
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component ${name}: ${value}`,
      'runtime',
      { component: name }
    );
  }
}

/**
 * Construct a RillDatetime from parsed args.
 * Handles ISO string, named components, and unix ms forms.
 */
export function constructDatetime(
  args: Record<string, RillValue>,
  location?: SourceLocation
): RillValue {
  const input = args['input'] ?? null;
  const hasUnix = args['unix'] !== undefined && args['unix'] !== null;
  const hasYear = args['year'] !== undefined && args['year'] !== null;
  const hasInput = input !== null;

  // Count active forms
  const formCount =
    (hasInput && typeof input === 'string' ? 1 : 0) +
    (hasYear ? 1 : 0) +
    (hasUnix ? 1 : 0);

  // No arguments provided
  if (!hasInput && !hasYear && !hasUnix) {
    // Check if any optional time components were passed without year/month/day
    const hasTimeOnly =
      (args['hour'] !== undefined &&
        args['hour'] !== null &&
        args['hour'] !== 0) ||
      (args['minute'] !== undefined &&
        args['minute'] !== null &&
        args['minute'] !== 0) ||
      (args['second'] !== undefined &&
        args['second'] !== null &&
        args['second'] !== 0) ||
      (args['ms'] !== undefined && args['ms'] !== null && args['ms'] !== 0);
    if (hasTimeOnly) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        'datetime() accepts string, named components, or unix',
        'runtime'
      );
    }
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() requires arguments',
      'runtime'
    );
  }

  // Mixed forms
  if (formCount > 1) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() accepts string, named components, or unix',
      'runtime'
    );
  }

  // Check for unknown parameters
  for (const key of Object.keys(args)) {
    if (
      key !== 'input' &&
      key !== 'unix' &&
      !DATETIME_COMPONENT_KEYS.has(key)
    ) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Unknown datetime parameter: ${key}`,
        'runtime',
        { parameter: key }
      );
    }
  }

  // Form 1: ISO 8601 string
  if (hasInput && typeof input === 'string') {
    // Reject non-ISO formats
    if (!ISO_8601_RE.test(input)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid ISO 8601 string: ${input}`,
        'runtime'
      );
    }
    // Validate the calendar portion (YYYY-MM-DD) explicitly: Date.parse
    // accepts impossible dates like 2024-02-30 by rolling them forward.
    const y = Number(input.slice(0, 4));
    const mo = Number(input.slice(5, 7));
    const da = Number(input.slice(8, 10));
    validateComponent('month', mo, 1, 12, location);
    validateComponent('day', da, 1, maxDayInMonth(y, mo), location);

    // An offset-less datetime-with-time (has a time part but no trailing Z
    // or +HH:MM/-HH:MM offset) is otherwise parsed in the host's local
    // timezone by Date.parse, which is non-deterministic across
    // environments. Anchor it to UTC instead, matching the date-only form.
    const hasTime = input.length > 10;

    // Validate the time-of-day portion explicitly: Date.parse accepts
    // out-of-range values like T24:00:00 and rolls them into the next day,
    // whereas the named-component form rejects hour 24 outright.
    if (hasTime) {
      const hh = Number(input.slice(11, 13));
      const mm = Number(input.slice(14, 16));
      const hasSeconds = input[16] === ':';
      const ss = hasSeconds ? Number(input.slice(17, 19)) : 0;
      validateComponent('hour', hh, 0, 23, location);
      validateComponent('minute', mm, 0, 59, location);
      validateComponent('second', ss, 0, 59, location);
    }
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(input);
    const normalizedInput = hasTime && !hasOffset ? `${input}Z` : input;

    const ms = Date.parse(normalizedInput);
    if (Number.isNaN(ms)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid ISO 8601 string: ${input}`,
        'runtime'
      );
    }
    return { __rill_datetime: true, unix: ms } as unknown as RillValue;
  }

  // Form 1 non-string: halt
  if (hasInput) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid ISO 8601 string: ${formatValue(input)}`,
      'runtime'
    );
  }

  // Form 3: Unix milliseconds
  if (hasUnix) {
    const unix = args['unix'];
    if (typeof unix !== 'number' || !Number.isFinite(unix)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        `Invalid datetime component unix: ${formatValue(unix ?? null)}`,
        'runtime',
        { component: 'unix' }
      );
    }
    return { __rill_datetime: true, unix } as unknown as RillValue;
  }

  // Form 2: Named components
  const year = args['year'] as number;
  const month = args['month'];
  const day = args['day'];

  if (typeof year !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component year: ${formatValue(year)}`,
      'runtime',
      { component: 'year' }
    );
  }
  if (month === undefined || month === null || typeof month !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component month: ${formatValue(month ?? null)}`,
      'runtime',
      { component: 'month' }
    );
  }
  if (day === undefined || day === null || typeof day !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      `Invalid datetime component day: ${formatValue(day ?? null)}`,
      'runtime',
      { component: 'day' }
    );
  }

  validateComponent('year', year, -271821, 275760, location);
  validateComponent('month', month, 1, 12, location);
  validateComponent('day', day, 1, maxDayInMonth(year, month), location);

  const hour = typeof args['hour'] === 'number' ? args['hour'] : 0;
  const minute = typeof args['minute'] === 'number' ? args['minute'] : 0;
  const second = typeof args['second'] === 'number' ? args['second'] : 0;
  const ms = typeof args['ms'] === 'number' ? args['ms'] : 0;

  validateComponent('hour', hour, 0, 23, location);
  validateComponent('minute', minute, 0, 59, location);
  validateComponent('second', second, 0, 59, location);
  validateComponent('ms', ms, 0, 999, location);

  const unix = componentsToUnix(
    year,
    month,
    day,
    hour,
    minute,
    second,
    ms,
    location
  );
  return { __rill_datetime: true, unix } as unknown as RillValue;
}

// ============================================================
// DURATION CONSTRUCTION HELPERS
// ============================================================

/** Valid duration named parameter keys */
const DURATION_PARAM_KEYS = new Set([
  'years',
  'months',
  'days',
  'hours',
  'minutes',
  'seconds',
  'ms',
]);

/**
 * Validate a duration parameter: must be a finite, non-negative number.
 * Halts with invalid #INVALID_INPUT on non-number or negative value.
 */
function validateDurationParam(
  name: string,
  value: RillValue,
  location?: SourceLocation,
  requireInteger = false
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwTypeHalt(
      { location, fn: 'duration' },
      'INVALID_INPUT',
      `duration ${name} must be a finite number: ${formatValue(value)}`,
      'runtime',
      { parameter: name }
    );
  }
  if (value < 0) {
    throwTypeHalt(
      { location, fn: 'duration' },
      'INVALID_INPUT',
      `duration ${name} must be non-negative: ${value}`,
      'runtime',
      { parameter: name }
    );
  }
  if (requireInteger && !Number.isInteger(value)) {
    throwTypeHalt(
      { location, fn: 'duration' },
      'INVALID_INPUT',
      `duration ${name} must be an integer: ${value}`,
      'runtime',
      { parameter: name }
    );
  }
  return value;
}

/**
 * Construct a RillDuration from parsed args.
 * Collapses calendar units to months field and fixed units to ms field.
 */
export function constructDuration(
  args: Record<string, RillValue>,
  location?: SourceLocation
): RillValue {
  // Check for unknown parameters
  for (const key of Object.keys(args)) {
    if (!DURATION_PARAM_KEYS.has(key)) {
      throwTypeHalt(
        { location, fn: 'duration' },
        'INVALID_INPUT',
        `Unknown duration parameter: ${key}`,
        'runtime',
        { parameter: key }
      );
    }
  }

  const years =
    args['years'] !== undefined && args['years'] !== null && args['years'] !== 0
      ? validateDurationParam('years', args['years'], location, true)
      : 0;
  const months =
    args['months'] !== undefined &&
    args['months'] !== null &&
    args['months'] !== 0
      ? validateDurationParam('months', args['months'], location, true)
      : 0;
  const days =
    args['days'] !== undefined && args['days'] !== null && args['days'] !== 0
      ? validateDurationParam('days', args['days'], location)
      : 0;
  const hours =
    args['hours'] !== undefined && args['hours'] !== null && args['hours'] !== 0
      ? validateDurationParam('hours', args['hours'], location)
      : 0;
  const minutes =
    args['minutes'] !== undefined &&
    args['minutes'] !== null &&
    args['minutes'] !== 0
      ? validateDurationParam('minutes', args['minutes'], location)
      : 0;
  const seconds =
    args['seconds'] !== undefined &&
    args['seconds'] !== null &&
    args['seconds'] !== 0
      ? validateDurationParam('seconds', args['seconds'], location)
      : 0;
  const ms =
    args['ms'] !== undefined && args['ms'] !== null && args['ms'] !== 0
      ? validateDurationParam('ms', args['ms'], location)
      : 0;

  // Collapse calendar units to months field
  const totalMonths = years * 12 + months;

  // Collapse fixed units to ms field
  const totalMs =
    days * 86_400_000 +
    hours * 3_600_000 +
    minutes * 60_000 +
    seconds * 1_000 +
    ms;

  return {
    __rill_duration: true,
    months: totalMonths,
    ms: totalMs,
  } as unknown as RillValue;
}

// ============================================================
// DATETIME FORMATTING HELPERS
// ============================================================

/** Pad a number to the given width with leading zeros */
function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Apply an offset in hours to a UTC ms timestamp and return a Date-like
 * breakdown. The offset may be fractional (e.g. 5.5 for +05:30).
 */
function applyOffset(
  utcMs: number,
  offsetHours: number
): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
} {
  const shifted = new Date(utcMs + offsetHours * 3_600_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    s: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

/** Format timezone offset string like "+05:30" or "Z" */
function formatOffsetSuffix(offsetHours: number): string {
  if (offsetHours === 0) return 'Z';
  const sign = offsetHours >= 0 ? '+' : '-';
  const totalMinutes = Math.round(Math.abs(offsetHours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${padNum(h, 2)}:${padNum(m, 2)}`;
}

/** Format as full ISO 8601 string with timezone indicator */
export function formatIso(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  const suffix = formatOffsetSuffix(offsetHours);
  return (
    `${padNum(p.y, 4)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}` +
    `T${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}` +
    (p.ms > 0 ? `.${padNum(p.ms, 3)}` : '') +
    suffix
  );
}

/** Format as "YYYY-MM-DD" */
export function formatDate(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${padNum(p.y, 4)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}`;
}

/** Format as "HH:MM:SS" */
export function formatTime(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}`;
}
