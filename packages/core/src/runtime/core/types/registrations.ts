/** @internal Type Registration Definitions */

import type { RillValue } from './structures.js';
import type { RillFunction } from '../callable.js';
import { RuntimeError } from '../../../types.js';
import { throwTypeHalt } from './halt.js';
import { initFormatNested, initDeepEquals } from './protocols/shared.js';
import type { TypeDefinition } from './protocols/types.js';
import {
  stringType,
  numberType,
  boolType,
  tupleType,
  orderedType,
  vectorType,
  datetimeType,
  durationType,
  atomType,
  typeType,
  closureType,
  fieldDescriptorType,
  streamType,
  iteratorType,
  listType,
  dictType,
} from './protocols/index.js';
import { ERROR_IDS } from '../../../error-registry.js';

export type { TypeProtocol, TypeDefinition } from './protocols/types.js';

/** All 16 built-in type registrations (NFR-TPC-1). dict is last (fallback). */
export const BUILT_IN_TYPES: readonly TypeDefinition[] = Object.freeze([
  stringType,
  numberType,
  boolType,
  tupleType,
  orderedType,
  vectorType,
  datetimeType,
  durationType,
  atomType,
  typeType,
  closureType,
  fieldDescriptorType,
  streamType,
  iteratorType,
  listType,
  dictType,
]);

/** Module-private identity dispatcher. Falls back only when no type identity matches. */
function dispatchByIdentity<T>(
  v: RillValue,
  fn: (reg: TypeDefinition) => T,
  fallback: T
): T {
  for (const reg of BUILT_IN_TYPES) {
    if (reg.identity(v)) {
      return fn(reg);
    }
  }
  return fallback;
}

/** Infer the Rill type name from a runtime value. Returns 'string' as fallback (BC-1). */
export function inferType(value: RillValue): string {
  return dispatchByIdentity(value, (reg) => reg.name, 'string');
}

/** Format a value as a human-readable string. */
export function formatValue(value: RillValue): string {
  return dispatchByIdentity(
    value,
    (reg) => reg.protocol.format(value),
    String(value)
  );
}
initFormatNested(formatValue);

// Cycle-detection for deepEquals. Tracks visited pairs (a, b) so that
// shared references on one side don't cause false positives when paired
// with different subtrees on the other. Only object pairs are tracked;
// primitives short-circuit on === above.
let _deepEqualsVisited: WeakMap<object, WeakSet<object>> | null = null;

/** Deep equality. Short-circuits on reference equality (EC-3, AC-18, AC-20). */
export function deepEquals(a: RillValue, b: RillValue): boolean {
  if (a === b) return true;
  const isRoot = _deepEqualsVisited === null;
  if (isRoot) _deepEqualsVisited = new WeakMap<object, WeakSet<object>>();
  const visited = _deepEqualsVisited!;
  const aObj = typeof a === 'object' && a !== null ? (a as object) : null;
  const bObj = typeof b === 'object' && b !== null ? (b as object) : null;
  if (aObj !== null && bObj !== null) {
    let partners = visited.get(aObj);
    if (partners?.has(bObj)) return true;
    if (!partners) {
      partners = new WeakSet<object>();
      visited.set(aObj, partners);
    }
    partners.add(bObj);
  }
  try {
    return dispatchByIdentity(
      a,
      (reg) => {
        if (!reg.protocol.eq) return false;
        return reg.protocol.eq(a, b);
      },
      false
    );
  } finally {
    if (isRoot) _deepEqualsVisited = null;
  }
}
initDeepEquals(deepEquals);

/** Serialize a Rill value for JSON transport. */
export function serializeValue(value: RillValue): unknown {
  return dispatchByIdentity<unknown>(
    value,
    (reg) => (reg.protocol.serialize ? reg.protocol.serialize(value) : value),
    value
  );
}

/** Deserialize raw data into a Rill value by type name. */
export function deserializeValue(data: unknown, typeName: string): RillValue {
  if (data === null || data === undefined) {
    throwTypeHalt(
      { fn: 'deserialize' },
      'INVALID_INPUT',
      `Cannot deserialize null as ${typeName}`,
      'runtime',
      { typeName }
    );
  }
  for (const reg of BUILT_IN_TYPES) {
    if (reg.name === typeName) {
      if (reg.protocol.deserialize) return reg.protocol.deserialize(data);
      return data as RillValue;
    }
  }
  throwTypeHalt(
    { fn: 'deserialize' },
    'INVALID_INPUT',
    `Cannot deserialize as ${typeName}`,
    'runtime',
    { typeName }
  );
}

/** Names of types that carry methods from BUILTIN_METHODS. */
const METHOD_BEARING_TYPES = new Set([
  'string',
  'number',
  'bool',
  'list',
  'dict',
  'vector',
  'datetime',
  'duration',
]);

/**
 * Populate registration `methods` fields from BUILTIN_METHODS.
 * Called after builtins.ts finishes initialization to avoid circular deps.
 */
export function populateBuiltinMethods(
  builtinMethods: Record<string, Record<string, RillFunction>>
): void {
  for (const typeName of METHOD_BEARING_TYPES) {
    if (!(typeName in builtinMethods)) continue;
    const reg = BUILT_IN_TYPES.find((r) => r.name === typeName);
    if (reg === undefined) continue;
    if (Object.isFrozen(reg)) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R068,
        `populateBuiltinMethods: registration '${reg.name}' is frozen; cannot assign methods`
      );
    }
    (reg as { methods: Record<string, RillFunction> }).methods =
      builtinMethods[typeName]!;
  }
}
