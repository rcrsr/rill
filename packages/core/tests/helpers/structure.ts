/**
 * Test helpers for narrowing TypeStructure and RillTypeValue results.
 *
 * TypeStructure carries a catch-all `{ kind: string }` member, so comparing
 * `kind` alone does not narrow the union. These guards do.
 */

import {
  anyTypeValue,
  isTypeValue,
  type ApplicationCallable,
  type RillTypeValue,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';

type ClosureStructure = Extract<TypeStructure, { kind: 'closure' }>;

/** Narrow a structure to the closure variant. */
export function isClosureStructure(
  structure: TypeStructure
): structure is ClosureStructure {
  return structure.kind === 'closure';
}

/** Assert that a value is a type value and return it narrowed. */
export function expectTypeValue(value: RillValue): RillTypeValue {
  if (!isTypeValue(value)) {
    throw new Error('expected a type value');
  }
  return value;
}

/** Assert that a type value holds an ordered structure and return it. */
export function expectClosureStructure(value: RillValue): ClosureStructure {
  const structure = expectTypeValue(value).structure;
  if (!isClosureStructure(structure)) {
    throw new Error(`expected a closure structure, got ${structure.kind}`);
  }
  return structure;
}

/** Fill the neutral `annotations` and `returnType` fields of a host callable literal. */
export function createHostCallable(
  definition: Omit<ApplicationCallable, 'annotations' | 'returnType'>
): ApplicationCallable {
  return { ...definition, annotations: {}, returnType: anyTypeValue };
}
