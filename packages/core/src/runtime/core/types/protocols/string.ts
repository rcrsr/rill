/**
 * String Type Protocol Module
 *
 * Defines the TypeDefinition for the 'string' primitive type.
 * Includes null identity: typeof null !== 'string', but rill's type system
 * treats null as the string type.
 *
 * Must NOT import from ../registrations.js.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isValidAtomName, resolveAtom, toAtomValue } from '../atom-registry.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { throwFatalHostHalt, throwTypeHalt } from '../halt.js';
import { requireReceiver } from './shared.js';

// ============================================================
// RECEIVER GUARDS
// ============================================================

function isStringValue(v: RillValue): v is string {
  return typeof v === 'string';
}

/**
 * Narrow a convertTo receiver to its text. The `null` identity of the string
 * type renders as the text "null", matching how a null receiver coerces.
 */
function receiverText(v: RillValue, fn: string): string {
  if (typeof v === 'string') return v;
  if (v === null) return 'null';
  return requireReceiver(v, isStringValue, { fn }, 'string');
}

// ============================================================
// FORMAT
// ============================================================

function formatString(v: RillValue): string {
  if (v === null) return 'type(null)';
  return typeof v === 'string'
    ? v
    : requireReceiver(v, isStringValue, { fn: 'format-string' }, 'string');
}

// ============================================================
// EQ
// ============================================================

function eqString(a: RillValue, b: RillValue): boolean {
  return a === b;
}

// ============================================================
// COMPARE
// ============================================================

/**
 * Ordering when a side is the `null` identity of the string type: the null
 * side counts as 0 and the string side coerces to a number, so a non-numeric
 * string orders as equal.
 */
function compareWithNull(a: RillValue, b: RillValue): number {
  const na = a === null ? 0 : Number(receiverText(a, 'compare-string'));
  const nb = b === null ? 0 : Number(receiverText(b, 'compare-string'));
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

function compareString(a: RillValue, b: RillValue): number {
  if (a === null || b === null) return compareWithNull(a, b);
  const sa = isStringValue(a)
    ? a
    : requireReceiver(
        a,
        isStringValue,
        { fn: 'compare-string' },
        'string',
        'left operand'
      );
  const sb = isStringValue(b)
    ? b
    : requireReceiver(
        b,
        isStringValue,
        { fn: 'compare-string' },
        'string',
        'right operand'
      );
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

// ============================================================
// CONVERT-TO
// ============================================================

const stringConvertTo: Record<string, (v: RillValue) => RillValue> = {
  number: (v: RillValue): RillValue => {
    const str = receiverText(v, 'string-to-number');
    // Only clean decimal / float strings convert: optional leading minus,
    // integer or fractional digits, optional scientific-notation exponent.
    // This rejects hex/octal/binary prefixes (0x, 0o, 0b), surrounding
    // whitespace, and the bare "NaN" word that Number() would otherwise
    // silently accept. "Infinity"/"-Infinity" are rejected by the same
    // guard: rill numbers are always finite.
    const DECIMAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    if (!DECIMAL.test(str)) {
      const message = `cannot convert string "${str}" to number`;
      throwFatalHostHalt(
        { fn: 'string-to-number', preserveHostShape: true },
        ERROR_ATOMS[ERROR_IDS.RILL_R064],
        message
      );
    }
    const result = Number(str);
    // The DECIMAL guard above rejects the literal "Infinity"/"-Infinity",
    // but an overflow string like "1e309" still matches it and evaluates
    // to Infinity under Number(), so finiteness must be checked after
    // conversion too — rill numbers are always finite.
    if (!Number.isFinite(result)) {
      throwTypeHalt(
        { fn: 'string-to-number' },
        'INVALID_INPUT',
        `cannot convert string "${str}" to number: result is not finite`,
        'runtime'
      );
    }
    return result;
  },
  bool: (v: RillValue): RillValue => {
    const s = receiverText(v, 'string-to-bool');
    if (s === 'true') return true;
    if (s === 'false') return false;
    const message = `cannot convert string "${s}" to bool`;
    return throwFatalHostHalt(
      { fn: 'string-to-bool', preserveHostShape: true },
      ERROR_ATOMS[ERROR_IDS.RILL_R065],
      message
    );
  },
  atom: (v: RillValue): RillValue => {
    const s = receiverText(v, 'string-to-atom');
    if (!isValidAtomName(s)) {
      throwTypeHalt(
        { fn: 'string-to-atom' },
        'INVALID_INPUT',
        `cannot convert string "${s}" to atom: not a valid atom name`,
        'runtime'
      );
    }
    return toAtomValue(resolveAtom(s));
  },
};

// ============================================================
// SERIALIZE
// ============================================================

function serializeString(v: RillValue): unknown {
  if (v === null) return null;
  return v;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const stringType: TypeDefinition = {
  name: 'string',
  identity: (v: RillValue): boolean => typeof v === 'string' || v === null,
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatString,
    eq: eqString,
    compare: compareString,
    convertTo: stringConvertTo,
    serialize: serializeString,
  },
};
