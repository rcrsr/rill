import type { SourceLocation } from '../../../../types.js';
import { throwTypeHalt } from '../../../core/types/halt.js';
import { requireDurationInRange } from '../../../core/types/duration-limit.js';
import type { RillValue } from '../../../core/types/structures.js';
import {
  DURATION_UNITS,
  MS_PER_HOUR,
  parseDurationText,
} from '../../../core/types/duration-units.js';
import { formatValue, inferType } from '../../../core/types/registrations.js';

// ============================================================
// DATETIME CONSTRUCTION HELPERS
// ============================================================

/**
 * ISO 8601 regex: [+-]YYYY(YY)-MM-DDTHH:MM:SS[.mmm][Z|+HH:MM|-HH:MM]
 * The year is either exactly 4 unsigned digits (the default range) or an
 * explicitly signed 4-or-more digit extended year, matching how
 * formatIso/formatDate emit years outside 0-9999. A sign-less year with
 * more than 4 digits is rejected rather than admitted: Date.parse does not
 * treat an unsigned extended year as ECMA-262 extended-year format (that
 * form requires the sign), so it would otherwise fall back to a
 * timezone-dependent legacy parse.
 */
const ISO_8601_RE =
  /^(?:\d{4}|[+-]\d{4,})-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

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
  return DAYS_IN_MONTH[month] ?? 0;
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

/** Message for an out-of-range integer component, or undefined when valid. */
function componentError(
  name: string,
  value: number,
  min: number,
  max: number
): string | undefined {
  if (!Number.isInteger(value) || value < min || value > max) {
    return `Invalid datetime component ${name}: ${value}`;
  }
  return undefined;
}

function validateComponent(
  name: string,
  value: number,
  min: number,
  max: number,
  location?: SourceLocation
): void {
  const message = componentError(name, value, min, max);
  if (message !== undefined) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      message,
      'runtime',
      { component: name }
    );
  }
}

/** Failure of {@link parseIsoDatetime}; `component` names a range-checked field. */
export interface IsoDatetimeFailure {
  readonly message: string;
  readonly component?: string | undefined;
}

/**
 * Parse an ISO 8601 datetime or date string to unix milliseconds. Pure:
 * returns the failure message instead of halting.
 */
export function parseIsoDatetime(input: string): number | IsoDatetimeFailure {
  const invalid = { message: `Invalid ISO 8601 string: ${input}` };
  if (!ISO_8601_RE.test(input)) return invalid;

  // Validate the calendar portion (YYYY-MM-DD) explicitly: Date.parse
  // accepts impossible dates like 2024-02-30 by rolling them forward.
  // The year field may carry a leading sign and more than 4 digits (see
  // ISO_8601_RE), so every fixed offset below the year is shifted by
  // yearOffset, the number of characters beyond the default 4-digit year.
  const yearStr = input.slice(0, input.indexOf('-', 1));
  const yearOffset = yearStr.length - 4;
  const y = Number(yearStr);
  const mo = Number(input.slice(5 + yearOffset, 7 + yearOffset));
  const da = Number(input.slice(8 + yearOffset, 10 + yearOffset));
  const checks: [string, number, number, number][] = [
    ['month', mo, 1, 12],
    ['day', da, 1, maxDayInMonth(y, mo)],
  ];

  // An offset-less datetime-with-time (has a time part but no trailing Z
  // or +HH:MM/-HH:MM offset) is otherwise parsed in the host's local
  // timezone by Date.parse, which is non-deterministic across
  // environments. Anchor it to UTC instead, matching the date-only form.
  const hasTime = input.length > 10 + yearOffset;

  // Validate the time-of-day portion explicitly: Date.parse accepts
  // out-of-range values like T24:00:00 and rolls them into the next day,
  // whereas the named-component form rejects hour 24 outright.
  if (hasTime) {
    const hasSeconds = input[16 + yearOffset] === ':';
    checks.push(
      ['hour', Number(input.slice(11 + yearOffset, 13 + yearOffset)), 0, 23],
      ['minute', Number(input.slice(14 + yearOffset, 16 + yearOffset)), 0, 59],
      [
        'second',
        hasSeconds ? Number(input.slice(17 + yearOffset, 19 + yearOffset)) : 0,
        0,
        59,
      ]
    );
  }
  for (const [name, value, min, max] of checks) {
    const message = componentError(name, value, min, max);
    if (message !== undefined) return { message, component: name };
  }

  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(input);
  const ms = Date.parse(hasTime && !hasOffset ? `${input}Z` : input);
  return Number.isNaN(ms) ? invalid : ms;
}

/** Read an optional numeric component; absent defaults to 0, non-number halts. */
function optionalComponent(
  name: string,
  value: RillValue | undefined,
  location?: SourceLocation
): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'TYPE_MISMATCH',
      `Invalid datetime component ${name}: ${formatValue(value)}`,
      'runtime',
      { component: name }
    );
  }
  return value;
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
    const parsed = parseIsoDatetime(input);
    if (typeof parsed !== 'number') {
      throwTypeHalt(
        { location, fn: 'datetime' },
        'INVALID_INPUT',
        parsed.message,
        'runtime',
        parsed.component === undefined
          ? undefined
          : { component: parsed.component }
      );
    }
    return { __rill_datetime: true, unix: parsed };
  }

  // Form 1 non-string: halt
  if (hasInput) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'TYPE_MISMATCH',
      `datetime input must be a string, got ${inferType(input)}`,
      'runtime'
    );
  }

  // Form 3: Unix milliseconds
  if (hasUnix) {
    const unix = args['unix'];
    if (typeof unix !== 'number' || !Number.isFinite(unix)) {
      throwTypeHalt(
        { location, fn: 'datetime' },
        typeof unix === 'number' ? 'INVALID_INPUT' : 'TYPE_MISMATCH',
        `Invalid datetime component unix: ${formatValue(unix ?? null)}`,
        'runtime',
        { component: 'unix' }
      );
    }
    return { __rill_datetime: true, unix };
  }

  // Form 2: Named components
  const year = args['year'];
  const month = args['month'];
  const day = args['day'];

  if (typeof year !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'TYPE_MISMATCH',
      `Invalid datetime component year: ${formatValue(year ?? null)}`,
      'runtime',
      { component: 'year' }
    );
  }
  if (month === undefined || month === null) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() named-component form requires month, but it was not provided',
      'runtime',
      { component: 'month' }
    );
  }
  if (typeof month !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'TYPE_MISMATCH',
      `Invalid datetime component month: ${formatValue(month)}`,
      'runtime',
      { component: 'month' }
    );
  }
  if (day === undefined || day === null) {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'INVALID_INPUT',
      'datetime() named-component form requires day, but it was not provided',
      'runtime',
      { component: 'day' }
    );
  }
  if (typeof day !== 'number') {
    throwTypeHalt(
      { location, fn: 'datetime' },
      'TYPE_MISMATCH',
      `Invalid datetime component day: ${formatValue(day)}`,
      'runtime',
      { component: 'day' }
    );
  }

  validateComponent('year', year, -271821, 275760, location);
  validateComponent('month', month, 1, 12, location);
  validateComponent('day', day, 1, maxDayInMonth(year, month), location);

  const hour = optionalComponent('hour', args['hour'], location);
  const minute = optionalComponent('minute', args['minute'], location);
  const second = optionalComponent('second', args['second'], location);
  const ms = optionalComponent('ms', args['ms'], location);

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
  return { __rill_datetime: true, unix };
}

// ============================================================
// DURATION CONSTRUCTION HELPERS
// ============================================================

/** Valid duration named parameter keys */
const DURATION_PARAM_KEYS: ReadonlySet<string> = new Set([
  'input',
  ...DURATION_UNITS.map((u) => u.name),
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
  if (typeof value !== 'number') {
    throwTypeHalt(
      { location, fn: 'duration' },
      'TYPE_MISMATCH',
      `duration ${name} must be a finite number: ${formatValue(value)}`,
      'runtime',
      { parameter: name }
    );
  }
  if (!Number.isFinite(value)) {
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

  const input = args['input'];
  if (typeof input === 'string') {
    const hasComponents = DURATION_UNITS.some((unit) => {
      const value = args[unit.name];
      return value !== undefined && value !== null && value !== 0;
    });
    if (hasComponents) {
      throwTypeHalt(
        { location, fn: 'duration' },
        'INVALID_INPUT',
        'duration() accepts string or named components',
        'runtime'
      );
    }
    const parsed = parseDurationText(input);
    if (parsed === undefined) {
      throwTypeHalt(
        { location, fn: 'duration' },
        'INVALID_INPUT',
        `duration() cannot parse "${input}"`,
        'runtime'
      );
    }
    requireDurationInRange(
      parsed.months,
      parsed.ms,
      { location, fn: 'duration' },
      'duration()'
    );
    return { __rill_duration: true, months: parsed.months, ms: parsed.ms };
  }

  // Collapse each unit into its target field via the unit table
  const totals = { months: 0, ms: 0 };
  for (const unit of DURATION_UNITS) {
    const value = args[unit.name];
    if (value !== undefined && value !== null && value !== 0) {
      totals[unit.field] +=
        validateDurationParam(unit.name, value, location, unit.integerOnly) *
        unit.factor;
    }
  }

  requireDurationInRange(
    totals.months,
    totals.ms,
    { location, fn: 'duration' },
    'duration()'
  );
  return {
    __rill_duration: true,
    months: totals.months,
    ms: totals.ms,
  };
}

// ============================================================
// DATETIME FORMATTING HELPERS
// ============================================================

/** Pad a number to the given width with leading zeros */
function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Format a datetime year field, sign-aware. Years within 0-9999 keep the
 * plain unsigned 4-digit form used today. Negative years, and years >=
 * 10000, use the ISO 8601 extended year form (explicit sign + 6-digit
 * absolute value), matching how the JS Date extended year notation
 * round-trips through Date.parse.
 */
function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) {
    return padNum(year, 4);
  }
  const sign = year < 0 ? '-' : '+';
  return `${sign}${padNum(Math.abs(year), 6)}`;
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
  const shifted = new Date(utcMs + offsetHours * MS_PER_HOUR);
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

/**
 * Validate a UTC offset intended for ISO 8601 suffix formatting. The
 * suffix is a fixed `+HH:MM`/`-HH:MM` shape whose hour field must fit
 * 00-23; an offset of 24 hours or more (or non-finite) would otherwise
 * silently produce a malformed suffix like `+30:00` instead of halting.
 */
export function validateIsoOffset(
  offsetHours: number,
  location?: SourceLocation,
  fn = 'iso'
): number {
  // Validate against the rounded minute total that formatOffsetSuffix
  // actually formats, not the raw hour magnitude: an offset like 23.999
  // passes `< 24` but rounds to 1440 minutes, which formatOffsetSuffix
  // would render as the invalid "+24:00" suffix.
  const totalMinutes = Math.round(Math.abs(offsetHours) * 60);
  if (!Number.isFinite(offsetHours) || totalMinutes >= 24 * 60) {
    throwTypeHalt(
      { location, fn },
      'INVALID_INPUT',
      `Invalid timezone offset: ${offsetHours} hours (must be less than 24 in magnitude)`,
      'runtime',
      { offsetHours }
    );
  }
  return offsetHours;
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
    `${formatYear(p.y)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}` +
    `T${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}` +
    (p.ms > 0 ? `.${padNum(p.ms, 3)}` : '') +
    suffix
  );
}

/** Format as "YYYY-MM-DD" */
export function formatDate(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${formatYear(p.y)}-${padNum(p.mo, 2)}-${padNum(p.d, 2)}`;
}

/** Format as "HH:MM:SS" */
export function formatTime(utcMs: number, offsetHours: number): string {
  const p = applyOffset(utcMs, offsetHours);
  return `${padNum(p.h, 2)}:${padNum(p.mi, 2)}:${padNum(p.s, 2)}`;
}
