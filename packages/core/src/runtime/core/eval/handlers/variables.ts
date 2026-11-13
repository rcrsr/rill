/**
 * Variable Access and Mutation
 *
 * Handles variable access, mutation, and capture operations:
 * - Variable lookup with scope chain traversal
 * - Variable assignment with type checking
 * - Capture syntax (:> $name)
 *
 * LIMITATIONS:
 * - Property access chains ($data.field[0]) require access.ts
 * - Existence checks (.?field) require access.ts
 * - Default values ($data ?? default) require access.ts or control-flow.ts
 *
 * Interface requirements (from spec):
 * - setVariable(name, value, explicitType?, location?, carried?) -> void
 * - evaluateVariable(node) -> RillValue
 * - evaluateVariableAsync(node) -> Promise<RillValue>
 * - evaluateCapture(node, input) -> RillValue
 *
 * Depends on:
 * - EvalState: ctx; shared.ts: checkAborted(), getNodeLocation()
 * - context utilities: getVariable, hasVariable
 *
 * Extended by:
 * - access.ts: adds property chain evaluation to evaluateVariableAsync
 * - field-access.ts: evaluates variable-key, computed-key, and alternatives
 *   field access for evaluateVariableAsync
 *
 * Error Handling:
 * - Undefined variables halt with a catchable RuntimeHaltSignal (RILL-R005)
 * - Type mismatches halt with a catchable RuntimeHaltSignal (RILL-R002)
 *
 * @internal
 */

import type {
  ASTNode,
  VariableNode,
  CaptureNode,
  SourceLocation,
  MethodCallNode,
  ExpressionNode,
} from '../../../../types.js';
import { RuntimeError, isPipeChainNode } from '../../../../types.js';
import type { TypeStructure, RillValue } from '../../types/structures.js';
import type { Carried } from '../../types/declared.js';
import { declarationOf, pipeDeclaredOf } from '../../types/declared.js';
import { inferType, inferTypeName } from '../../types/registrations.js';
import { isOrdered, isTuple, isIterator } from '../../types/guards.js';
import { formatStructure, structureMatches } from '../../types/operations.js';
import {
  getVariable,
  hasVariable,
  findVariableScope,
  scopeVariableDeclared,
} from '../../context.js';
import { isCallable } from '../../callable.js';
import { isVacant, isInvalid, getStatus } from '../../types/status.js';
import { atomName } from '../../types/atom-registry.js';
import {
  RuntimeHaltSignal,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import type { EvalState } from '../state.js';
import { accessHaltGateFast } from './access.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, isFieldReceiver } from '../shared.js';
import { evaluateBody } from './control-flow.js';
import { evaluatePipeChain } from './core.js';
import {
  evaluateParamsProperty,
  evaluateMethod,
  evaluateAnnotationAccess,
} from './closures.js';
import { resolveTypeRef } from './types.js';
import type { FieldKey } from './field-access.js';
import {
  evaluateFieldAccessVariable,
  evaluateFieldAccessComputed,
  evaluateFieldAccessAlternatives,
  isFieldKey,
  locateField,
  projectLocated,
  readField,
  throwFieldMiss,
  throwNonIntegerIndex,
} from './field-access.js';

/**
 * Set a variable with type checking.
 * - First assignment locks the type (inferred or explicit)
 * - Subsequent assignments must match the locked type
 * - Explicit type annotation is validated against value type
 * - Cannot shadow outer scope variables (produces error)
 */
export function setVariable(
  s: EvalState,
  name: string,
  value: RillValue,
  explicitType?: TypeStructure,
  location?: SourceLocation,
  carried?: TypeStructure
): void {
  const valueType = inferType(value);

  // Check the explicit annotation structurally. `any` normalizes away: it
  // accepts every value and declares nothing, so the variable locks to the
  // carried or inferred type instead.
  const explicit = declarationOf(explicitType);
  if (explicit !== undefined) {
    if (!structureMatches(value, explicit)) {
      const expectedLabel = formatStructure(explicit);
      throwCatchableHostHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'setVariable' },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        `Type mismatch: cannot assign ${valueType} to $${name}:${expectedLabel}`,
        {
          variableName: name,
          expectedType: expectedLabel,
          actualType: valueType,
        }
      );
    }
  }

  // Check if this is a new variable that would reassign an outer scope variable
  // (error: cannot reassign outer scope variables from child scopes)
  if (
    !s.ctx.variables.has(name) &&
    s.ctx.parent &&
    hasVariable(s.ctx.parent, name)
  ) {
    throwCatchableHostHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'setVariable' },
      ERROR_ATOMS[ERROR_IDS.RILL_R001],
      `Cannot reassign outer variable $${name} from child scope`,
      { variableName: name }
    );
  }

  const lockedType = s.ctx.variableTypes.get(name);
  if (lockedType !== undefined && lockedType !== 'any') {
    if (typeof lockedType === 'object') {
      // Structural locked type — validate full shape. Re-capturing the value
      // this scope already stores needs no recheck: it passed the lock when
      // it was stored and values are immutable.
      const alreadyStored =
        s.ctx.variables.has(name) && s.ctx.variables.get(name) === value;
      if (!alreadyStored && !structureMatches(value, lockedType)) {
        const expectedLabel = formatStructure(lockedType);
        throwCatchableHostHalt(
          { location, sourceId: s.ctx.sourceId, fn: 'setVariable' },
          ERROR_ATOMS[ERROR_IDS.RILL_R001],
          `Type mismatch: cannot assign ${valueType} to $${name} (locked as ${expectedLabel})`,
          {
            variableName: name,
            expectedType: expectedLabel,
            actualType: valueType,
          }
        );
      }
    } else if (lockedType !== valueType) {
      throwCatchableHostHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'setVariable' },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        `Type mismatch: cannot assign ${valueType} to $${name} (locked as ${lockedType})`,
        {
          variableName: name,
          expectedType: lockedType,
          actualType: valueType,
        }
      );
    }
  }

  // Set the variable and lock its type in current scope
  s.ctx.variables.set(name, value);
  if (!s.ctx.variableTypes.has(name)) {
    // The declared type is the lock: explicit annotation first, then the
    // type carried with the value, then the inferred kind name. A later
    // capture never changes it.
    const lockType = explicit ?? carried ?? inferTypeName(value);
    s.ctx.variableTypes.set(name, lockType);
  }
}

/**
 * Evaluate variable access synchronously.
 * Handles bare variable references: $name or $.
 *
 * Note: This is a simplified synchronous version. The full implementation
 * with property access chains is in evaluateVariableAsync.
 */
export function evaluateVariable(s: EvalState, node: VariableNode): RillValue {
  // Handle pipe variable ($)
  if (node.isPipeVar && (node.name === null || node.name === '')) {
    if (s.ctx.pipeValue === null) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateVariable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        'Undefined variable: $',
        { variable: '$' }
      );
    }
    return s.ctx.pipeValue;
  }

  // Handle named variable ($name)
  if (node.name !== null && node.name !== '') {
    const result = getVariable(s.ctx, node.name);
    if (result === undefined) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateVariable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Undefined variable: $${node.name}`,
        { variable: node.name }
      );
    }
    return result;
  }

  // Should not reach here - all variable nodes have either isPipeVar or name
  return throwCatchableHostHalt(
    {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'evaluateVariable',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R005],
    'Invalid variable node'
  );
}

/**
 * Apply bracket-index access (`receiver[indexExpr]`) to a list, tuple, ordered
 * or dict receiver, evaluating `indexExpr` as a pipe chain to obtain the
 * index/key.
 *
 * Shared by the `$var[i]` access-chain path (evaluateVariableAsync) and the
 * postfix `expr[i]` method-chain path (evaluatePostfixExpr / the pipe-target
 * PostfixExpr case in core.ts) so both surfaces halt identically. The key is
 * validated here (bracketKey); the element is found by locateField and its
 * declared type projected from `receiverDeclared` by the located position or
 * name, so a negative index counts from the end of the value, not of the
 * declared type. A receiver with no declaration yields none.
 *
 * `location` and `fn` are supplied by the caller so trace frames match the
 * calling context exactly (e.g. 'evaluateVariableAsync' for the $var[i]
 * path).
 */
export async function applyBracketIndexCarried(
  s: EvalState,
  receiver: RillValue,
  indexExpr: ExpressionNode,
  location: SourceLocation | undefined,
  fn: string,
  receiverDeclared?: TypeStructure
): Promise<Carried> {
  const site: TypeHaltSite = { location, sourceId: s.ctx.sourceId, fn };
  // Bracket-index expressions are parsed inline while building a live
  // access/method chain (never via the statement-level recovery path), so
  // they only ever hold a PipeChainNode; PartialExpressionNode is reserved
  // for parser error recovery.
  if (!isPipeChainNode(indexExpr)) {
    throwFatalHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Bracket access expression must be a pipe chain'
    );
  }
  const indexValue = await evaluatePipeChain(s, indexExpr);
  const key = bracketKey(receiver, indexValue, site);
  const located = locateField(receiver, key);
  if (!located.found) {
    // A dict names a missing key `Undefined dict key`, whatever the key type.
    if (isFieldReceiver(receiver)) {
      return throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        `Undefined dict key: ${key}`
      );
    }
    return throwFieldMiss(receiver, key, located.miss, site);
  }
  return {
    value: located.value,
    declared: projectLocated(receiverDeclared, located),
  };
}

/**
 * Validate a bracket key against its receiver. Lists and tuples take a number,
 * ordered values a string or number, dicts a string, number or boolean; every
 * other receiver, and an iterator, cannot be indexed.
 */
function bracketKey(
  receiver: RillValue,
  indexValue: RillValue,
  site: TypeHaltSite
): FieldKey {
  const reject = (message: string): never =>
    throwCatchableHostHalt(site, ERROR_ATOMS[ERROR_IDS.RILL_R002], message);
  const got = inferType(indexValue);
  if (Array.isArray(receiver)) {
    return typeof indexValue === 'number'
      ? indexValue
      : reject(`List index must be number, got ${got}`);
  }
  if (isOrdered(receiver)) {
    return typeof indexValue === 'string' || typeof indexValue === 'number'
      ? indexValue
      : reject(`Ordered index must be string or number, got ${got}`);
  }
  if (isTuple(receiver)) {
    return typeof indexValue === 'number'
      ? indexValue
      : reject(`Tuple index must be number, got ${got}`);
  }
  // Must precede the dict case: an iterator is structurally a dict.
  if (isIterator(receiver)) return reject('Cannot index iterator');
  if (isFieldReceiver(receiver)) {
    return isFieldKey(indexValue)
      ? indexValue
      : reject(`Dict key must be string, got ${got}`);
  }
  return reject(`Cannot index ${inferType(receiver)}`);
}

/**
 * Evaluate an existence check (`.?field`) against an already-resolved
 * access-chain value, returning whether the final path element exists
 * (and, when `typeRef` is set, whether it matches that type).
 *
 * Extracted from the inline `node.existenceCheck` branch of
 * evaluateVariableAsync so other access-chain evaluators can reuse the
 * same logic against a resolved receiver and node for location info.
 */
export async function evaluateExistenceCheck(
  s: EvalState,
  value: RillValue,
  existenceCheck: NonNullable<VariableNode['existenceCheck']>,
  node: ASTNode
): Promise<boolean> {
  const finalAccess = existenceCheck.finalAccess;
  const typeRef = existenceCheck.typeRef;

  // Helper: check type match using structural resolution (mismatch returns false)
  const matchesType = async (fieldValue: RillValue): Promise<boolean> => {
    if (typeRef === null) return true;
    const resolved = await resolveTypeRef(s, typeRef, (name: string) =>
      getVariable(s.ctx, name)
    );
    return structureMatches(fieldValue, resolved.structure);
  };

  // Bare `.?` probe: no field/key follows, so the check is against the
  // receiver itself (the accumulated access-chain result) rather than a
  // field on it. Returns whether the receiver is a valid value (and, when
  // type-qualified, whether it also matches that type).
  if (finalAccess === null) {
    if (value === null || isInvalid(value)) return false;
    return await matchesType(value);
  }

  const site = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: 'evaluateExistenceCheck',
  };
  let key: FieldKey;
  if (finalAccess.kind === 'literal') {
    key = finalAccess.field;
  } else if (finalAccess.kind === 'variable') {
    const keyValue =
      finalAccess.variableName === null
        ? (s.ctx.pipeValue ?? undefined)
        : getVariable(s.ctx, finalAccess.variableName);
    if (keyValue === undefined) {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Variable '${finalAccess.variableName ?? '$'}' is undefined`
      );
    }
    if (!isFieldKey(keyValue)) {
      // A key no receiver accepts only halts where a field read would.
      if (!isFieldReceiver(value)) return false;
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Existence check key must be string, got ${inferType(keyValue)}`
      );
    }
    key = keyValue;
  } else if (finalAccess.kind === 'computed') {
    // Parsed inline while building a live access chain (never via the
    // statement-level recovery path), so it only ever holds a PipeChainNode;
    // PartialExpressionNode is reserved for parser error recovery.
    if (!isPipeChainNode(finalAccess.expression)) {
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Existence check computed key expression must be a pipe chain'
      );
    }
    const keyValue = await evaluatePipeChain(s, finalAccess.expression);
    if (!isFieldKey(keyValue)) {
      if (isOrdered(value)) return false;
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Existence check key evaluated to ${inferType(keyValue)}, expected string`
      );
    }
    key = keyValue;
  } else {
    // For other access kinds (block, alternatives, annotation), not supported
    return throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Existence check not yet supported for ${finalAccess.kind} access`
    );
  }

  // Locate without reading: a property-style callable is never invoked.
  const located = locateField(value, key);
  if (!located.found) {
    if (located.miss === 'non-integer' && typeof key === 'number') {
      throwNonIntegerIndex(value, key, site);
    }
    return false;
  }
  return typeRef === null ? true : await matchesType(located.value);
}

/**
 * Evaluate variable access asynchronously.
 * Async variant that supports access chains ($.field, $var.field).
 *
 * Handles property access chains and default values.
 */
export async function evaluateVariableAsync(
  s: EvalState,
  node: VariableNode
): Promise<RillValue> {
  return (await evaluateVariableCarried(s, node)).value;
}

/**
 * Variable access that also reports the declared type of the result.
 *
 * The base `$` reads the guarded pipe slot and `$name` reads the owning
 * scope's lock. Bracket access, dict-field access, `.$k` and `.(expr)` locate
 * the element with locateField and project its type from a declared
 * collection. `.^type` receives the
 * current declared type. Every other step, the `??` default and the `.?`
 * existence check take their own type, so they report no declaration.
 */
export async function evaluateVariableCarried(
  s: EvalState,
  node: VariableNode
): Promise<Carried> {
  // Get base value ($ or $name)
  let value: RillValue;
  let declared: TypeStructure | undefined;

  if (node.isPipeVar && (node.name === null || node.name === '')) {
    // Pipe variable ($)
    if (s.ctx.pipeValue === null) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateVariableAsync',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        'Undefined variable: $',
        { variable: '$' }
      );
    }
    value = s.ctx.pipeValue;
    declared = pipeDeclaredOf(s.ctx);
  } else if (node.name !== null && node.name !== '') {
    // Named variable ($name)
    const owner = findVariableScope(s.ctx, node.name);
    const result = owner?.variables.get(node.name);
    if (owner === undefined || result === undefined) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateVariableAsync',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Undefined variable: $${node.name}`,
        { variable: node.name }
      );
    }
    value = result;
    declared = scopeVariableDeclared(owner, node.name);
  } else {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateVariableAsync',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R005],
      'Invalid variable node'
    );
  }

  // Apply access chain ($.field, $var.field, etc.)
  for (const access of node.accessChain) {
    // An intermediate step's LHS short-circuits to the default only when
    // it is null or carries an invalid status — a structurally empty but
    // valid value (empty list, empty dict, empty string) must still flow
    // into the next access step (e.g. `.empty`) rather than trigger the
    // default early. Only the final result's vacancy (empty OR invalid)
    // triggers `??`, handled after the loop.
    if (value === null || isInvalid(value)) {
      // Use default value if available
      if (node.defaultValue) {
        return {
          value: await evaluateBody(s, node.defaultValue),
          declared: undefined,
        };
      }
      if (value === null) {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateVariableAsync',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `Cannot access property on null`
        );
      }
      // Invalid (non-null) value with no default: route through the
      // access-halt gate so the halt carries an `access` trace frame.
      value = accessHaltGateFast(
        value,
        '.',
        () => getNodeLocation(s, node),
        s.ctx.sourceId
      );
      declared = undefined;
    }

    // Check if this is a bracket access
    if ('accessKind' in access) {
      // Bracket access: [expr]. Delegates to the shared applyBracketIndexCarried
      // helper (list negative-index normalization, dict typed-key lookup,
      // and the 'Cannot index <type>' fallback) so this path stays in sync
      // with the postfix expr[i] path in core.ts.
      const element = await applyBracketIndexCarried(
        s,
        value,
        access.expression,
        getNodeLocation(s, node),
        'evaluateVariableAsync',
        declared
      );
      value = element.value;
      declared = element.declared;
      continue;
    }

    // Steps below take their own type unless they set `declared` again.
    const receiverDeclared = declared;
    declared = undefined;

    // Must be a FieldAccess
    if (access.kind === 'literal') {
      const field = access.field;
      // Handle .params property on closures
      if (field === 'params') {
        if (isCallable(value)) {
          value = await evaluateParamsProperty(
            s,
            value,
            getNodeLocation(s, node)
          );
        } else {
          // .params on non-callable: throw or return null based on default value
          if (node.defaultValue !== null) {
            value = null;
          } else {
            throwCatchableHostHalt(
              {
                location: getNodeLocation(s, node),
                sourceId: s.ctx.sourceId,
                fn: 'evaluateVariableAsync',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R003],
              `Cannot access .params on ${inferType(value)}`,
              { actualType: inferType(value) }
            );
          }
        }
      } else if (
        s.ctx.typeMethodDicts.get(inferType(value))?.[field] !== undefined
      ) {
        // Field is a built-in method - invoke it
        // Create a synthetic MethodCallNode with no args and call evaluateMethod
        const methodNode: MethodCallNode = {
          type: 'MethodCall',
          name: field,
          args: [],
          receiverSpan: null,
          hasParens: false,
          span: node.span,
        };
        value = await evaluateMethod(s, methodNode, value);
      } else {
        // Declared type flows from the receiver unless a property-style
        // callable ran or the receiver is a type value.
        const read = await readField(s, value, field, {
          allowMissing:
            node.defaultValue !== null || node.existenceCheck !== null,
          location: getNodeLocation(s, node),
          fn: 'evaluateVariableAsync',
          receiverDeclared,
        });
        value = read.value;
        declared = read.declared;
      }
    } else if (access.kind === 'variable') {
      const read = await evaluateFieldAccessVariable(
        s,
        access,
        value,
        node,
        node.defaultValue !== null || node.existenceCheck !== null,
        receiverDeclared
      );
      value = read.value;
      declared = read.declared;
    } else if (access.kind === 'computed') {
      const read = await evaluateFieldAccessComputed(
        s,
        access,
        value,
        node,
        node.defaultValue !== null || node.existenceCheck !== null,
        receiverDeclared
      );
      value = read.value;
      declared = read.declared;
    } else if (access.kind === 'alternatives') {
      const read = await evaluateFieldAccessAlternatives(
        s,
        access,
        value,
        node,
        node.defaultValue !== null || node.existenceCheck !== null,
        receiverDeclared
      );
      value = read.value;
      declared = read.declared;
    } else if (access.kind === 'annotation') {
      // Annotation reflection: .^key
      // Delegates to evaluateAnnotationAccess from methods.ts
      // Convert RUNTIME_UNDEFINED_ANNOTATION to null ONLY if defaultValue exists (for ?? coalescing)
      try {
        value = await evaluateAnnotationAccess(
          s,
          value,
          access.key,
          getNodeLocation(s, node),
          receiverDeclared
        );
      } catch (e) {
        // evaluateAnnotationAccess throws RuntimeHaltSignal with atom RILL_R008
        // instead of RuntimeError. Both forms are accepted so ?? coalescing
        // works in variable access chains.
        const isR008 =
          (e instanceof RuntimeError && e.errorId === ERROR_IDS.RILL_R008) ||
          (e instanceof RuntimeHaltSignal &&
            atomName(getStatus(e.value).code) ===
              ERROR_ATOMS[ERROR_IDS.RILL_R008]);
        if (isR008 && node.defaultValue !== null) {
          // Convert missing annotation to null for ?? coalescing
          value = null;
        } else {
          // No default value or different error: re-throw
          throw e;
        }
      }
    } else {
      // Other field access types (block)
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateVariableAsync',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Field access kind '${access.kind}' not yet supported`
      );
    }
  }

  // Handle existence check (.?field): return boolean instead of value
  if (node.existenceCheck) {
    // value now contains the result of the access chain (without the final field)
    return {
      value: await evaluateExistenceCheck(s, value, node.existenceCheck, node),
      declared: undefined,
    };
  }

  // apply default value when the final result is
  // vacant (empty OR invalid). `??` fires on vacancy so an invalid
  // LHS also routes to the default branch.
  //
  // When an access chain was applied, the vacancy predicate covers
  // the full partition (null, empty, or invalid).
  //
  // When no access chain was applied, the variable itself is the
  // result and may be consumed as a pipe target by
  // `evaluatePipeTarget`. In pipe-target position the dispatcher
  // consumes `target.defaultValue` as a dispatch fallback (
  // empty list dispatch returns default via the dispatcher). For
  // that path to work, we must return the empty collection here —
  // not short-circuit to the default branch — so the dispatcher can
  // reach its own default-handling. We therefore widen the bare
  // trigger to cover null OR invalid (the bare-invalid case),
  // but leave empty-valid collections for the dispatcher to handle.
  if (node.defaultValue) {
    const trigger =
      node.accessChain.length > 0
        ? isVacant(value)
        : node.isPipeTarget === true
          ? value === null || isInvalid(value)
          : isVacant(value);
    if (trigger) {
      return {
        value: await evaluateBody(s, node.defaultValue),
        declared: undefined,
      };
    }
  }

  return { value, declared };
}

/**
 * Evaluate capture: :> $name
 * Handles capture syntax which assigns the piped value to a variable.
 * Calls setVariable for type checking and fires observability callback.
 */
async function evaluateCapture(
  s: EvalState,
  node: CaptureNode,
  input: RillValue,
  declared?: TypeStructure
): Promise<RillValue> {
  if (node.typeRef !== null) {
    // Resolve TypeRef and validate against the declared type
    const resolved = await resolveTypeRef(
      s,
      node.typeRef,
      (name: string) => getVariable(s.ctx, name),
      node.span.start
    );
    setVariable(
      s,
      node.name,
      input,
      resolved.structure,
      node.span.start,
      declared
    );
  } else {
    setVariable(s, node.name, input, undefined, node.span.start, declared);
  }
  s.ctx.observability.onCapture?.({ name: node.name, value: input });
  return input;
}

/**
 * Handle statement capture (public API wrapper).
 * Returns capture info if a capture occurred.
 */
export async function handleCapture(
  s: EvalState,
  capture: CaptureNode | null,
  value: RillValue,
  declared?: TypeStructure
): Promise<{ name: string; value: RillValue } | undefined> {
  if (!capture) return undefined;

  await evaluateCapture(s, capture, value, declared);
  return { name: capture.name, value };
}
