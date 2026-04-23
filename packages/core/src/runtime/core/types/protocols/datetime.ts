/**
 * Datetime Protocol Module
 *
 * TypeDefinition for the 'datetime' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../halt.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillDatetime } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isDatetime } from '../guards.js';
import { throwTypeHalt } from '../halt.js';

// ============================================================
// FORMAT
// ============================================================

function formatDatetime(v: RillValue): string {
  const dt = v as unknown as RillDatetime;
  return new Date(dt.unix).toISOString();
}

// ============================================================
// EQ
// ============================================================

function eqDatetime(a: RillValue, b: RillValue): boolean {
  if (!isDatetime(a) || !isDatetime(b)) return false;
  return a.unix === b.unix;
}

// ============================================================
// COMPARE
// ============================================================

function compareDatetime(a: RillValue, b: RillValue): number {
  const da = (a as unknown as RillDatetime).unix;
  const db = (b as unknown as RillDatetime).unix;
  return da - db;
}

// ============================================================
// SERIALIZE / DESERIALIZE
// ============================================================

/** Serialize datetime as ISO 8601 string with milliseconds. */
function serializeDatetime(v: RillValue): unknown {
  const dt = v as unknown as RillDatetime;
  return new Date(dt.unix).toISOString();
}

/**
 * Deserialize ISO 8601 string to RillDatetime.
 * Accepts a string, parses via Date constructor.
 */
function deserializeDatetime(data: unknown): RillValue {
  if (typeof data !== 'string') {
    throwTypeHalt(
      { fn: 'deserialize-datetime' },
      'INVALID_INPUT',
      `Cannot deserialize ${typeof data} as datetime, expected ISO 8601 string`,
      'runtime',
      { actualType: typeof data }
    );
  }
  const ms = Date.parse(data);
  if (isNaN(ms)) {
    throwTypeHalt(
      { fn: 'deserialize-datetime' },
      'INVALID_INPUT',
      `Cannot deserialize invalid ISO 8601 string as datetime: ${data}`,
      'runtime'
    );
  }
  return { __rill_datetime: true, unix: ms } as unknown as RillValue;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const datetimeType: TypeDefinition = {
  name: 'datetime',
  identity: (v: RillValue): boolean => isDatetime(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatDatetime,
    eq: eqDatetime,
    compare: compareDatetime,
    serialize: serializeDatetime,
    deserialize: deserializeDatetime,
  },
};
