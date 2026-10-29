/**
 * Test helpers for narrowing TypeStructure and RillTypeValue results.
 *
 * TypeStructure carries a catch-all `{ kind: string }` member, so comparing
 * `kind` alone does not narrow the union. These guards do.
 */

import {
  isTypeValue,
  type RillTypeValue,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';

type ClosureStructure = Extract<TypeStructure, { kind: 'closure' }>;
type OrderedStructure = Extract<TypeStructure, { kind: 'ordered' }>;

/** Narrow a structure to the closure variant. */
export function isClosureStructure(
  structure: TypeStructure
): structure is ClosureStructure {
  return structure.kind === 'closure';
}

/** Narrow a structure to the ordered variant. */
function isOrderedStructure(
  structure: TypeStructure
): structure is OrderedStructure {
  return structure.kind === 'ordered';
}

/** Assert that a value is a type value and return it narrowed. */
export function expectTypeValue(value: RillValue): RillTypeValue {
  if (!isTypeValue(value)) {
    throw new Error('expected a type value');
  }
  return value;
}

/** Assert that a type value holds an ordered structure and return it. */
export function expectOrderedStructure(value: RillValue): OrderedStructure {
  const structure = expectTypeValue(value).structure;
  if (!isOrderedStructure(structure)) {
    throw new Error(`expected an ordered structure, got ${structure.kind}`);
  }
  return structure;
}
