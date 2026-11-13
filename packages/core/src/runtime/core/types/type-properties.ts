/**
 * Type Value Properties
 *
 * The properties a type value exposes to scripts: `name` and `signature` on
 * every kind, `inner` on compound kinds, `outer` on computing kinds and
 * `defaults` on kinds with defaulted fields. Presence depends on the kind of
 * the type only, so `.?p` is true exactly when `.p` does not halt.
 *
 * @internal
 */

import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';
import { atomName } from './atom-registry.js';
import { createOrdered, createTuple } from './constructors.js';
import { setDictField } from './dict-keys.js';
import { isStructureKind } from './guards.js';
import { throwCatchableHostHalt, RuntimeHaltSignal } from './halt.js';
import type { TypeHaltSite } from './halt.js';
import { formatStructure } from './operations.js';
import { getStatus } from './status.js';
import type {
  RillFieldDef,
  RillTypeValue,
  RillValue,
  TypeStructure,
} from './structures.js';
import { canonicalUnionMembers } from './union-order.js';
import { anyTypeValue, structureToTypeValue } from '../values.js';

// ============================================================
// TYPES
// ============================================================

const MISSING_MARKER = 'missingTypeProperty';

const INNER_KINDS: ReadonlySet<string> = new Set([
  'list',
  'dict',
  'ordered',
  'tuple',
  'union',
  'closure',
  'stream',
]);
const OUTER_KINDS: ReadonlySet<string> = new Set(['closure', 'stream']);
const DEFAULTS_KINDS: ReadonlySet<string> = new Set([
  'dict',
  'ordered',
  'closure',
]);

// ============================================================
// PRESENCE
// ============================================================

/** True when the type value defines the property, by kind alone. */
function hasTypeProperty(type: RillTypeValue, name: string): boolean {
  const kind = type.structure.kind;
  switch (name) {
    case 'name':
    case 'signature':
      return true;
    case 'inner':
      return INNER_KINDS.has(kind);
    case 'outer':
      return OUTER_KINDS.has(kind);
    case 'defaults':
      return DEFAULTS_KINDS.has(kind);
    default:
      return false;
  }
}

// ============================================================
// READ
// ============================================================

function typeOrAny(type: TypeStructure | undefined): RillTypeValue {
  return type === undefined ? anyTypeValue : structureToTypeValue(type);
}

function typeDict(
  entries: readonly (readonly [string, TypeStructure])[]
): RillValue {
  const out: Record<string, RillValue> = {};
  for (const [key, type] of entries) {
    setDictField(out, key, structureToTypeValue(type));
  }
  return out;
}

function fieldName(field: RillFieldDef, index: number): string {
  return field.name ?? String(index);
}

function dictInner(type: Extract<TypeStructure, { kind: 'dict' }>): RillValue {
  if (type.valueType !== undefined) return typeOrAny(type.valueType);
  if (type.fields === undefined) return anyTypeValue;
  return typeDict(
    Object.entries(type.fields).map(([key, f]) => [key, f.type] as const)
  );
}

function orderedInner(
  type: Extract<TypeStructure, { kind: 'ordered' }>
): RillValue {
  if (type.valueType !== undefined) return typeOrAny(type.valueType);
  if (type.fields === undefined) return anyTypeValue;
  return createOrdered(
    type.fields.map((f, i): [string, RillValue] => [
      fieldName(f, i),
      structureToTypeValue(f.type),
    ])
  );
}

function tupleInner(
  type: Extract<TypeStructure, { kind: 'tuple' }>
): RillValue {
  if (type.valueType !== undefined) {
    return createTuple([structureToTypeValue(type.valueType)]);
  }
  if (type.elements === undefined) return anyTypeValue;
  return createTuple(type.elements.map((e) => structureToTypeValue(e.type)));
}

function unionInner(
  type: Extract<TypeStructure, { kind: 'union' }>
): RillValue {
  const ordered = canonicalUnionMembers(type.members, formatStructure);
  return ordered.map((member): RillValue => {
    if (isStructureKind(member, 'literal')) {
      return member.value;
    }
    return structureToTypeValue(member);
  });
}

function closureInner(
  type: Extract<TypeStructure, { kind: 'closure' }>
): RillValue {
  if (type.params === undefined) return anyTypeValue;
  return createOrdered(
    type.params.map((f, i): [string, RillValue] => [
      fieldName(f, i),
      structureToTypeValue(f.type),
    ])
  );
}

function readInner(structure: TypeStructure): RillValue {
  if (isStructureKind(structure, 'list')) return typeOrAny(structure.element);
  if (isStructureKind(structure, 'dict')) return dictInner(structure);
  if (isStructureKind(structure, 'ordered')) return orderedInner(structure);
  if (isStructureKind(structure, 'tuple')) return tupleInner(structure);
  if (isStructureKind(structure, 'union')) return unionInner(structure);
  if (isStructureKind(structure, 'closure')) return closureInner(structure);
  // Stream: the chunk type; any other inner-bearing kind never reaches here.
  return typeOrAny(
    isStructureKind(structure, 'stream') ? structure.chunk : undefined
  );
}

function defaultsOf(
  entries: readonly (readonly [string, RillFieldDef])[]
): RillValue {
  const out: Record<string, RillValue> = {};
  for (const [key, field] of entries) {
    if (field.defaultValue !== undefined) {
      setDictField(out, key, field.defaultValue);
    }
  }
  return out;
}

function readDefaults(structure: TypeStructure): RillValue {
  if (isStructureKind(structure, 'dict')) {
    return defaultsOf(Object.entries(structure.fields ?? {}));
  }
  if (isStructureKind(structure, 'ordered')) {
    return defaultsOf(
      (structure.fields ?? []).map((f, i) => [fieldName(f, i), f] as const)
    );
  }
  if (isStructureKind(structure, 'closure')) {
    return defaultsOf(
      (structure.params ?? []).map((f, i) => [fieldName(f, i), f] as const)
    );
  }
  return {};
}

/**
 * Read a property of a type value. Returns undefined when the type does not
 * define it.
 */
export function readTypeProperty(
  type: RillTypeValue,
  name: string
): RillValue | undefined {
  if (!hasTypeProperty(type, name)) return undefined;
  const structure = type.structure;
  switch (name) {
    case 'name':
      return type.typeName;
    case 'signature':
      return formatStructure(structure);
    case 'inner':
      return readInner(structure);
    case 'outer': {
      const ret = isStructureKind(structure, 'stream')
        ? structure.ret
        : isStructureKind(structure, 'closure')
          ? structure.ret
          : undefined;
      return typeOrAny(ret);
    }
    default:
      return readDefaults(structure);
  }
}

// ============================================================
// MISSING PROPERTY
// ============================================================

/**
 * Halt catchably with RILL-R003 for a property the type does not define.
 * Several names report an alternative access where none of them exist.
 */
export function throwMissingTypeProperty(
  site: TypeHaltSite,
  type: RillTypeValue,
  names: string | readonly string[]
): never {
  const typeLabel = formatStructure(type.structure);
  if (typeof names === 'string') {
    return throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `Type value has no property "${names}" (type: ${typeLabel})`,
      { [MISSING_MARKER]: true, property: names }
    );
  }
  return throwCatchableHostHalt(
    site,
    ERROR_ATOMS[ERROR_IDS.RILL_R003],
    `Type value has none of the properties ${names.map((n) => `"${n}"`).join(', ')} (type: ${typeLabel})`,
    { [MISSING_MARKER]: true, properties: [...names] }
  );
}

/** True when `error` is the halt `throwMissingTypeProperty` raises. */
export function isMissingTypePropertyHalt(error: unknown): boolean {
  if (!(error instanceof RuntimeHaltSignal)) return false;
  const status = getStatus(error.value);
  return (
    atomName(status.code) === ERROR_ATOMS[ERROR_IDS.RILL_R003] &&
    status.raw[MISSING_MARKER] === true
  );
}
