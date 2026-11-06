/** @internal Type Registration Definitions */

import type { RillValue } from './structures.js';
import type { RillFunction } from '../callable.js';
import { RuntimeError } from '../../../types.js';
import { throwTypeHalt } from './halt.js';
import { isRillTypeName, type RillTypeName } from '../../../value-types.js';
import {
  initFormatNested,
  initDeepEquals,
  initCompareValue,
  initInferElementType,
} from './protocols/shared.js';
import { inferElementType } from './operations.js';
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

/** All 16 built-in type registrations. dict is last (fallback). */
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

/** Infer the Rill type name from a runtime value. Returns 'string' as fallback. */
export function inferType(value: RillValue): string {
  return dispatchByIdentity(value, (reg) => reg.name, 'string');
}

/**
 * Internal: `inferType` typed as RillTypeName. A host-built field descriptor
 * infers as `field_descriptor`, which is outside the closed RillTypeName set,
 * and callers pass it through unchanged.
 */
export function inferTypeName(value: RillValue): RillTypeName {
  const name = inferType(value);
  if (isRillTypeName(name)) return name;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- field_descriptor is a host-built value outside the closed RillTypeName set and callers rely on it passing through unchanged
  return name as RillTypeName;
}

/** Format a value as a human-readable string. */
export function formatValue(value: RillValue): string {
  return dispatchByIdentity(
    value,
    (reg) => reg.protocol.format(value),
    // A raw JS function stringifies to its source text; render an opaque label.
    // oxlint-disable-next-line typescript/no-base-to-string -- every non-function RillValue that reaches this fallback is a primitive or has a registered protocol
    typeof value === 'function' ? '[host function]' : String(value)
  );
}
initFormatNested(formatValue);

// Cycle-detection for deepEquals. Tracks visited pairs (a, b) so that
// shared references on one side don't cause false positives when paired
// with different subtrees on the other. Only object pairs are tracked;
// primitives short-circuit on === above.
let _deepEqualsVisited: WeakMap<object, WeakSet<object>> | null = null;

/** Deep equality. Short-circuits on reference equality. */
export function deepEquals(a: RillValue, b: RillValue): boolean {
  if (a === b) return true;
  let visited = _deepEqualsVisited;
  const isRoot = visited === null;
  if (visited === null) {
    visited = new WeakMap<object, WeakSet<object>>();
    _deepEqualsVisited = visited;
  }
  const aObj = typeof a === 'object' && a !== null ? (a as object) : null;
  const bObj = typeof b === 'object' && b !== null ? (b as object) : null;
  if (aObj !== null && bObj !== null) {
    let partners = visited.get(aObj);
    if (partners?.has(bObj) === true) return true;
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

/**
 * Compare two Rill values using their type protocol.
 * Returns a number (negative/zero/positive) when both values share the same
 * type and that type defines a compare protocol. Returns undefined when the
 * types differ or the type has no compare protocol.
 */
function compareValue(a: RillValue, b: RillValue): number | undefined {
  const typeName = inferType(a);
  const rightTypeName = inferType(b);
  if (typeName !== rightTypeName) return undefined;
  return dispatchByIdentity(
    a,
    (reg) => (reg.protocol.compare ? reg.protocol.compare(a, b) : undefined),
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the required fallback parameter is typed T and undefined is the intended "no ordering" value
    undefined
  );
}
initCompareValue(compareValue);
initInferElementType(inferElementType);

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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- public host boundary: data is unknown and types without a deserialize protocol pass it through unchanged
      return data as RillValue;
    }
  }
  return throwTypeHalt(
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
  'tuple',
  'ordered',
]);

/**
 * Populate registration `methods` fields from BUILTIN_METHODS.
 * Called after builtins.ts finishes initialization to avoid circular deps.
 */
export function populateBuiltinMethods(
  builtinMethods: Record<string, Record<string, RillFunction>>
): void {
  for (const [typeName, methods] of Object.entries(builtinMethods)) {
    if (!METHOD_BEARING_TYPES.has(typeName)) continue;
    const reg = BUILT_IN_TYPES.find((r) => r.name === typeName);
    if (reg === undefined) continue;
    if (Object.isFrozen(reg)) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R068,
        `populateBuiltinMethods: registration '${reg.name}' is frozen; cannot assign methods`
      );
    }
    (reg as { methods: Record<string, RillFunction> }).methods = methods;
  }
}
