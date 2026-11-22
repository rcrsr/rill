/**
 * Type Assertions and Checks
 *
 * Handles type assertion (:type) and type check (:?type) operations.
 * Provides runtime type validation with error reporting.
 *
 * Interface requirements (from spec):
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertionCarried(node, input) -> Promise<Carried>
 * - assertTypeRefCarried(s, typeRef, location, input) -> Promise<Carried>
 * - evaluateTypeCheck(node, value) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue>
 * - evaluateFnType(s, node) -> Promise<RillTypeValue>
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue>
 *
 * Error Handling:
 * - Type assertion failures halt with #TYPE_MISMATCH
 * - Type constructor argument errors halt via the halt builders (#INVALID_INPUT,
 *   #TYPE_MISMATCH, or RILL-R002 for reserved brand keys)
 * - fn type errors halt via the halt builders (a default that does not match
 *   its declared type halts with #TYPE_MISMATCH)
 *
 * @internal
 */

import type {
  TypeAssertionNode,
  TypeCheckNode,
  TypeConstructorNode,
  DeclarationNode,
  FnTypeNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
} from '../../../../types.js';
import type {
  RillValue,
  RillTypeValue,
  TypeStructure,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isAtom, isStructureKind, isTypeValue } from '../../types/guards.js';
import {
  structureEquals,
  structureMatches,
  inferStructure,
  formatStructure,
  formatRillLiteral,
} from '../../types/operations.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
} from '../../types/halt.js';
import {
  convertTypeRef,
  type TypeRefEnv,
  type TypeRefFault,
} from '../../types/type-ref.js';
import { checkType } from '../../values.js';
import { getVariable } from '../../context.js';
import { declarationOf, type Carried } from '../../types/declared.js';
import type { EvalState } from '../state.js';
import { evaluateAnnotations } from './annotations.js';
import { evaluatePrimary } from './core.js';

/** Surface a conversion fault through the halt builder that matches it. */
function throwTypeRefFault(s: EvalState, fault: TypeRefFault): never {
  const site = {
    location: fault.location,
    sourceId: s.ctx.sourceId,
    fn: fault.fn,
  };
  if (fault.type === 'halt') {
    return throwTypeHalt(site, fault.code, fault.message, 'runtime', fault.raw);
  }
  return fault.catchable
    ? throwCatchableHostHalt(site, fault.atom, fault.message)
    : throwFatalHostHalt(site, fault.atom, fault.message);
}

/**
 * Resolve a TypeRef to a RillTypeValue.
 *
 * Drives the shared conversion in types/type-ref.ts: default literals are
 * evaluated with evaluatePrimary, field annotations with evaluateAnnotations,
 * in the order the conversion asks for them. Faults surface as halts;
 * evaluation failures propagate.
 *
 * Variable not found -> RILL-R005.
 * Non-type variable value -> TYPE_MISMATCH.
 */
export async function resolveTypeRef(
  s: EvalState,
  typeRef: TypeRef,
  getVariableFn: (name: string) => RillValue | undefined,
  location?: SourceLocation
): Promise<RillTypeValue> {
  const env: TypeRefEnv = {
    leafTypes: s.ctx.leafTypes,
    variable: (name) => getVariableFn(name),
    fail: (fault) => throwTypeRefFault(s, fault),
  };
  try {
    const step = convertTypeRef(typeRef, env, location);
    let next = step.next();
    while (next.done !== true) {
      const request = next.value;
      const answer =
        request.kind === 'literal'
          ? await evaluatePrimary(s, request.node)
          : await evaluateAnnotations(s, [...request.args]);
      next = step.next(answer);
    }
    return next.value;
  } catch (e) {
    // A type nested deeper than the JS stack allows overflows the recursive
    // conversion; report it as a catchable halt, not a raw RangeError.
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      return throwTypeHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'resolveTypeRef' },
        'INVALID_INPUT',
        'stack depth exceeded while resolving type',
        'runtime'
      );
    }
    throw e;
  }
}

/**
 * Determine whether a TypeStructure carries sub-fields that require
 * deep structural matching (via structureMatches) rather than a bare
 * type-name comparison. Covers collection shapes (element, fields,
 * elements, members, map key and value) as well as fn shapes
 * (params, ret) and stream shapes (chunk, ret).
 */
function hasStructuralSubFields(structure: TypeStructure): boolean {
  if (isStructureKind(structure, 'map')) {
    return structure.key !== undefined || structure.value !== undefined;
  }
  return (
    'element' in structure ||
    'fields' in structure ||
    'elements' in structure ||
    'members' in structure ||
    'params' in structure ||
    'ret' in structure ||
    'chunk' in structure
  );
}

/** True for a union that lists at least one literal member. */
function hasLiteralMember(structure: TypeStructure): boolean {
  return (
    isStructureKind(structure, 'union') &&
    structure.members.some((member) => member.kind === 'literal')
  );
}

/** True for the value kinds a union literal member can match. */
function isScalarValue(value: RillValue): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isAtom(value)
  );
}

/**
 * Assert that a value is of the expected type.
 * Returns the value unchanged if assertion passes, throws on mismatch.
 * Accepts a bare RillTypeName or a full TypeStructure.
 * When expected is a TypeStructure with sub-fields (element, fields, elements),
 * dispatches to structureMatches for deep validation.
 * An optional hint is appended verbatim to the mismatch message.
 * Exported for use by type assertion evaluation.
 */
export function assertType(
  s: EvalState,
  value: RillValue,
  expected: RillTypeName | TypeStructure,
  location?: SourceLocation,
  hint?: string
): RillValue {
  // Structural path: expected is a TypeStructure object
  if (typeof expected !== 'string') {
    if (hasStructuralSubFields(expected)) {
      if (!structureMatches(value, expected)) {
        const expectedStr = formatStructure(expected);
        const actualStr =
          hasLiteralMember(expected) && isScalarValue(value)
            ? formatRillLiteral(value)
            : formatStructure(inferStructure(value));
        throwTypeHalt(
          {
            location,
            sourceId: s.ctx.sourceId,
            fn: ':',
          },
          'TYPE_MISMATCH',
          `Type assertion failed: expected ${expectedStr}, got ${actualStr}${hint ?? ''}`,
          'runtime',
          { expectedType: expectedStr, actualType: actualStr }
        );
      }
      return value;
    }
    // Bare structural type (no sub-fields): fall through using type name
    return assertBareTypeName(s, value, expected.kind, location, hint);
  }
  return assertBareTypeName(s, value, expected, location, hint);
}

function assertBareTypeName(
  s: EvalState,
  value: RillValue,
  expected: string,
  location?: SourceLocation,
  hint?: string
): RillValue {
  // Bare type name path
  if (expected === 'any') return value;
  const actual = inferType(value);
  if (actual !== expected) {
    throwTypeHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: ':',
      },
      'TYPE_MISMATCH',
      `Type assertion failed: expected ${expected}, got ${actual}${hint ?? ''}`,
      'runtime',
      { expectedType: expected, actualType: actual }
    );
  }
  return value;
}

/**
 * Resolve a written type and assert a carried value against it, as
 * `-> :T` does. The written type becomes the declaration unless it is `any`;
 * then the input's declaration carries through. Shared by type assertions,
 * typed captures and `use<id>:T`.
 */
export async function assertTypeRefCarried(
  s: EvalState,
  typeRef: TypeRef,
  location: SourceLocation,
  input: Carried
): Promise<Carried> {
  const resolved = await resolveTypeRef(
    s,
    typeRef,
    (name) => getVariable(s.ctx, name),
    location
  );
  const value = assertType(s, input.value, resolved.structure, location);
  return {
    value,
    declared: declarationOf(resolved.structure) ?? input.declared,
  };
}

/** Suffix for a declared atom the written type rejects. */
const ATOM_COMMENT_HINT = ". Hint: a comment needs a space after '#'";

/** True when a written type is, or has a union member that is, an atom type. */
function admitsAtom(structure: TypeStructure): boolean {
  if (structure.kind === 'atom') return true;
  if (isStructureKind(structure, 'literal')) return isAtom(structure.value);
  if (isStructureKind(structure, 'union')) {
    return structure.members.some(admitsAtom);
  }
  return false;
}

/**
 * Evaluate a declaration: the written type, then the literal it describes,
 * checked with the one type matcher. The declared type travels beside the
 * value; a type equal to its bare kind (`list`, `list()`, `list(any)`) is the
 * unspecified form and declares nothing.
 */
export async function evaluateDeclarationCarried(
  s: EvalState,
  node: DeclarationNode
): Promise<Carried> {
  const location = node.span.start;
  const written = await evaluatePrimary(s, node.typeExpr);
  // Defensive: a parsed declaration always writes a type expression.
  if (!isTypeValue(written)) {
    return throwTypeHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'evaluateDeclarationCarried' },
      'INVALID_INPUT',
      'Declaration requires a type',
      'runtime',
      undefined,
      'host'
    );
  }
  const structure = written.structure;
  const value = await evaluatePrimary(s, node.value);
  assertType(
    s,
    value,
    structure,
    location,
    isAtom(value) && !admitsAtom(structure) ? ATOM_COMMENT_HINT : undefined
  );
  const unspecified =
    structure.kind !== 'union' &&
    structure.kind !== 'literal' &&
    structureEquals(structure, { kind: structure.kind });
  return {
    value,
    declared: unspecified ? undefined : declarationOf(structure),
  };
}

/**
 * Evaluate a type assertion over an operand value the caller already
 * evaluated.
 */
export function evaluateTypeAssertionCarried(
  s: EvalState,
  node: TypeAssertionNode,
  input: Carried
): Promise<Carried> {
  return assertTypeRefCarried(s, node.typeRef, node.span.start, input);
}

/**
 * Evaluate type check: expr:?type or :?type (shorthand for $:?type), over
 * a value the caller already evaluated, so the operand runs once.
 * Returns true if type matches, false otherwise.
 */
export async function evaluateTypeCheck(
  s: EvalState,
  node: TypeCheckNode,
  value: RillValue
): Promise<boolean> {
  const resolved = await resolveTypeRef(
    s,
    node.typeRef,
    (name) => getVariable(s.ctx, name),
    node.span.start
  );
  if (hasStructuralSubFields(resolved.structure)) {
    return structureMatches(value, resolved.structure);
  }
  return checkType(value, resolved.typeName);
}

/**
 * Evaluate a type constructor node into a RillTypeValue.
 *
 * Handles `union(...)` members, then hands every other constructor
 * (`list`, `dict`, `tuple`, `ordered`, `stream`) to `resolveTypeRef`, which
 * drives the shared `convertTypeRef` conversion: default literals are
 * evaluated with evaluatePrimary and faults surface as halts.
 */
export async function evaluateTypeConstructor(
  s: EvalState,
  node: TypeConstructorNode
): Promise<RillTypeValue> {
  const name = node.constructorName;
  const location = node.span.start;

  if (name === 'union') {
    const resolved = await resolveTypeRef(
      s,
      { kind: 'union', members: node.args.map((arg) => arg.value) },
      (varName) => getVariable(s.ctx, varName)
    );
    return resolved;
  }

  return resolveTypeRef(
    s,
    { kind: 'static', typeName: name, args: node.args },
    (varName) => getVariable(s.ctx, varName),
    location
  );
}

/**
 * Evaluate an fn type expression (`fn`, `fn()`, `fn(x: number):string`) into
 * a RillTypeValue.
 */
export function evaluateFnType(
  s: EvalState,
  node: FnTypeNode
): Promise<RillTypeValue> {
  return resolveTypeRef(
    s,
    node.typeRef,
    (name) => getVariable(s.ctx, name),
    node.span.start
  );
}
