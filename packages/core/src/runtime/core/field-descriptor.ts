/**
 * Field Descriptor Builder
 *
 * Constructs a frozen RillShapeFieldDescriptor for a named field within a shape.
 * Used during shape field access to carry field name and spec.
 *
 * @internal
 */

import type { SourceLocation } from '../../types.js';
import { RuntimeError } from '../../types.js';
import type { RillShape, RillShapeFieldDescriptor } from './values.js';

/**
 * Build a frozen RillShapeFieldDescriptor for the given field in a shape.
 *
 * EC-1: Throws RILL-R003 when fieldName is absent from shape.fields.
 */
export function buildFieldDescriptor(
  shape: RillShape,
  fieldName: string,
  location: SourceLocation
): RillShapeFieldDescriptor {
  const spec = shape.fields[fieldName];
  if (spec === undefined) {
    throw new RuntimeError(
      'RILL-R003',
      `Shape has no field "${fieldName}"`,
      location
    );
  }
  return Object.freeze({
    __rill_field_descriptor: true as const,
    fieldName,
    spec,
  });
}
