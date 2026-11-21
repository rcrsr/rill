/**
 * Map Protocol Module
 *
 * TypeDefinition for the 'map' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isMap, mapKeyId } from '../guards.js';
import { isReservedDictKey, setDictField } from '../dict-keys.js';
import { throwCatchableHostHalt } from '../halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import {
  formatNested,
  compareByDeepEquals,
  throwNotSerializable,
  requireReceiver,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatMap(v: RillValue): string {
  const m = isMap(v)
    ? v
    : requireReceiver(v, isMap, { fn: 'format-map' }, 'map');
  const parts = m.entries.map(
    ([key, val]) => `${formatNested(key)}: ${formatNested(val)}`
  );
  return `map[${parts.join(', ')}]`;
}

// ============================================================
// EQ
// ============================================================

/** Equal when both hold the same keys with deep-equal values, in any order. */
function eqMap(a: RillValue, b: RillValue): boolean {
  if (!isMap(a) || !isMap(b)) return false;
  if (a.entries.length !== b.entries.length) return false;
  const bByKey = new Map<string, RillValue>();
  for (const [key, val] of b.entries) bByKey.set(mapKeyId(key), val);
  for (const [key, val] of a.entries) {
    const other = bByKey.get(mapKeyId(key));
    if (other === undefined || !compareByDeepEquals(val, other)) return false;
  }
  return true;
}

// ============================================================
// CONVERT-TO
// ============================================================

function refuseDictKey(detail: string): never {
  return throwCatchableHostHalt(
    { fn: 'convert-map-to-dict' },
    ERROR_ATOMS[ERROR_IDS.RILL_R036],
    `cannot convert map to dict: ${detail}`,
    { source: 'map', target: 'dict' }
  );
}

/**
 * A string-keyed map converts to a dict; no other key converts implicitly,
 * and a key a dict cannot hold (a dict method or brand name) is refused.
 */
function mapToDict(v: RillValue): RillValue {
  const m = isMap(v)
    ? v
    : requireReceiver(v, isMap, { fn: 'convert-map-to-dict' }, 'map');
  const result: Record<string, RillValue> = {};
  for (const [key, val] of m.entries) {
    if (typeof key !== 'string') {
      refuseDictKey('map keys are not strings');
    }
    if (isReservedDictKey(key)) {
      refuseDictKey(`key "${key}" is reserved`);
    }
    setDictField(result, key, val);
  }
  return result;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const mapType: TypeDefinition = {
  name: 'map',
  identity: (v: RillValue): boolean => isMap(v),
  isLeaf: false,
  immutable: true,
  methods: {},
  protocol: {
    format: formatMap,
    eq: eqMap,
    convertTo: {
      string: (v: RillValue): RillValue => formatMap(v),
      dict: mapToDict,
    },
    serialize: throwNotSerializable('map'),
  },
};
