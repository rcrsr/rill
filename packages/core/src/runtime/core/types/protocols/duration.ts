/**
 * Duration Protocol Module
 *
 * TypeDefinition for the 'duration' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillDuration } from '../structures.js';
import type { TypeDefinition } from '../registrations.js';
import { isDuration } from '../guards.js';
import { throwTypeHalt } from '../halt.js';
import { RuntimeError } from '../../../../types.js';

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
  const dur = v as unknown as RillDuration;
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
 * Only defined when both durations have equal months fields.
 * When months differ, ordering is ambiguous (month length varies),
 * so we halt with RILL-R002.
 */
function compareDuration(a: RillValue, b: RillValue): number {
  const da = a as unknown as RillDuration;
  const db = b as unknown as RillDuration;
  if (da.months !== db.months) {
    throw new RuntimeError(
      'RILL-R002',
      'Cannot order durations with different calendar components'
    );
  }
  return da.ms - db.ms;
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
  const dur = v as unknown as RillDuration;
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
    } as unknown as RillValue;
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'months' in data &&
    'ms' in data
  ) {
    const obj = data as { months: unknown; ms: unknown };
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
    } as unknown as RillValue;
  }
  throwTypeHalt(
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
