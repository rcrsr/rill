/**
 * Type Reference Conversion
 *
 * One synchronous, context-free conversion from a parsed TypeRef to a
 * RillTypeValue. Script type expressions and host function type strings both
 * run through it, so every written type means the same thing in both places.
 *
 * The conversion is a generator. Whatever needs evaluation (a default
 * literal, a field annotation list) is yielded as a request and answered by
 * the driver; whatever fails is reported through `env.fail`. The driver
 * decides how literals are evaluated and how a failure surfaces.
 *
 * This module imports no evaluator state and no eval/ files.
 *
 * @internal
 */

import type {
  AnnotationArg,
  ClosureParamNode,
  FieldArg,
  LiteralNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
} from '../../../types.js';
import { isUnnamedParam } from '../../../types.js';
import type {
  RillFieldDef,
  RillTypeValue,
  RillValue,
  TypeStructure,
} from './structures.js';
import { BUILT_IN_TYPES, inferType } from './registrations.js';
import { bareTypeStructure } from './error-code.js';
import {
  defaultMismatchMessage,
  nonTrailingDefaultIndex,
  nonTrailingDefaultMessage,
} from './field-defaults.js';
import { setDictField } from './dict-keys.js';
import {
  isAtom,
  isDict,
  isStructureKind,
  isTypeValue,
  scalarKindOf,
} from './guards.js';
import type { ScalarKind } from './guards.js';
import { defaultMismatch } from './operations.js';
import { normalizeUnion } from './unions.js';
import { isReservedBrandKey, structureToTypeValue } from '../values.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

/** What the conversion asks its driver to evaluate. */
export type TypeRefRequest =
  | { readonly kind: 'literal'; readonly node: LiteralNode }
  | { readonly kind: 'annotations'; readonly args: readonly AnnotationArg[] };

/** The fields every failure carries. */
interface TypeRefFaultBase {
  /** Name of the construct that failed (`list`, `union`, a type name). */
  readonly fn: string;
  readonly message: string;
  readonly location?: SourceLocation | undefined;
  readonly raw?: Record<string, unknown> | undefined;
  readonly catchable: boolean;
}

/** A registered error atom, such as `RILL_R002`. */
type ErrorAtomCode = (typeof ERROR_ATOMS)[keyof typeof ERROR_ATOMS];

/**
 * A failure the conversion reports to its driver: either a core type halt
 * (`#INVALID_INPUT`, `#TYPE_MISMATCH`) or a registered error atom.
 */
export type TypeRefFault = TypeRefFaultBase &
  (
    | {
        readonly type: 'halt';
        readonly code: 'INVALID_INPUT' | 'TYPE_MISMATCH';
      }
    | { readonly type: 'atom'; readonly atom: ErrorAtomCode }
  );

/** What the driver supplies around one conversion. */
export interface TypeRefEnv {
  /** Type names that accept no type arguments. */
  readonly leafTypes: ReadonlySet<string>;
  /** The value bound to `$name`, or undefined when it is not defined. */
  variable(name: string, at?: SourceLocation): RillValue | undefined;
  /** Surface a fault. Never returns. */
  fail(fault: TypeRefFault): never;
}

/** A conversion step: yields requests, answered with values, returns T. */
export type TypeRefStep<T> = Generator<TypeRefRequest, T, RillValue>;

/**
 * Type names that reject every type argument: the leaf registrations plus
 * `any` and `error_code`, which have no registration of their own.
 */
export const LEAF_TYPES: ReadonlySet<string> = Object.freeze(
  new Set([
    ...BUILT_IN_TYPES.filter((r) => r.isLeaf).map((r) => r.name),
    'any',
    'error_code',
  ])
);

// ============================================================
// PRIVATE HELPERS
// ============================================================

type CollectionTypeName = 'list' | 'dict' | 'tuple' | 'ordered' | 'map';

function isCollectionTypeName(name: string): name is CollectionTypeName {
  return (
    name === 'list' ||
    name === 'dict' ||
    name === 'tuple' ||
    name === 'ordered' ||
    name === 'map'
  );
}

const MAP_KEY_KINDS: readonly ScalarKind[] = [
  'string',
  'number',
  'bool',
  'atom',
  'datetime',
  'duration',
];

/**
 * The one scalar kind a map key type names: `any` for an open key, the kind
 * for a scalar type or literal, the shared kind of a union's members.
 * `'mixed'` marks a union of two kinds; undefined marks a non-scalar type.
 */
function keyKindOfStructure(
  key: TypeStructure
): ScalarKind | 'any' | 'mixed' | undefined {
  if (key.kind === 'any') return 'any';
  if (isStructureKind(key, 'literal')) return scalarKindOf(key.value);
  if (isStructureKind(key, 'union')) {
    let shared: ScalarKind | 'any' | undefined;
    for (const member of key.members) {
      const kind = keyKindOfStructure(member);
      if (kind === undefined || kind === 'mixed') return kind;
      if (shared !== undefined && shared !== kind) return 'mixed';
      shared = kind;
    }
    return shared;
  }
  return MAP_KEY_KINDS.find((kind) => kind === key.kind);
}

/** The `any` type reference an untyped fn param converts through. */
const ANY_TYPE_REF: TypeRef = { kind: 'static', typeName: 'any' };

/** The structure a converted argument contributes to its parent. */
function argStructure(resolved: RillTypeValue): TypeStructure {
  return resolved.structure.kind === 'any' &&
    resolved.typeName !== ('any' as RillTypeName)
    ? { kind: resolved.typeName }
    : resolved.structure;
}

function freezeType(
  typeName: RillTypeName,
  structure: TypeStructure
): RillTypeValue {
  return Object.freeze({ __rill_type: true as const, typeName, structure });
}

function invalidInput(
  env: TypeRefEnv,
  fn: string,
  message: string,
  location: SourceLocation | undefined
): never {
  return env.fail({
    type: 'halt',
    code: 'INVALID_INPUT',
    fn,
    message,
    location,
    catchable: true,
  });
}

/** Fail with TYPE_MISMATCH when a default does not match its declared type. */
function requireDefaultMatch(
  env: TypeRefEnv,
  fn: string,
  subject: string,
  value: RillValue,
  type: TypeStructure,
  location: SourceLocation | undefined
): void {
  const mismatch = defaultMismatch(value, type);
  if (mismatch === null) return;
  env.fail({
    type: 'halt',
    code: 'TYPE_MISMATCH',
    fn,
    message: defaultMismatchMessage(subject, mismatch),
    location,
    raw: { ...mismatch },
    catchable: true,
  });
}

/** Ask the driver to evaluate one default literal. */
function* evaluateDefault(node: LiteralNode): TypeRefStep<RillValue> {
  return yield { kind: 'literal', node };
}

/** Ask the driver for a field's annotation record; `^()` is an empty record. */
function* evaluateFieldAnnotations(
  env: TypeRefEnv,
  args: readonly AnnotationArg[],
  location: SourceLocation | undefined
): TypeRefStep<Record<string, RillValue>> {
  if (args.length === 0) return {};
  const record = yield { kind: 'annotations', args };
  if (!isDict(record)) {
    return env.fail({
      type: 'atom',
      atom: ERROR_ATOMS[ERROR_IDS.RILL_R002],
      fn: 'annotations',
      message: 'Annotations evaluated to a non-dict value',
      location,
      catchable: false,
    });
  }
  return record;
}

/** The default, annotations, and type fields shared by every field def. */
function* completeField(
  env: TypeRefEnv,
  arg: FieldArg,
  fieldDef: RillFieldDef,
  fn: string,
  subject: string,
  location: SourceLocation | undefined
): TypeRefStep<RillFieldDef> {
  if (arg.defaultValue !== undefined) {
    const defaultVal = yield* evaluateDefault(arg.defaultValue);
    requireDefaultMatch(env, fn, subject, defaultVal, fieldDef.type, location);
    fieldDef.defaultValue = defaultVal;
  }
  if (arg.annotations !== undefined) {
    fieldDef.annotations = yield* evaluateFieldAnnotations(
      env,
      arg.annotations,
      location
    );
  }
  return fieldDef;
}

// ============================================================
// COLLECTION TYPES
// ============================================================

/**
 * Partition args, enforce the argument rules, evaluate defaults, and build a
 * collection type. `argAt` gives the location faults on one argument carry.
 *
 * Fault contracts:
 * - list != 1 arg, dict/ordered with 2+ positional, mixed positional and
 *   named, tuple with a named arg, tuple non-trailing default, a default on
 *   a list element, uniform dict/ordered value type, or stream chunk or
 *   return type: INVALID_INPUT
 * - default that does not match its type: TYPE_MISMATCH
 * - reserved brand key: RILL-R002
 */
function* buildCollectionType(
  env: TypeRefEnv,
  name: CollectionTypeName,
  args: readonly FieldArg[],
  resolveArg: (arg: FieldArg) => TypeRefStep<TypeStructure>,
  location: SourceLocation | undefined,
  argAt: (arg: FieldArg) => SourceLocation | undefined,
  fnParams = false
): TypeRefStep<RillTypeValue> {
  if (name === 'list') {
    const only = args.length === 1 ? args[0] : undefined;
    if (only === undefined || only.name !== undefined) {
      return invalidInput(
        env,
        'list',
        'list() requires exactly 1 type argument',
        location
      );
    }
    if (only.defaultValue !== undefined) {
      return invalidInput(
        env,
        'list',
        'list element type cannot carry a default',
        argAt(only) ?? location
      );
    }
    const element = yield* resolveArg(only);
    return freezeType(name, { kind: 'list', element });
  }

  if (name === 'map') {
    const [keyArg, valueArg] = args;
    if (
      args.length !== 2 ||
      keyArg === undefined ||
      valueArg === undefined ||
      keyArg.name !== undefined ||
      valueArg.name !== undefined
    ) {
      return invalidInput(
        env,
        'map',
        'map() requires exactly 2 unnamed type arguments',
        location
      );
    }
    for (const arg of args) {
      if (arg.defaultValue !== undefined) {
        return invalidInput(
          env,
          'map',
          'map key and value types cannot carry a default',
          argAt(arg) ?? location
        );
      }
    }
    const key = yield* resolveArg(keyArg);
    const keyKind = keyKindOfStructure(key);
    if (keyKind === undefined || keyKind === 'mixed') {
      return invalidInput(
        env,
        'map',
        keyKind === 'mixed'
          ? 'map key type must be one scalar kind, found a union of several kinds'
          : 'map key type must be a scalar kind',
        argAt(keyArg) ?? location
      );
    }
    const value = yield* resolveArg(valueArg);
    return freezeType(name, { kind: 'map', key, value });
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

    // fn params bind variables, not value keys, so a brand key is harmless.
    for (const { name: argName } of fnParams ? [] : named) {
      if (isReservedBrandKey(argName)) {
        env.fail({
          type: 'atom',
          atom: ERROR_ATOMS[ERROR_IDS.RILL_R002],
          fn: name,
          message: `Cannot use reserved brand key '${argName}' as ${name} field name`,
          location,
          catchable: true,
        });
      }
    }

    if (positional.length > 0 && named.length > 0) {
      return invalidInput(
        env,
        name,
        `${name}() cannot mix positional and named arguments`,
        location
      );
    }

    // Uniform path: exactly 1 positional, 0 named -> valueType
    const soleArg = positional[0];
    if (
      soleArg !== undefined &&
      positional.length === 1 &&
      named.length === 0
    ) {
      if (soleArg.defaultValue !== undefined) {
        return invalidInput(
          env,
          name,
          `${name} value type cannot carry a default`,
          argAt(soleArg) ?? location
        );
      }
      const valueType = yield* resolveArg(soleArg);
      return freezeType(name, { kind: name, valueType });
    }

    if (positional.length >= 2) {
      return invalidInput(
        env,
        name,
        `${name}() requires exactly 1 positional type argument`,
        location
      );
    }

    // Structural path: named args only -> fields
    if (name === 'dict') {
      const fields: Record<string, RillFieldDef> = {};
      for (const { arg, name: argName } of named) {
        const type = yield* resolveArg(arg);
        const fieldDef = yield* completeField(
          env,
          arg,
          { type },
          'dict',
          `field '${argName}'`,
          argAt(arg)
        );
        setDictField(fields, argName, fieldDef);
      }
      return freezeType(name, { kind: 'dict', fields });
    }

    const orderedFields: RillFieldDef[] = [];
    for (const { arg, name: argName } of named) {
      const type = yield* resolveArg(arg);
      orderedFields.push(
        yield* completeField(
          env,
          arg,
          { name: argName, type },
          fnParams ? 'fn' : 'ordered',
          fnParams ? `parameter '${argName}'` : `field '${argName}'`,
          argAt(arg)
        )
      );
    }
    return freezeType(name, { kind: 'ordered', fields: orderedFields });
  }

  // name === 'tuple': positional args only
  for (const arg of args) {
    if (arg.name !== undefined) {
      return invalidInput(
        env,
        'tuple',
        'tuple() requires positional arguments',
        location
      );
    }
  }

  const elements: RillFieldDef[] = [];
  for (const arg of args) {
    const type = yield* resolveArg(arg);
    elements.push(
      yield* completeField(
        env,
        arg,
        { type },
        'tuple',
        'tuple element',
        argAt(arg)
      )
    );
  }

  const misplaced = nonTrailingDefaultIndex(elements);
  if (misplaced !== -1) {
    return invalidInput(
      env,
      'tuple',
      nonTrailingDefaultMessage(misplaced),
      location
    );
  }
  return freezeType('tuple', { kind: 'tuple', elements });
}

// ============================================================
// UNION AND FN TYPES
// ============================================================

/**
 * Convert a literal written as a union member into a literal structure.
 * Only string (without interpolation), number, bool, and atom literals are
 * members.
 */
function* convertUnionLiteral(
  env: TypeRefEnv,
  literal: LiteralNode
): TypeRefStep<TypeStructure> {
  const allowed =
    literal.type === 'NumberLiteral' ||
    literal.type === 'BoolLiteral' ||
    literal.type === 'AtomLiteral' ||
    (literal.type === 'StringLiteral' &&
      literal.parts.every((part) => typeof part === 'string'));
  if (!allowed) {
    return invalidInput(
      env,
      'union',
      'union member must be a type or a string, number, bool, or atom literal',
      literal.span.start
    );
  }
  const value = yield* evaluateDefault(literal);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isAtom(value)
  ) {
    return { kind: 'literal', value };
  }
  return env.fail({
    type: 'atom',
    atom: ERROR_ATOMS[ERROR_IDS.RILL_R002],
    fn: 'union',
    message: 'Union literal member evaluated to a non-scalar value',
    catchable: false,
  });
}

/** Build the field definitions of an fn param list. */
function* convertFnParams(
  env: TypeRefEnv,
  params: readonly ClosureParamNode[],
  resolveRef: (
    ref: TypeRef,
    at: SourceLocation | undefined
  ) => TypeRefStep<TypeStructure>,
  location: SourceLocation | undefined
): TypeRefStep<RillFieldDef[]> {
  if (params.length === 0) return [];
  const unnamed = params.every(isUnnamedParam);
  const paramAt = new Map<FieldArg, SourceLocation>();
  const args: FieldArg[] = params.map((param) => {
    const arg: FieldArg = { value: param.typeRef ?? ANY_TYPE_REF };
    if (!unnamed) arg.name = param.name;
    if (param.defaultValue !== null) arg.defaultValue = param.defaultValue;
    if (param.annotations !== undefined) arg.annotations = param.annotations;
    paramAt.set(arg, param.span.start);
    return arg;
  });
  const argAt = (arg: FieldArg): SourceLocation | undefined =>
    paramAt.get(arg) ?? location;
  const built = yield* buildCollectionType(
    env,
    unnamed ? 'tuple' : 'ordered',
    args,
    (arg) => resolveRef(arg.value, argAt(arg)),
    location,
    argAt,
    true
  );
  const structure = built.structure;
  if (isStructureKind(structure, 'tuple')) return structure.elements ?? [];
  if (isStructureKind(structure, 'ordered')) return structure.fields ?? [];
  return [];
}

/**
 * Convert an fn type reference. Named params build an ordered, unnamed params
 * a tuple. An omitted outer is `any` whenever params are written. The outer
 * converts before the params.
 */
function* convertFnType(
  env: TypeRefEnv,
  typeRef: Extract<TypeRef, { kind: 'fn' }>,
  at: SourceLocation | undefined
): TypeRefStep<RillTypeValue> {
  const resolveRef = function* (
    ref: TypeRef,
    refAt: SourceLocation | undefined
  ): TypeRefStep<TypeStructure> {
    return argStructure(yield* convertTypeRef(ref, env, refAt));
  };
  const outer =
    typeRef.outer === undefined
      ? undefined
      : yield* resolveRef(typeRef.outer, at);

  if (typeRef.params === undefined) {
    const bare: TypeStructure =
      outer === undefined ? { kind: 'fn' } : { kind: 'fn', ret: outer };
    return structureToTypeValue(bare);
  }

  const params = yield* convertFnParams(env, typeRef.params, resolveRef, at);
  return structureToTypeValue({
    kind: 'fn',
    params,
    ret: outer ?? { kind: 'any' },
  });
}

// ============================================================
// CONVERSION
// ============================================================

/**
 * Convert a TypeRef to a RillTypeValue.
 *
 * Static refs with no args return a frozen bare type. Static refs with args
 * build a collection, stream, or fn shape. A `$name` ref reads the variable
 * through `env.variable` and must hold a type value. A union converts each
 * member and normalises the written set.
 *
 * Faults: leaf type with args, collection argument rules, defaults that do
 * not match, and a variable that is not defined (RILL-R005) or not a type.
 *
 * @param ref - The parsed type reference
 * @param env - Driver hooks for variables, leaf types, and faults
 * @param at - Location faults carry when the failing construct has none
 */
export function* convertTypeRef(
  ref: TypeRef,
  env: TypeRefEnv,
  at?: SourceLocation
): TypeRefStep<RillTypeValue> {
  if (ref.kind === 'static') {
    const { typeName, args } = ref;

    if (!args || args.length === 0) {
      return freezeType(typeName, bareTypeStructure(typeName));
    }

    if (env.leafTypes.has(typeName)) {
      return invalidInput(
        env,
        typeName,
        `${typeName} does not accept type arguments`,
        at
      );
    }

    // Stream type: chunk and ret from the first two args
    if (typeName === 'stream') {
      const streamStructure: {
        kind: 'stream';
        chunk?: TypeStructure;
        ret?: TypeStructure;
      } = { kind: 'stream' };
      const [chunkArg, retArg] = args;
      if (chunkArg?.defaultValue !== undefined) {
        return invalidInput(
          env,
          'stream',
          'stream chunk type cannot carry a default',
          at
        );
      }
      if (retArg?.defaultValue !== undefined) {
        return invalidInput(
          env,
          'stream',
          'stream return type cannot carry a default',
          at
        );
      }
      if (chunkArg !== undefined) {
        streamStructure.chunk = (yield* convertTypeRef(
          chunkArg.value,
          env,
          at
        )).structure;
      }
      if (retArg !== undefined) {
        streamStructure.ret = (yield* convertTypeRef(
          retArg.value,
          env,
          at
        )).structure;
      }
      return structureToTypeValue(streamStructure);
    }

    // Non-collection names with args fall through to the tuple path
    return yield* buildCollectionType(
      env,
      isCollectionTypeName(typeName) ? typeName : 'tuple',
      args,
      function* (arg) {
        return argStructure(yield* convertTypeRef(arg.value, env, at));
      },
      at,
      () => at
    );
  }

  if (ref.kind === 'fn') {
    return yield* convertFnType(env, ref, at);
  }

  // Literal refs exist only as members of a union; reaching one here means
  // the parser produced a tree the conversion cannot interpret.
  if (ref.kind === 'literal') {
    return env.fail({
      type: 'atom',
      atom: ERROR_ATOMS[ERROR_IDS.RILL_R002],
      fn: 'resolveTypeRef',
      message: 'Literal type reference outside a union',
      catchable: false,
    });
  }

  if (ref.kind === 'union') {
    const written: TypeStructure[] = [];
    for (const member of ref.members) {
      if (member.kind === 'literal') {
        written.push(yield* convertUnionLiteral(env, member.value));
      } else {
        written.push((yield* convertTypeRef(member, env, at)).structure);
      }
    }
    const normalized = normalizeUnion(written);
    if ('rejection' in normalized) {
      return invalidInput(env, 'union', normalized.rejection, at);
    }
    return structureToTypeValue(normalized.structure);
  }

  const result = env.variable(ref.varName, at);
  if (result === undefined) {
    return env.fail({
      type: 'atom',
      atom: ERROR_ATOMS[ERROR_IDS.RILL_R005],
      fn: 'resolveTypeRef',
      message: `Variable $${ref.varName} is not defined`,
      catchable: true,
    });
  }
  if (isTypeValue(result)) return result;

  return env.fail({
    type: 'halt',
    code: 'TYPE_MISMATCH',
    fn: 'resolveTypeRef',
    message: `Variable $${ref.varName} is not a valid type reference (got ${inferType(result)})`,
    raw: { actualType: inferType(result) },
    catchable: true,
  });
}
