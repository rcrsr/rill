/**
 * Field Descriptor Builder
 *
 * Constructs a frozen RillFieldDescriptor for a named field within a
 * RillType dict. Used during structural type field access to carry
 * field name and field type.
 *
 * @internal
 */

import type { SourceLocation } from '../../types.js';
import { RuntimeError } from '../../types.js';
import type { RillFieldDef, RillType } from './values.js';

/**
 * Field descriptor — carries field name and structural type when accessing a
 * dict-kind RillType field.
 */
export interface RillFieldDescriptor {
  readonly __rill_field_descriptor: true;
  readonly fieldName: string;
  readonly fieldType: RillFieldDef;
}

/**
 * Build a frozen RillFieldDescriptor for the given field in a structural dict type.
 *
 * EC-1: Throws RILL-R003 when fieldName is absent from structuralType.fields.
 */
export function buildFieldDescriptor(
  structuralType: RillType & { type: 'dict' },
  fieldName: string,
  location: SourceLocation
): RillFieldDescriptor {
  const fieldType = structuralType.fields?.[fieldName];
  if (fieldType === undefined) {
    throw new RuntimeError(
      'RILL-R003',
      `Shape has no field "${fieldName}"`,
      location
    );
  }
  return Object.freeze({
    __rill_field_descriptor: true as const,
    fieldName,
    fieldType,
  });
}
