/**
 * The built-in `error_code` type: the closed set of error codes a halt or
 * `ctx.invalidate` may carry, written as a union of one atom literal per
 * code. `#ok` and `#IGNORE` are not members.
 *
 * Imports only leaf modules so the registrations and union modules can
 * depend on this one without a cycle.
 */

import { ERROR_CODE_NAMES } from '../../../constants.js';
import { resolveAtom, toAtomValue } from './atom-registry.js';
import { isAtom, isStructureKind } from './guards.js';
import type { TypeStructure } from './structures.js';
import { canonicalUnionMembers } from './union-order.js';

const ERROR_CODE_TYPE_NAME = 'error_code';

function atomLiteral(name: string): TypeStructure {
  return Object.freeze({
    kind: 'literal',
    value: Object.freeze(toAtomValue(resolveAtom(name))),
  });
}

/** Returns the error-code name of an atom literal member, else undefined. */
function literalAtomName(member: TypeStructure): string | undefined {
  if (!isStructureKind(member, 'literal')) return undefined;
  const value = member.value;
  return isAtom(value) ? value.atom.name : undefined;
}

const ERROR_CODE_MEMBERS: TypeStructure[] = ERROR_CODE_NAMES.map(atomLiteral);
Object.freeze(ERROR_CODE_MEMBERS);

/** Structure of `error_code`: a union of every error-code atom literal. */
export const ERROR_CODE_STRUCTURE: TypeStructure = Object.freeze({
  kind: 'union',
  members: ERROR_CODE_MEMBERS,
});

/**
 * Structure of the `.!code` probe: `union(#ok, error_code)` in the spliced
 * form union normalization produces (literal `#ok`, then each error code).
 */
export const STATUS_CODE_STRUCTURE: TypeStructure = Object.freeze({
  kind: 'union',
  members: Object.freeze([atomLiteral('ok'), ...ERROR_CODE_MEMBERS]),
});

/** Structure for a bare type name: `error_code` expands, others are `{ kind }`. */
export function bareTypeStructure(name: string): TypeStructure {
  return name === ERROR_CODE_TYPE_NAME ? ERROR_CODE_STRUCTURE : { kind: name };
}

/**
 * Format union members in canonical order, printing the literals of every
 * error code as the single word `error_code`, sorted as a type member.
 */
function formatMembers(
  members: readonly TypeStructure[],
  format: (member: TypeStructure) => string
): string[] {
  const present = new Set(members.map(literalAtomName));
  const collapse = ERROR_CODE_NAMES.every((name) => present.has(name));
  const marker: TypeStructure = { kind: ERROR_CODE_TYPE_NAME };
  const printed = (member: TypeStructure): string =>
    member === marker ? ERROR_CODE_TYPE_NAME : format(member);
  const kept: TypeStructure[] = [];
  let emitted = false;
  for (const member of members) {
    const name = literalAtomName(member);
    if (collapse && name !== undefined && ERROR_CODE_NAMES.includes(name)) {
      if (!emitted) kept.push(marker);
      emitted = true;
    } else {
      kept.push(member);
    }
  }
  return canonicalUnionMembers(kept, printed).map(printed);
}

/**
 * Format a union as `union(...)`, with the error-code literals collapsed to
 * the single word `error_code`; a union of only those literals prints as
 * bare `error_code`.
 */
export function formatUnion(
  members: readonly TypeStructure[],
  format: (member: TypeStructure) => string
): string {
  const parts = formatMembers(members, format);
  const [only] = parts;
  if (parts.length === 1 && only === ERROR_CODE_TYPE_NAME) return only;
  return `union(${parts.join(', ')})`;
}
