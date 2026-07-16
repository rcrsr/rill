/**
 * TypesMixin: Type Assertions and Checks
 *
 * Handles type assertion (:type) and type check (:?type) operations.
 * Provides runtime type validation with error reporting.
 *
 * Interface requirements (from spec):
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue> [IR-7]
 * - evaluateClosureSigLiteral(node) -> Promise<RillTypeValue> [IR-8]
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue> [IR-2]
 * - buildCollectionType(name, args, resolveArg, evaluateDefault, location?) -> Promise<RillTypeValue> [IR-4]
 *
 * Error Handling:
 * - Type assertion failures throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-24]
 * - Type constructor argument errors throw RuntimeError [EC-4 through EC-7]
 * - Closure sig literal errors throw RuntimeError [EC-8, EC-9]
 *
 * @internal
 */

import type {
  TypeAssertionNode,
  TypeCheckNode,
  TypeConstructorNode,
  ClosureSigLiteralNode,
  LiteralNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
  FieldArg,
} from '../../../../types.js';
import type {
  RillValue,
  RillTypeValue,
  TypeStructure,
  RillFieldDef,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTypeValue } from '../../types/guards.js';
import {
  structureMatches,
  inferStructure,
  formatStructure,
} from '../../types/operations.js';
import { throwCatchableHostHalt, throwTypeHalt } from '../../types/halt.js';
import { checkType, structureToTypeValue } from '../../values.js';
import { getVariable } from '../../context.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { evaluateAnnotations } from './annotations.js';
import {
  evaluatePrimary,
  evaluatePostfixExpr,
  evaluateExpression,
} from './core.js';

/**
 * Shared helper that partitions args, enforces validation, evaluates
 * defaults, and constructs a RillTypeValue [IR-4].
 *
 * Called by both resolveTypeRef and evaluateTypeConstructor with
 * different resolution/evaluation strategies via callbacks.
 *
 * Error contracts:
 * - EC-B1: Leaf type with args -> TYPE_MISMATCH
 * - EC-B2: list != 1 arg -> TYPE_MISMATCH
 * - EC-B3: Positional+named mix -> TYPE_MISMATCH
 * - EC-B4: tuple with named arg -> TYPE_MISMATCH
 * - EC-B5: Non-type arg value (delegated to resolveArg callback)
 * - EC-B6: Default type mismatch -> TYPE_MISMATCH
 * - EC-B7: Tuple non-trailing default -> TYPE_MISMATCH
 */
export async function buildCollectionType(
  s: EvalState,
  name: 'list' | 'dict' | 'tuple' | 'ordered',
  args: FieldArg[],
  resolveArg: (arg: FieldArg) => Promise<TypeStructure>,
  evaluateDefault: (node: LiteralNode) => Promise<RillValue>,
  location?: SourceLocation
): Promise<RillTypeValue> {
  if (name === 'list') {
    // EC-B2: list requires exactly 1 positional arg
    if (args.length !== 1 || args[0]!.name !== undefined) {
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
    const element = await resolveArg(args[0]!);
    const structure: TypeStructure = { kind: 'list', element };
    return Object.freeze({
      __rill_type: true as const,
      typeName: name as RillTypeName,
      structure,
    });
  }

  if (name === 'dict' || name === 'ordered') {
    const positional = args.filter((a) => a.name === undefined);
    const named = args.filter((a) => a.name !== undefined);

    // EC-B3: Cannot mix positional and named arguments
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
    if (positional.length === 1 && named.length === 0) {
      const valueType = await resolveArg(positional[0]!);
      // EC-B6: Default type mismatch on uniform single-arg path
      if (positional[0]!.defaultValue !== undefined) {
        const defaultVal = await evaluateDefault(positional[0]!.defaultValue);
        if (!structureMatches(defaultVal, valueType)) {
          throwTypeHalt(
            {
              location,
              sourceId: s.ctx.sourceId,
              fn: name,
            },
            'TYPE_MISMATCH',
            `Default value for ${name} element must be ${formatStructure(valueType)}, got ${inferType(defaultVal)}`,
            'runtime',
            {
              expectedType: formatStructure(valueType),
              actualType: inferType(defaultVal),
            }
          );
        }
      }
      const structure: TypeStructure = { kind: name, valueType };
      return Object.freeze({
        __rill_type: true as const,
        typeName: name as RillTypeName,
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
      for (const arg of args) {
        const resolvedType = await resolveArg(arg);
        const fieldDef: RillFieldDef = { type: resolvedType };
        if (arg.defaultValue !== undefined) {
          const defaultVal = await evaluateDefault(arg.defaultValue);
          // EC-B6: Default type mismatch
          if (!structureMatches(defaultVal, resolvedType)) {
            throwTypeHalt(
              {
                location,
                sourceId: s.ctx.sourceId,
                fn: 'dict',
              },
              'TYPE_MISMATCH',
              `Default value for field '${arg.name}' must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
              'runtime',
              {
                expectedType: formatStructure(resolvedType),
                actualType: inferType(defaultVal),
              }
            );
          }
          fieldDef.defaultValue = defaultVal;
        }
        // IR-2: Evaluate per-field annotations
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
        fields[arg.name!] = fieldDef;
      }
      const structure: TypeStructure = { kind: 'dict', fields };
      return Object.freeze({
        __rill_type: true as const,
        typeName: name as RillTypeName,
        structure,
      });
    }

    // name === 'ordered': structural path -> fields array with name
    const orderedFields: RillFieldDef[] = [];
    for (const arg of args) {
      const resolvedType = await resolveArg(arg);
      const fieldDef: RillFieldDef = {
        name: arg.name!,
        type: resolvedType,
      };
      if (arg.defaultValue !== undefined) {
        const defaultVal = await evaluateDefault(arg.defaultValue);
        // EC-B6: Default type mismatch
        if (!structureMatches(defaultVal, resolvedType)) {
          throwTypeHalt(
            {
              location,
              sourceId: s.ctx.sourceId,
              fn: 'ordered',
            },
            'TYPE_MISMATCH',
            `Default value for field '${arg.name}' must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
            'runtime',
            {
              expectedType: formatStructure(resolvedType),
              actualType: inferType(defaultVal),
            }
          );
        }
        fieldDef.defaultValue = defaultVal;
      }
      // IR-2: Evaluate per-field annotations
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
      typeName: name as RillTypeName,
      structure,
    });
  }

  // name === 'tuple'
  // EC-B4: tuple requires positional args only
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

  // Uniform path: exactly 1 positional -> valueType
  if (args.length === 1 && args[0]!.name === undefined) {
    const valueType = await resolveArg(args[0]!);
    // EC-B6: Default type mismatch on uniform single-arg path
    if (args[0]!.defaultValue !== undefined) {
      const defaultVal = await evaluateDefault(args[0]!.defaultValue);
      if (!structureMatches(defaultVal, valueType)) {
        throwTypeHalt(
          {
            location,
            sourceId: s.ctx.sourceId,
            fn: 'tuple',
          },
          'TYPE_MISMATCH',
          `Default value for tuple element must be ${formatStructure(valueType)}, got ${inferType(defaultVal)}`,
          'runtime',
          {
            expectedType: formatStructure(valueType),
            actualType: inferType(defaultVal),
          }
        );
      }
    }
    const structure: TypeStructure = { kind: 'tuple', valueType };
    return Object.freeze({
      __rill_type: true as const,
      typeName: 'tuple' as RillTypeName,
      structure,
    });
  }

  // Structural path: 2+ positional -> elements
  const elements: RillFieldDef[] = [];
  for (const arg of args) {
    const resolvedType = await resolveArg(arg);
    const fieldDef: RillFieldDef = { type: resolvedType };
    if (arg.defaultValue !== undefined) {
      const defaultVal = await evaluateDefault(arg.defaultValue);
      // EC-B6: Default type mismatch
      if (!structureMatches(defaultVal, resolvedType)) {
        throwTypeHalt(
          {
            location,
            sourceId: s.ctx.sourceId,
            fn: 'tuple',
          },
          'TYPE_MISMATCH',
          `Default value for tuple element must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
          'runtime',
          {
            expectedType: formatStructure(resolvedType),
            actualType: inferType(defaultVal),
          }
        );
      }
      fieldDef.defaultValue = defaultVal;
    }
    // IR-2: Evaluate per-field annotations
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

  // EC-B7: Tuple non-trailing default — no element without a default
  // may follow an element that has one.
  let sawDefault = false;
  for (let i = 0; i < elements.length; i++) {
    const hasDefault = elements[i]!.defaultValue !== undefined;
    if (hasDefault) {
      sawDefault = true;
    } else if (sawDefault) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'tuple',
        },
        'INVALID_INPUT',
        `tuple() default values must be trailing: element at position ${i} has no default but a preceding element does`,
        'runtime'
      );
    }
  }

  const structure: TypeStructure = { kind: 'tuple', elements };
  return Object.freeze({
    __rill_type: true as const,
    typeName: 'tuple' as RillTypeName,
    structure,
  });
}

/**
 * Resolve a TypeRef to a RillTypeValue [IR-2].
 *
 * Static refs with no args return a frozen RillTypeValue directly.
 * Static refs with args delegate to buildCollectionType.
 * Dynamic refs call getVariable, then dispatch on the result:
 * - RillTypeValue -> return as-is
 * - Otherwise -> throw TYPE_MISMATCH
 *
 * EC-3: Variable not found -> RILL-R005.
 * EC-4: Non-type variable value -> TYPE_MISMATCH.
 * EC-5: list with != 1 positional arg -> TYPE_MISMATCH.
 * EC-6: dict/ordered positional+named mix -> TYPE_MISMATCH.
 * EC-7: tuple with named arg -> TYPE_MISMATCH.
 * EC-8: Default type mismatch -> TYPE_MISMATCH.
 * EC-9: Default evaluation failure -> propagated.
 * EC-10: Tuple non-trailing default -> TYPE_MISMATCH.
 */
export async function resolveTypeRef(
  s: EvalState,
  typeRef: TypeRef,
  getVariableFn: (name: string) => RillValue | undefined
): Promise<RillTypeValue> {
  if (typeRef.kind === 'static') {
    const { typeName, args } = typeRef;

    // No args: existing bare-type behavior
    if (!args || args.length === 0) {
      return Object.freeze({
        __rill_type: true as const,
        typeName,
        structure: { kind: typeName } as TypeStructure,
      });
    }

    // EC-B1: Leaf types reject all type arguments (AC-4: derived from registrations)
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
    return buildCollectionType(
      s,
      typeName as 'list' | 'dict' | 'tuple' | 'ordered',
      args,
      async (arg: FieldArg): Promise<TypeStructure> => {
        const resolved = await resolveTypeRef(s, arg.value, getVariableFn);
        return resolved.structure;
      },
      async (node: LiteralNode): Promise<RillValue> => {
        return evaluatePrimary(s, node);
      }
    );
  }

  // Union type ref: (A | B) -- resolve each member recursively and
  // return a RillTypeValue with structure: { kind: 'union', members: [...] }.
  // typeName is set to a display string for error messages; the structure
  // field carries the authoritative type shape for validation (DR-1).
  if (typeRef.kind === 'union') {
    const members: TypeStructure[] = [];
    for (const member of typeRef.members) {
      const resolved = await resolveTypeRef(s, member, getVariableFn);
      members.push(resolved.structure);
    }
    const structure: TypeStructure = { kind: 'union', members };
    const displayName = members.map(formatStructure).join('|') as RillTypeName;
    return Object.freeze({
      __rill_type: true as const,
      typeName: displayName,
      structure,
    });
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

  throwTypeHalt(
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
    const hasSubFields =
      'element' in expected ||
      'fields' in expected ||
      'elements' in expected ||
      'members' in expected ||
      'valueType' in expected;
    if (hasSubFields) {
      if (!structureMatches(value, expected)) {
        const expectedStr = formatStructure(expected);
        const actualStr = formatStructure(inferStructure(value));
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
    expected = expected.kind as RillTypeName;
  }
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
 * Evaluate type assertion: expr:type or :type (shorthand for $:type).
 * Returns the value if type matches, throws on mismatch.
 */
export async function evaluateTypeAssertion(
  s: EvalState,
  node: TypeAssertionNode,
  input: RillValue
): Promise<RillValue> {
  // If operand is null, use the input (pipe value)
  // Otherwise, evaluate the operand
  const value = node.operand
    ? await evaluatePostfixExpr(s, node.operand)
    : input;

  const resolved = await resolveTypeRef(s, node.typeRef, (name) =>
    getVariable(s.ctx, name)
  );
  return assertType(s, value, resolved.structure, node.span.start);
}

/**
 * Evaluate type check: expr:?type or :?type (shorthand for $:?type).
 * Returns true if type matches, false otherwise.
 */
export async function evaluateTypeCheck(
  s: EvalState,
  node: TypeCheckNode,
  input: RillValue
): Promise<boolean> {
  // If operand is null, use the input (pipe value)
  // Otherwise, evaluate the operand
  const value = node.operand
    ? await evaluatePostfixExpr(s, node.operand)
    : input;

  const resolved = await resolveTypeRef(s, node.typeRef, (name) =>
    getVariable(s.ctx, name)
  );
  const hasSubFields =
    'element' in resolved.structure ||
    'fields' in resolved.structure ||
    'elements' in resolved.structure ||
    'members' in resolved.structure ||
    'valueType' in resolved.structure;
  if (hasSubFields) {
    return structureMatches(value, resolved.structure);
  }
  return checkType(value, resolved.typeName);
}

/**
 * Evaluate postfix type assertion: expr:type.
 * The operand is always present (not null) for postfix form.
 */
export async function evaluateTypeAssertionPrimary(
  s: EvalState,
  node: TypeAssertionNode
): Promise<RillValue> {
  if (!node.operand) {
    throwTypeHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: ':',
      },
      'INVALID_INPUT',
      'Postfix type assertion requires operand',
      'runtime',
      undefined,
      'host'
    );
  }
  const value = await evaluatePostfixExpr(s, node.operand);
  return evaluateTypeAssertion(s, node, value);
}

/**
 * Evaluate postfix type check: expr:?type.
 * The operand is always present (not null) for postfix form.
 */
export async function evaluateTypeCheckPrimary(
  s: EvalState,
  node: TypeCheckNode
): Promise<boolean> {
  if (!node.operand) {
    throwTypeHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: ':?',
      },
      'INVALID_INPUT',
      'Postfix type check requires operand',
      'runtime',
      undefined,
      'host'
    );
  }
  const value = await evaluatePostfixExpr(s, node.operand);
  return evaluateTypeCheck(s, node, value);
}

/**
 * Evaluate a type constructor node into a RillTypeValue [IR-7].
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

  // Stream type constructor: extract chunk type (arg 0) and ret type (arg 1)
  if (name === 'stream') {
    const streamStructure: {
      kind: 'stream';
      chunk?: TypeStructure;
      ret?: TypeStructure;
    } = { kind: 'stream' };
    if (node.args.length > 0 && node.args[0] !== undefined) {
      const chunkResolved = await resolveTypeRef(
        s,
        node.args[0].value,
        (varName) => getVariable(s.ctx, varName)
      );
      streamStructure.chunk = chunkResolved.structure;
    }
    if (node.args.length > 1 && node.args[1] !== undefined) {
      const retResolved = await resolveTypeRef(
        s,
        node.args[1].value,
        (varName) => getVariable(s.ctx, varName)
      );
      streamStructure.ret = retResolved.structure;
    }
    return structureToTypeValue(streamStructure);
  }

  return buildCollectionType(
    s,
    name,
    node.args,
    async (arg: FieldArg): Promise<TypeStructure> => {
      const resolved = await resolveTypeRef(s, arg.value, (varName) =>
        getVariable(s.ctx, varName)
      );
      return resolved.structure.kind === 'any' &&
        resolved.typeName !== ('any' as RillTypeName)
        ? ({ kind: resolved.typeName } as TypeStructure)
        : resolved.structure;
    },
    async (node: LiteralNode): Promise<RillValue> => {
      return evaluatePrimary(s, node);
    },
    location
  );
}

/**
 * Evaluate a closure signature literal into a RillTypeValue [IR-8].
 *
 * Creates a closure type value from |param: T, ...|: R syntax.
 * Each parameter produces a [name, TypeStructure] entry.
 *
 * Error contracts:
 * - EC-8: missing return type -> TYPE_MISMATCH (enforced at parse time; node always has returnType)
 * - EC-9: non-type in parameter position -> TYPE_MISMATCH
 */
export async function evaluateClosureSigLiteral(
  s: EvalState,
  node: ClosureSigLiteralNode
): Promise<RillTypeValue> {
  const location = node.span.start;

  // Helper: evaluate a type expression and extract TypeStructure
  const resolveTypeExpr = async (argVal: RillValue): Promise<TypeStructure> => {
    if (!isTypeValue(argVal)) {
      throwTypeHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'closure-sig',
        },
        'TYPE_MISMATCH',
        `Parameter type must be a type value, got ${inferType(argVal)}`,
        'runtime',
        { actualType: inferType(argVal) }
      );
    }
    return argVal.structure.kind === 'any' &&
      argVal.typeName !== ('any' as RillTypeName)
      ? ({ kind: argVal.typeName } as TypeStructure)
      : argVal.structure;
  };

  // Evaluate parameter types
  const params: RillFieldDef[] = [];
  for (const param of node.params) {
    const paramVal: RillValue = await evaluateExpression(s, param.typeExpr);
    const paramType = await resolveTypeExpr(paramVal);
    params.push({ name: param.name, type: paramType });
  }

  // Evaluate return type (EC-8: required -- parser enforces this at parse time)
  // returnType is PostfixExprNode (stops before pipe operators) so the
  // return type annotation cannot accidentally consume a trailing pipe chain.
  const retVal: RillValue = await evaluatePostfixExpr(s, node.returnType);
  if (!isTypeValue(retVal)) {
    throwTypeHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'closure-sig',
      },
      'TYPE_MISMATCH',
      `Closure type literal requires return type after |, got ${inferType(retVal)}`,
      'runtime',
      { actualType: inferType(retVal) }
    );
  }
  const ret: TypeStructure =
    retVal.structure.kind === 'any' &&
    retVal.typeName !== ('any' as RillTypeName)
      ? ({ kind: retVal.typeName } as TypeStructure)
      : retVal.structure;

  const structure: TypeStructure = { kind: 'closure', params, ret };
  return Object.freeze({
    __rill_type: true as const,
    typeName: 'closure' as RillTypeName,
    structure,
  });
}

/**
 * TypesMixin implementation.
 *
 * Provides type assertion and type check functionality. Type assertions
 * validate that a value is of the expected type and throw on mismatch.
 * Type checks return boolean results without throwing.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluatePostfixExpr() (from future CoreMixin composition)
 * - evaluateExpression() (from CoreMixin, for type constructor arg evaluation)
 * - evaluatePrimary() (from CoreMixin, for default value evaluation)
 *
 * Methods added:
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue>
 * - evaluateClosureSigLiteral(node) -> Promise<RillTypeValue>
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue>
 * - buildCollectionType(name, args, resolveArg, evaluateDefault, location?) -> Promise<RillTypeValue>
 */
export function TypesMixin<TBase extends EvaluatorConstructor<EvaluatorBase>>(
  Base: TBase
) {
  return class TypesEvaluator extends Base {
    /**
     * Shared helper that partitions args, enforces validation, evaluates
     * defaults, and constructs a RillTypeValue [IR-4].
     *
     * Called by both resolveTypeRef and evaluateTypeConstructor with
     * different resolution/evaluation strategies via callbacks.
     *
     * Error contracts:
     * - EC-B1: Leaf type with args -> TYPE_MISMATCH
     * - EC-B2: list != 1 arg -> TYPE_MISMATCH
     * - EC-B3: Positional+named mix -> TYPE_MISMATCH
     * - EC-B4: tuple with named arg -> TYPE_MISMATCH
     * - EC-B5: Non-type arg value (delegated to resolveArg callback)
     * - EC-B6: Default type mismatch -> TYPE_MISMATCH
     * - EC-B7: Tuple non-trailing default -> TYPE_MISMATCH
     */
    buildCollectionType(
      name: 'list' | 'dict' | 'tuple' | 'ordered',
      args: FieldArg[],
      resolveArg: (arg: FieldArg) => Promise<TypeStructure>,
      evaluateDefault: (node: LiteralNode) => Promise<RillValue>,
      location?: SourceLocation
    ): Promise<RillTypeValue> {
      return buildCollectionType(
        this as unknown as EvalState,
        name,
        args,
        resolveArg,
        evaluateDefault,
        location
      );
    }

    /**
     * Resolve a TypeRef to a RillTypeValue [IR-2].
     *
     * Static refs with no args return a frozen RillTypeValue directly.
     * Static refs with args delegate to buildCollectionType.
     * Dynamic refs call getVariable, then dispatch on the result:
     * - RillTypeValue -> return as-is
     * - Otherwise -> throw TYPE_MISMATCH
     *
     * EC-3: Variable not found -> RILL-R005.
     * EC-4: Non-type variable value -> TYPE_MISMATCH.
     * EC-5: list with != 1 positional arg -> TYPE_MISMATCH.
     * EC-6: dict/ordered positional+named mix -> TYPE_MISMATCH.
     * EC-7: tuple with named arg -> TYPE_MISMATCH.
     * EC-8: Default type mismatch -> TYPE_MISMATCH.
     * EC-9: Default evaluation failure -> propagated.
     * EC-10: Tuple non-trailing default -> TYPE_MISMATCH.
     */
    resolveTypeRef(
      typeRef: TypeRef,
      getVariableFn: (name: string) => RillValue | undefined
    ): Promise<RillTypeValue> {
      return resolveTypeRef(
        this as unknown as EvalState,
        typeRef,
        getVariableFn
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
    assertType(
      value: RillValue,
      expected: RillTypeName | TypeStructure,
      location?: SourceLocation
    ): RillValue {
      return assertType(
        this as unknown as EvalState,
        value,
        expected,
        location
      );
    }

    /**
     * Evaluate type assertion: expr:type or :type (shorthand for $:type).
     * Returns the value if type matches, throws on mismatch.
     */
    evaluateTypeAssertion(
      node: TypeAssertionNode,
      input: RillValue
    ): Promise<RillValue> {
      return evaluateTypeAssertion(this as unknown as EvalState, node, input);
    }

    /**
     * Evaluate type check: expr:?type or :?type (shorthand for $:?type).
     * Returns true if type matches, false otherwise.
     */
    evaluateTypeCheck(node: TypeCheckNode, input: RillValue): Promise<boolean> {
      return evaluateTypeCheck(this as unknown as EvalState, node, input);
    }

    /**
     * Evaluate postfix type assertion: expr:type.
     * The operand is always present (not null) for postfix form.
     */
    evaluateTypeAssertionPrimary(node: TypeAssertionNode): Promise<RillValue> {
      return evaluateTypeAssertionPrimary(this as unknown as EvalState, node);
    }

    /**
     * Evaluate postfix type check: expr:?type.
     * The operand is always present (not null) for postfix form.
     */
    evaluateTypeCheckPrimary(node: TypeCheckNode): Promise<boolean> {
      return evaluateTypeCheckPrimary(this as unknown as EvalState, node);
    }

    /**
     * Evaluate a type constructor node into a RillTypeValue [IR-7].
     *
     * Handles list(T), dict(...), tuple(...), ordered(...).
     * Delegates to buildCollectionType with evaluateTypeConstructor-specific
     * resolution strategy (resolves TypeRef via resolveTypeRef, evaluates
     * defaults via evaluatePrimary).
     *
     * Error contracts delegated to buildCollectionType.
     */
    evaluateTypeConstructor(node: TypeConstructorNode): Promise<RillTypeValue> {
      return evaluateTypeConstructor(this as unknown as EvalState, node);
    }

    /**
     * Evaluate a closure signature literal into a RillTypeValue [IR-8].
     *
     * Creates a closure type value from |param: T, ...|: R syntax.
     * Each parameter produces a [name, TypeStructure] entry.
     *
     * Error contracts:
     * - EC-8: missing return type -> TYPE_MISMATCH (enforced at parse time; node always has returnType)
     * - EC-9: non-type in parameter position -> TYPE_MISMATCH
     */
    evaluateClosureSigLiteral(
      node: ClosureSigLiteralNode
    ): Promise<RillTypeValue> {
      return evaluateClosureSigLiteral(this as unknown as EvalState, node);
    }
  };
}

/**
 * Capability fragment: methods contributed by TypesMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type TypesMixinCapability = {
  evaluateTypeAssertion(
    node: TypeAssertionNode,
    input: RillValue
  ): Promise<RillValue>;
  evaluateTypeCheck(node: TypeCheckNode, input: RillValue): Promise<boolean>;
  evaluateTypeConstructor(node: TypeConstructorNode): Promise<RillTypeValue>;
  evaluateClosureSigLiteral(
    node: ClosureSigLiteralNode
  ): Promise<RillTypeValue>;
  assertType(
    value: RillValue,
    expected: RillTypeName | TypeStructure,
    location?: SourceLocation
  ): RillValue;
  resolveTypeRef(
    typeRef: TypeRef,
    getVariableFn: (name: string) => RillValue | undefined
  ): Promise<RillTypeValue>;
};
