/**
 * Type Assertions and Checks
 *
 * Handles type assertion (:type) and type check (:?type) operations.
 * Provides runtime type validation with error reporting.
 *
 * Interface requirements (from spec):
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertionCarried(node, input) -> Promise<Carried>
 * - evaluateTypeCheck(node, value) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue>
 * - evaluateFnType(s, node) -> Promise<RillTypeValue>
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue>
 * - buildCollectionType(name, args, resolveArg, evaluateDefault, location?) -> Promise<RillTypeValue>
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
  ClosureParamNode,
  FnTypeNode,
  LiteralNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
  FieldArg,
} from '../../../../types.js';
import { isUnnamedParam } from '../../../../types.js';
import type {
  RillValue,
  RillTypeValue,
  TypeStructure,
  RillFieldDef,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { bareTypeStructure } from '../../types/error-code.js';
import {
  defaultMismatchMessage,
  nonTrailingDefaultIndex,
  nonTrailingDefaultMessage,
} from '../../types/field-defaults.js';
import { isAtom, isStructureKind, isTypeValue } from '../../types/guards.js';
import {
  structureMatches,
  defaultMismatch,
  inferStructure,
  formatStructure,
  formatRillLiteral,
} from '../../types/operations.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
} from '../../types/halt.js';
import { normalizeUnion } from '../../types/unions.js';
import {
  checkType,
  isReservedBrandKey,
  structureToTypeValue,
} from '../../values.js';
import { setDictField } from '../../types/dict-keys.js';
import { getVariable } from '../../context.js';
import { declarationOf, type Carried } from '../../types/declared.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { evaluateAnnotations } from './annotations.js';
import { evaluatePrimary } from './core.js';

type CollectionTypeName = 'list' | 'dict' | 'tuple' | 'ordered';

function isCollectionTypeName(name: string): name is CollectionTypeName {
  return (
    name === 'list' || name === 'dict' || name === 'tuple' || name === 'ordered'
  );
}

/** Halt with TYPE_MISMATCH when a default value does not match its declared type. */
function requireDefaultMatch(
  s: EvalState,
  fn: string,
  subject: string,
  value: RillValue,
  type: TypeStructure,
  location: SourceLocation | undefined
): void {
  const mismatch = defaultMismatch(value, type);
  if (mismatch === null) return;
  throwTypeHalt(
    { location, sourceId: s.ctx.sourceId, fn },
    'TYPE_MISMATCH',
    defaultMismatchMessage(subject, mismatch),
    'runtime',
    { ...mismatch }
  );
}

/**
 * Shared helper that partitions args, enforces validation, evaluates
 * defaults, and constructs a RillTypeValue.
 *
 * Called by both resolveTypeRef and evaluateTypeConstructor with
 * different resolution/evaluation strategies via callbacks.
 *
 * Error contracts:
 * - Leaf type with args -> TYPE_MISMATCH
 * - list != 1 arg -> TYPE_MISMATCH
 * - Positional+named mix -> TYPE_MISMATCH
 * - tuple with named arg -> TYPE_MISMATCH
 * - Non-type arg value (delegated to resolveArg callback)
 * - Default type mismatch -> TYPE_MISMATCH
 * - Tuple non-trailing default -> TYPE_MISMATCH
 */
async function buildCollectionType(
  s: EvalState,
  name: CollectionTypeName,
  args: FieldArg[],
  resolveArg: (arg: FieldArg) => Promise<TypeStructure>,
  evaluateDefault: (node: LiteralNode) => Promise<RillValue>,
  location?: SourceLocation
): Promise<RillTypeValue> {
  if (name === 'list') {
    // list requires exactly 1 positional arg
    const only = args.length === 1 ? args[0] : undefined;
    if (only === undefined || only.name !== undefined) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'list',
        },
        'INVALID_INPUT',
        'list() requires exactly 1 type argument',
        'runtime'
      );
    }
    const element = await resolveArg(only);
    const structure: TypeStructure = { kind: 'list', element };
    return Object.freeze({
      __rill_type: true as const,
      typeName: name,
      structure,
    });
  }

  if (name === 'dict' || name === 'ordered') {
    const positional: FieldArg[] = [];
    const named: { arg: FieldArg; name: string }[] = [];
    for (const a of args) {
      if (a.name === undefined) {
        positional.push(a);
      } else {
        named.push({ arg: a, name: a.name });
      }
    }

    for (const { name: argName } of named) {
      if (isReservedBrandKey(argName)) {
        throwCatchableHostHalt(
          { location, sourceId: s.ctx.sourceId, fn: name },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Cannot use reserved brand key '${argName}' as ${name} field name`
        );
      }
    }

    // Cannot mix positional and named arguments
    if (positional.length > 0 && named.length > 0) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: name,
        },
        'INVALID_INPUT',
        `${name}() cannot mix positional and named arguments`,
        'runtime'
      );
    }

    // Uniform path: exactly 1 positional, 0 named -> valueType
    const soleArg = positional[0];
    if (
      soleArg !== undefined &&
      positional.length === 1 &&
      named.length === 0
    ) {
      const valueType = await resolveArg(soleArg);
      // Default type mismatch on uniform single-arg path
      if (soleArg.defaultValue !== undefined) {
        const defaultVal = await evaluateDefault(soleArg.defaultValue);
        requireDefaultMatch(
          s,
          name,
          `${name} element`,
          defaultVal,
          valueType,
          location
        );
      }
      const structure: TypeStructure = { kind: name, valueType };
      return Object.freeze({
        __rill_type: true as const,
        typeName: name,
        structure,
      });
    }

    // EC: dict/ordered with 2+ positional args
    if (positional.length >= 2) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: name,
        },
        'INVALID_INPUT',
        `${name}() requires exactly 1 positional type argument`,
        'runtime'
      );
    }

    // Structural path: named args only -> fields
    if (name === 'dict') {
      const fields: Record<string, RillFieldDef> = {};
      for (const { arg, name: argName } of named) {
        const resolvedType = await resolveArg(arg);
        const fieldDef: RillFieldDef = { type: resolvedType };
        if (arg.defaultValue !== undefined) {
          const defaultVal = await evaluateDefault(arg.defaultValue);
          requireDefaultMatch(
            s,
            'dict',
            `field '${arg.name}'`,
            defaultVal,
            resolvedType,
            location
          );
          fieldDef.defaultValue = defaultVal;
        }
        // Evaluate per-field annotations
        if (arg.annotations) {
          if (arg.annotations.length > 0) {
            const annots: Record<string, RillValue> = await evaluateAnnotations(
              s,
              arg.annotations
            );
            fieldDef.annotations = annots;
          } else {
            // Empty ^() — attach empty annotations record
            fieldDef.annotations = {};
          }
        }
        setDictField(fields, argName, fieldDef);
      }
      const structure: TypeStructure = { kind: 'dict', fields };
      return Object.freeze({
        __rill_type: true as const,
        typeName: name,
        structure,
      });
    }

    // name === 'ordered': structural path -> fields array with name
    const orderedFields: RillFieldDef[] = [];
    for (const { arg, name: argName } of named) {
      const resolvedType = await resolveArg(arg);
      const fieldDef: RillFieldDef = {
        name: argName,
        type: resolvedType,
      };
      if (arg.defaultValue !== undefined) {
        const defaultVal = await evaluateDefault(arg.defaultValue);
        requireDefaultMatch(
          s,
          'ordered',
          `field '${arg.name}'`,
          defaultVal,
          resolvedType,
          location
        );
        fieldDef.defaultValue = defaultVal;
      }
      // Evaluate per-field annotations
      if (arg.annotations) {
        if (arg.annotations.length > 0) {
          const annots: Record<string, RillValue> = await evaluateAnnotations(
            s,
            arg.annotations
          );
          fieldDef.annotations = annots;
        } else {
          fieldDef.annotations = {};
        }
      }
      orderedFields.push(fieldDef);
    }
    const structure: TypeStructure = {
      kind: 'ordered',
      fields: orderedFields,
    };
    return Object.freeze({
      __rill_type: true as const,
      typeName: name,
      structure,
    });
  }

  // name === 'tuple'
  // tuple requires positional args only
  for (const arg of args) {
    if (arg.name !== undefined) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'tuple',
        },
        'INVALID_INPUT',
        'tuple() requires positional arguments',
        'runtime'
      );
    }
  }

  // Positional path: one element per argument
  const elements: RillFieldDef[] = [];
  for (const arg of args) {
    const resolvedType = await resolveArg(arg);
    const fieldDef: RillFieldDef = { type: resolvedType };
    if (arg.defaultValue !== undefined) {
      const defaultVal = await evaluateDefault(arg.defaultValue);
      requireDefaultMatch(
        s,
        'tuple',
        `tuple element`,
        defaultVal,
        resolvedType,
        location
      );
      fieldDef.defaultValue = defaultVal;
    }
    // Evaluate per-field annotations
    if (arg.annotations) {
      if (arg.annotations.length > 0) {
        const annots: Record<string, RillValue> = await evaluateAnnotations(
          s,
          arg.annotations
        );
        fieldDef.annotations = annots;
      } else {
        fieldDef.annotations = {};
      }
    }
    elements.push(fieldDef);
  }

  const misplaced = nonTrailingDefaultIndex(elements);
  if (misplaced !== -1) {
    throwTypeHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'tuple' },
      'INVALID_INPUT',
      nonTrailingDefaultMessage(misplaced),
      'runtime'
    );
  }

  const structure: TypeStructure = { kind: 'tuple', elements };
  return Object.freeze({
    __rill_type: true as const,
    typeName: 'tuple',
    structure,
  });
}

/**
 * Evaluate a literal written as a union member into a literal structure.
 * Only string (without interpolation), number, bool, and atom literals are
 * members; any other literal halts with INVALID_INPUT.
 */
async function resolveUnionLiteral(
  s: EvalState,
  literal: LiteralNode
): Promise<TypeStructure> {
  const allowed =
    literal.type === 'NumberLiteral' ||
    literal.type === 'BoolLiteral' ||
    literal.type === 'AtomLiteral' ||
    (literal.type === 'StringLiteral' &&
      literal.parts.every((part) => typeof part === 'string'));
  if (!allowed) {
    throwTypeHalt(
      { location: literal.span.start, sourceId: s.ctx.sourceId, fn: 'union' },
      'INVALID_INPUT',
      'union member must be a type or a string, number, bool, or atom literal',
      'runtime'
    );
  }
  const value = await evaluatePrimary(s, literal);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isAtom(value)
  ) {
    return { kind: 'literal', value };
  }
  return throwFatalHostHalt(
    { sourceId: s.ctx.sourceId, fn: 'union' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Union literal member evaluated to a non-scalar value'
  );
}

/**
 * Resolve a TypeRef to a RillTypeValue.
 *
 * Static refs with no args return a frozen RillTypeValue directly.
 * Static refs with args delegate to buildCollectionType.
 * Dynamic refs call getVariable, then dispatch on the result:
 * - RillTypeValue -> return as-is
 * - Otherwise -> throw TYPE_MISMATCH
 *
 * Variable not found -> RILL-R005.
 * Non-type variable value -> TYPE_MISMATCH.
 * list with != 1 positional arg -> TYPE_MISMATCH.
 * dict/ordered positional+named mix -> TYPE_MISMATCH.
 * tuple with named arg -> TYPE_MISMATCH.
 * Default type mismatch -> TYPE_MISMATCH.
 * Default evaluation failure -> propagated.
 * Tuple non-trailing default -> TYPE_MISMATCH.
 */
export async function resolveTypeRef(
  s: EvalState,
  typeRef: TypeRef,
  getVariableFn: (name: string) => RillValue | undefined,
  location?: SourceLocation
): Promise<RillTypeValue> {
  if (typeRef.kind === 'static') {
    const { typeName, args } = typeRef;

    // No args: existing bare-type behavior
    if (!args || args.length === 0) {
      return Object.freeze({
        __rill_type: true as const,
        typeName,
        structure: bareTypeStructure(typeName),
      });
    }

    // Leaf types reject all type arguments (derived from registrations)
    if (s.ctx.leafTypes.has(typeName)) {
      throwTypeHalt(
        {
          sourceId: s.ctx.sourceId,
          fn: typeName,
        },
        'INVALID_INPUT',
        `${typeName} does not accept type arguments`,
        'runtime'
      );
    }

    // Stream type: extract chunk/ret from args if present
    if (typeName === 'stream') {
      const streamStructure: {
        kind: 'stream';
        chunk?: TypeStructure;
        ret?: TypeStructure;
      } = { kind: 'stream' };
      if (args.length > 0 && args[0] !== undefined) {
        const chunkResolved = await resolveTypeRef(
          s,
          args[0].value,
          getVariableFn
        );
        streamStructure.chunk = chunkResolved.structure;
      }
      if (args.length > 1 && args[1] !== undefined) {
        const retResolved = await resolveTypeRef(
          s,
          args[1].value,
          getVariableFn
        );
        streamStructure.ret = retResolved.structure;
      }
      return structureToTypeValue(streamStructure);
    }

    // Delegate to buildCollectionType with recursive resolveTypeRef
    // Non-collection names with args fall through to the tuple path
    return buildCollectionType(
      s,
      isCollectionTypeName(typeName) ? typeName : 'tuple',
      args,
      async (arg: FieldArg): Promise<TypeStructure> => {
        const resolved = await resolveTypeRef(s, arg.value, getVariableFn);
        return resolved.structure.kind === 'any' &&
          resolved.typeName !== ('any' as RillTypeName)
          ? { kind: resolved.typeName }
          : resolved.structure;
      },
      (node: LiteralNode): Promise<RillValue> => {
        return evaluatePrimary(s, node);
      },
      location
    );
  }

  if (typeRef.kind === 'fn') {
    return resolveFnType(s, typeRef, getVariableFn, location);
  }

  // Literal refs exist only as members of a union; reaching one here means
  // the parser produced a tree the resolver cannot interpret.
  if (typeRef.kind === 'literal') {
    return throwFatalHostHalt(
      { sourceId: s.ctx.sourceId, fn: 'resolveTypeRef' },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Literal type reference outside a union'
    );
  }

  // Union type ref: resolve each member, then normalise the written set.
  if (typeRef.kind === 'union') {
    const written: TypeStructure[] = [];
    for (const member of typeRef.members) {
      if (member.kind === 'literal') {
        written.push(await resolveUnionLiteral(s, member.value));
      } else {
        const resolved = await resolveTypeRef(
          s,
          member,
          getVariableFn,
          location
        );
        written.push(resolved.structure);
      }
    }
    const normalized = normalizeUnion(written);
    if ('rejection' in normalized) {
      return throwTypeHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'union' },
        'INVALID_INPUT',
        normalized.rejection,
        'runtime'
      );
    }
    return structureToTypeValue(normalized.structure);
  }

  const result = getVariableFn(typeRef.varName);
  if (result === undefined) {
    throwCatchableHostHalt(
      { sourceId: s.ctx.sourceId, fn: 'resolveTypeRef' },
      ERROR_ATOMS[ERROR_IDS.RILL_R005],
      `Variable $${typeRef.varName} is not defined`
    );
  }
  if (isTypeValue(result)) return result;

  return throwTypeHalt(
    {
      sourceId: s.ctx.sourceId,
      fn: 'resolveTypeRef',
    },
    'TYPE_MISMATCH',
    `Variable $${typeRef.varName} is not a valid type reference (got ${inferType(result)})`,
    'runtime',
    { actualType: inferType(result) }
  );
}

/**
 * Determine whether a TypeStructure carries sub-fields that require
 * deep structural matching (via structureMatches) rather than a bare
 * type-name comparison. Covers collection shapes (element, fields,
 * elements, members, valueType) as well as fn shapes (params, ret)
 * and stream shapes (chunk, ret).
 */
function hasStructuralSubFields(structure: TypeStructure): boolean {
  return (
    'element' in structure ||
    'fields' in structure ||
    'elements' in structure ||
    'members' in structure ||
    'valueType' in structure ||
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
 * Exported for use by type assertion evaluation.
 */
export function assertType(
  s: EvalState,
  value: RillValue,
  expected: RillTypeName | TypeStructure,
  location?: SourceLocation
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
          `Type assertion failed: expected ${expectedStr}, got ${actualStr}`,
          'runtime',
          { expectedType: expectedStr, actualType: actualStr }
        );
      }
      return value;
    }
    // Bare structural type (no sub-fields): fall through using type name
    return assertBareTypeName(s, value, expected.kind, location);
  }
  return assertBareTypeName(s, value, expected, location);
}

function assertBareTypeName(
  s: EvalState,
  value: RillValue,
  expected: string,
  location?: SourceLocation
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
      `Type assertion failed: expected ${expected}, got ${actual}`,
      'runtime',
      { expectedType: expected, actualType: actual }
    );
  }
  return value;
}

/**
 * Evaluate a type assertion over an operand value the caller already
 * evaluated. The written type becomes the declaration unless it is `any`;
 * then the input's declaration carries through.
 */
export async function evaluateTypeAssertionCarried(
  s: EvalState,
  node: TypeAssertionNode,
  input: Carried
): Promise<Carried> {
  const resolved = await resolveTypeRef(
    s,
    node.typeRef,
    (name) => getVariable(s.ctx, name),
    node.span.start
  );
  const value = assertType(s, input.value, resolved.structure, node.span.start);
  return {
    value,
    declared: declarationOf(resolved.structure) ?? input.declared,
  };
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
 * Handles list(T), dict(...), tuple(...), ordered(...).
 * Delegates to buildCollectionType with evaluateTypeConstructor-specific
 * resolution strategy (resolves TypeRef via resolveTypeRef, evaluates
 * defaults via evaluatePrimary).
 *
 * Error contracts delegated to buildCollectionType.
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

/** The `any` type reference an untyped fn param resolves through. */
const ANY_TYPE_REF: TypeRef = { kind: 'static', typeName: 'any' };

/**
 * Resolve an fn type reference. Named params build an ordered, unnamed params
 * a tuple, both through buildCollectionType, so defaults, annotations and
 * default-versus-type checks match every other parameterized type. An omitted
 * outer is `any` whenever params are written.
 */
async function resolveFnType(
  s: EvalState,
  typeRef: Extract<TypeRef, { kind: 'fn' }>,
  getVariableFn: (name: string) => RillValue | undefined,
  location: SourceLocation | undefined
): Promise<RillTypeValue> {
  const resolveRef = async (ref: TypeRef): Promise<TypeStructure> => {
    const resolved = await resolveTypeRef(s, ref, getVariableFn);
    return resolved.structure.kind === 'any' &&
      resolved.typeName !== ('any' as RillTypeName)
      ? { kind: resolved.typeName }
      : resolved.structure;
  };
  const outer =
    typeRef.outer === undefined ? undefined : await resolveRef(typeRef.outer);

  if (typeRef.params === undefined) {
    const bare: TypeStructure =
      outer === undefined ? { kind: 'fn' } : { kind: 'fn', ret: outer };
    return structureToTypeValue(bare);
  }

  const params = await buildFnParams(
    s,
    typeRef.params,
    resolveRef,
    (node: LiteralNode): Promise<RillValue> => evaluatePrimary(s, node),
    location
  );
  return structureToTypeValue({
    kind: 'fn',
    params,
    ret: outer ?? { kind: 'any' },
  });
}

/** Build the field definitions of an fn param list. */
async function buildFnParams(
  s: EvalState,
  params: readonly ClosureParamNode[],
  resolveRef: (ref: TypeRef) => Promise<TypeStructure>,
  evaluateDefault: (node: LiteralNode) => Promise<RillValue>,
  location: SourceLocation | undefined
): Promise<RillFieldDef[]> {
  if (params.length === 0) return [];
  const unnamed = params.every(isUnnamedParam);
  const args: FieldArg[] = params.map((param) => {
    const arg: FieldArg = { value: param.typeRef ?? ANY_TYPE_REF };
    if (!unnamed) arg.name = param.name;
    if (param.defaultValue !== null) arg.defaultValue = param.defaultValue;
    if (param.annotations !== undefined) arg.annotations = param.annotations;
    return arg;
  });
  const built = await buildCollectionType(
    s,
    unnamed ? 'tuple' : 'ordered',
    args,
    (arg) => resolveRef(arg.value),
    evaluateDefault,
    location
  );
  const structure = built.structure;
  if (isStructureKind(structure, 'tuple')) return structure.elements ?? [];
  if (isStructureKind(structure, 'ordered')) return structure.fields ?? [];
  return [];
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
