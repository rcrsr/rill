/**
 * Registration-time check of field defaults nested inside host function
 * types: dict, ordered, tuple, fn, and collection element types, at any depth.
 * Uses the same value check and message as script type constructors.
 */

import type { RillFieldDef, TypeStructure } from './structures.js';
import { defaultMismatchMessage } from './field-defaults.js';
import { isStructureKind } from './guards.js';
import { defaultMismatch } from './operations.js';

function fieldFault(field: RillFieldDef, subject: string): string | undefined {
  if (field.defaultValue !== undefined) {
    const mismatch = defaultMismatch(field.defaultValue, field.type);
    if (mismatch !== null) return defaultMismatchMessage(subject, mismatch);
  }
  return nestedDefaultFault(field.type);
}

function firstFault(
  fields: readonly RillFieldDef[],
  subject: (field: RillFieldDef) => string
): string | undefined {
  for (const field of fields) {
    const fault = fieldFault(field, subject(field));
    if (fault !== undefined) return fault;
  }
  return undefined;
}

function firstTypeFault(
  types: readonly (TypeStructure | undefined)[]
): string | undefined {
  for (const type of types) {
    if (type === undefined) continue;
    const fault = nestedDefaultFault(type);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/**
 * Find the first field default nested inside a type whose value does not
 * match its field type. Returns the message, or undefined when all match.
 */
export function nestedDefaultFault(type: TypeStructure): string | undefined {
  if (isStructureKind(type, 'dict')) {
    return firstFault(
      Object.entries(type.fields ?? {}).map(([key, field]) => ({
        ...field,
        name: key,
      })),
      (field) => `field '${field.name ?? ''}'`
    );
  }
  if (isStructureKind(type, 'ordered')) {
    return firstFault(type.fields ?? [], (f) => `field '${f.name ?? ''}'`);
  }
  if (isStructureKind(type, 'tuple')) {
    return firstFault(type.elements ?? [], () => 'tuple element');
  }
  if (isStructureKind(type, 'fn')) {
    return (
      firstFault(type.params ?? [], (p) => `parameter '${p.name ?? ''}'`) ??
      firstTypeFault([type.ret])
    );
  }
  if (isStructureKind(type, 'list')) return firstTypeFault([type.element]);
  if (isStructureKind(type, 'union')) return firstTypeFault(type.members ?? []);
  if (isStructureKind(type, 'map')) {
    return firstTypeFault([type.key, type.value]);
  }
  if (isStructureKind(type, 'stream')) {
    return firstTypeFault([type.chunk, type.ret]);
  }
  return undefined;
}
