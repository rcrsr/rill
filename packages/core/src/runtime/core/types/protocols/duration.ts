/**
 * Duration Protocol Module
 *
 * TypeDefinition for the 'duration' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isDuration } from '../guards.js';
import { throwTypeHalt, throwCatchableHostHalt } from '../halt.js';
import { requireDuration } from './shared.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

// ============================================================
// FORMAT
// ============================================================

/**
 * Format a duration as a compact display string.
 * Omits zero components. Zero duration = "0ms".
 *
 * Calendar decomposition: years = floor(months / 12), remaining months.
 * Clock decomposition: days, hours, minutes, seconds, ms from the ms field.
 */
function formatDuration(v: RillValue): string {
  const dur = isDuration(v) ? v : requireDuration(v, { fn: 'format-duration' });
  const parts: string[] = [];

  // Calendar components
  const years = Math.floor(dur.months / 12);
  const remainingMonths = dur.months % 12;
  if (years > 0) parts.push(`${years}y`);
  if (remainingMonths > 0) parts.push(`${remainingMonths}mo`);

  // Clock components: decompose ms field
  let remainder = dur.ms;
  const days = Math.floor(remainder / 86400000);
  remainder -= days * 86400000;
  const hours = Math.floor(remainder / 3600000);
  remainder -= hours * 3600000;
  const minutes = Math.floor(remainder / 60000);
  remainder -= minutes * 60000;
  const seconds = Math.floor(remainder / 1000);
  remainder -= seconds * 1000;

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (remainder > 0) parts.push(`${remainder}ms`);

  return parts.length === 0 ? '0ms' : parts.join('');
}

// ============================================================
// EQ
// ============================================================

function eqDuration(a: RillValue, b: RillValue): boolean {
  if (!isDuration(a) || !isDuration(b)) return false;
  return a.months === b.months && a.ms === b.ms;
}

// ============================================================
// COMPARE
// ============================================================

/**
 * Three-way comparison for durations.
 * Defined when the two durations agree in direction: one is >= the other in
 * BOTH the months and ms components. Equal durations (both components equal)
 * compare as zero.
 * When the components disagree (one has more months, the other more ms), the
 * order depends on the length of a month, so we halt with RILL-R002.
 * The agreement rule is sound for any month length: a month is a nonnegative
 * number of milliseconds, so a duration that is >= in both components is >= in
 * total regardless of what length a month takes. This is not lexicographic
 * ordering, which would rank 1 month above 40 days.
 */
function compareDuration(a: RillValue, b: RillValue): number {
  const da = isDuration(a)
    ? a
    : requireDuration(a, { fn: 'compare-duration' }, 'left operand');
  const db = isDuration(b)
    ? b
    : requireDuration(b, { fn: 'compare-duration' }, 'right operand');
  const monthsDiff = da.months - db.months;
  const msDiff = da.ms - db.ms;
  if ((monthsDiff > 0 && msDiff < 0) || (monthsDiff < 0 && msDiff > 0)) {
    const message = 'Cannot order durations with different calendar components';
    throwCatchableHostHalt(
      { fn: 'compare-duration', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      message
    );
  }
  return msDiff !== 0 ? msDiff : monthsDiff;
}

// ============================================================
// SERIALIZE / DESERIALIZE
// ============================================================

/**
 * Serialize duration.
 * Fixed durations (months=0): ms number.
 * Calendar durations (months>0): {months, ms} object.
 */
function serializeDuration(v: RillValue): unknown {
  const dur = isDuration(v)
    ? v
    : requireDuration(v, { fn: 'serialize-duration' });
  if (dur.months === 0) return dur.ms;
  return { months: dur.months, ms: dur.ms };
}

/**
 * Deserialize duration from number (ms) or {months, ms} object.
 */
function deserializeDuration(data: unknown): RillValue {
  if (typeof data === 'number') {
    return {
      __rill_duration: true,
      months: 0,
      ms: data,
    };
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'months' in data &&
    'ms' in data
  ) {
    const obj = data;
    if (typeof obj.months !== 'number' || typeof obj.ms !== 'number') {
      throwTypeHalt(
        { fn: 'deserialize-duration' },
        'INVALID_INPUT',
        'Cannot deserialize duration: months and ms must be numbers',
        'runtime'
      );
    }
    return {
      __rill_duration: true,
      months: obj.months,
      ms: obj.ms,
    };
  }
  return throwTypeHalt(
    { fn: 'deserialize-duration' },
    'INVALID_INPUT',
    `Cannot deserialize ${typeof data} as duration, expected number or {months, ms}`,
    'runtime',
    { actualType: typeof data }
  );
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const durationType: TypeDefinition = {
  name: 'duration',
  identity: (v: RillValue): boolean => isDuration(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatDuration,
    eq: eqDuration,
    compare: compareDuration,
    serialize: serializeDuration,
    deserialize: deserializeDuration,
  },
};
