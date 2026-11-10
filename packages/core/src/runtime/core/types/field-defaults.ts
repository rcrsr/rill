/**
 * Rules and messages shared by every place that builds a structural type
 * with field defaults: script type constructors and host signature strings.
 * This module imports types only, so any layer can use it. The value check
 * itself is `defaultMismatch` in operations.ts.
 */

import type { RillFieldDef } from './structures.js';

/** Formatted type names of a default value that does not match its type. */
export interface DefaultMismatch {
  readonly expectedType: string;
  readonly actualType: string;
}

/** Message for a mismatched default. `subject` names what holds it, such as `field 'b'` or `tuple element`. */
export function defaultMismatchMessage(
  subject: string,
  mismatch: DefaultMismatch
): string {
  return `Default value for ${subject} must be ${mismatch.expectedType}, got ${mismatch.actualType}`;
}

/**
 * Tuple defaults must be trailing. Returns the position of the first element
 * that has no default but follows one that does, or -1 when the order is valid.
 */
export function nonTrailingDefaultIndex(
  elements: readonly RillFieldDef[]
): number {
  const firstDefault = elements.findIndex((e) => e.defaultValue !== undefined);
  if (firstDefault === -1) return -1;
  return elements.findIndex(
    (e, i) => i > firstDefault && e.defaultValue === undefined
  );
}

/** Message for a tuple whose defaults are not trailing. */
export function nonTrailingDefaultMessage(position: number): string {
  return `tuple() default values must be trailing: element at position ${position} has no default but a preceding element does`;
}
