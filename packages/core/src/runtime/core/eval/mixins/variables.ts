/**
 * VariablesMixin: Variable Access and Mutation
 *
 * Handles variable access, mutation, and capture operations:
 * - Variable lookup with scope chain traversal
 * - Variable assignment with type checking
 * - Capture syntax (:> $name)
 *
 * LIMITATIONS:
 * - Property access chains ($data.field[0]) require AccessMixin
 * - Existence checks (.?field) require AccessMixin
 * - Default values ($data ?? default) require AccessMixin or ControlFlowMixin
 *
 * Interface requirements (from spec):
 * - setVariable(name, value, explicitType?, location?) -> void
 * - evaluateVariable(node) -> RillValue
 * - evaluateVariableAsync(node) -> Promise<RillValue>
 * - evaluateCapture(node, input) -> RillValue
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - context utilities: getVariable, hasVariable
 *
 * Extended by:
 * - AccessMixin: Will add property chain evaluation to evaluateVariableAsync
 *
 * Error Handling:
 * - Undefined variables throw RuntimeError(RUNTIME_UNDEFINED_VARIABLE) [EC-8]
 * - Type mismatches throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-9]
 *
 * @internal
 */

import type {
  VariableNode,
  CaptureNode,
  RillTypeName,
  SourceLocation,
  ExpressionNode,
  MethodCallNode,
} from '../../../../types.js';
import { RuntimeError, isPipeChainNode } from '../../../../types.js';
import type { TypeStructure, RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTypeValue } from '../../types/guards.js';
import { formatStructure, structureMatches } from '../../types/operations.js';
import { getVariable, hasVariable } from '../../context.js';
import { isDict, isCallable } from '../../callable.js';
import { isVacant, isInvalid, getStatus } from '../../types/status.js';
import { atomName } from '../../types/atom-registry.js';
import {
  RuntimeHaltSignal,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { EvalState } from '../state.js';
import { accessHaltGateFast } from './access.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, accessDictField } from '../shared.js';
import { evaluateBody } from './control-flow.js';
import { evaluatePipeChain } from './core.js';
import {
  evaluateParamsProperty,
  evaluateMethod,
  evaluateAnnotationAccess,
} from './closures.js';
import { resolveTypeRef } from './types.js';

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
  explicitType?: RillTypeName | TypeStructure,
  location?: SourceLocation
): void {
  const valueType = inferType(value);

  // Check explicit type annotation matches value.
  // When explicitType is an object (RillType), use structural matching.
  // When explicitType is a string (RillTypeName), use inferType comparison.
  // 'any' type bypasses type checking: accepts any value by definition.
  if (explicitType !== undefined) {
    if (typeof explicitType === 'object') {
      // Structural type check
      if (!structureMatches(value, explicitType)) {
        const expectedLabel = formatStructure(explicitType);
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
    } else if (explicitType !== 'any' && explicitType !== valueType) {
      // String (RillTypeName) type check
      throwCatchableHostHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'setVariable' },
        ERROR_ATOMS[ERROR_IDS.RILL_R001],
        `Type mismatch: cannot assign ${valueType} to $${name}:${explicitType}`,
        {
          variableName: name,
          expectedType: explicitType,
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
      // Structural locked type — validate full shape
      if (!structureMatches(value, lockedType)) {
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
    // Store structural type (object) directly so re-assignment checks
    // validate the full shape. Fall back to valueType when no annotation.
    const lockType: RillTypeName | TypeStructure =
      explicitType !== undefined ? explicitType : (valueType as RillTypeName);
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
  if (node.isPipeVar && !node.name) {
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
  if (node.name) {
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
  throwCatchableHostHalt(
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
 * Evaluate variable access asynchronously.
 * Async variant that supports access chains ($.field, $var.field).
 *
 * Handles property access chains and default values.
 */
export async function evaluateVariableAsync(
  s: EvalState,
  node: VariableNode
): Promise<RillValue> {
  // Get base value ($ or $name)
  let value: RillValue;

  if (node.isPipeVar && !node.name) {
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
  } else if (node.name) {
    // Named variable ($name)
    const result = getVariable(s.ctx, node.name);
    if (result === undefined) {
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
    // AC-6 / FR-ERR-4: `??` widens from `=== null` to `isVacant(value)`.
    // Vacancy fires the default branch for empty OR invalid values; an
    // invalid LHS with a default short-circuits instead of halting.
    if (isVacant(value)) {
      // Use default value if available
      if (node.defaultValue) {
        return evaluateBody(s, node.defaultValue);
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
    }

    // Check if this is a bracket access
    if ('accessKind' in access) {
      // Bracket access: [expr]. This expression is parsed inline while
      // building a live access chain (never via the statement-level
      // recovery path), so it only ever holds a PipeChainNode;
      // PartialExpressionNode is reserved for parser error recovery.
      if (!isPipeChainNode(access.expression)) {
        throwFatalHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateVariableAsync',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Bracket access expression must be a pipe chain'
        );
      }
      const indexValue = await evaluatePipeChain(s, access.expression);

      if (Array.isArray(value)) {
        if (typeof indexValue !== 'number') {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateVariableAsync',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `List index must be number, got ${inferType(indexValue)}`
          );
        }
        let index = indexValue;
        // Handle negative indices
        if (index < 0) {
          index = value.length + index;
        }
        const result = value[index];
        if (result === undefined) {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateVariableAsync',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R009],
            `List index out of bounds: ${indexValue}`
          );
        }
        value = result;
      } else if (isDict(value)) {
        if (typeof indexValue !== 'string') {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateVariableAsync',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Dict key must be string, got ${inferType(indexValue)}`
          );
        }
        const result = (value as Record<string, RillValue>)[indexValue];
        if (result === undefined) {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateVariableAsync',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R009],
            `Undefined dict key: ${indexValue}`
          );
        }
        value = result;
      } else {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateVariableAsync',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Cannot index ${inferType(value)}`
        );
      }
      continue;
    }

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
          span: node.span,
        };
        value = await evaluateMethod(s, methodNode, value);
      } else if (isTypeValue(value)) {
        if (field === 'name') {
          value = value.typeName;
        } else if (field === 'signature') {
          value = formatStructure(value.structure);
        } else {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateVariableAsync',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R003],
            `Type value has no property "${field}"`
          );
        }
      } else if (isDict(value)) {
        // Allow missing fields if there's a default value or existence check
        const allowMissing =
          node.defaultValue !== null || node.existenceCheck !== null;
        value = await accessDictField(
          s,
          value,
          field,
          getNodeLocation(s, node),
          allowMissing
        );
      } else {
        value = null;
      }
    } else if (access.kind === 'variable') {
      value = await evaluateFieldAccessVariable(s, access, value, node);
    } else if (access.kind === 'computed') {
      value = await evaluateFieldAccessComputed(s, access, value, node);
    } else if (access.kind === 'alternatives') {
      value = await evaluateFieldAccessAlternatives(s, access, value, node);
    } else if (access.kind === 'annotation') {
      // Annotation reflection: .^key
      // Delegates to evaluateAnnotationAccess from ClosuresMixin
      // Convert RUNTIME_UNDEFINED_ANNOTATION to null ONLY if defaultValue exists (for ?? coalescing)
      try {
        value = await evaluateAnnotationAccess(
          s,
          value,
          access.key,
          getNodeLocation(s, node)
        );
      } catch (e) {
        // After the Phase 2 halt-builder migration, evaluateAnnotationAccess
        // throws RuntimeHaltSignal with atom RILL_R008 instead of RuntimeError.
        // Both forms are accepted so ?? coalescing works in variable access chains.
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
    // Check if the final field exists in value
    const finalAccess = node.existenceCheck.finalAccess;
    const typeRef = node.existenceCheck.typeRef;

    // Helper: check type match using structural resolution (EC-4: mismatch returns false)
    const matchesType = async (fieldValue: RillValue): Promise<boolean> => {
      if (typeRef === null) return true;
      const resolved = await resolveTypeRef(
        s,
        typeRef,
        (name: string) => getVariable(s.ctx, name) as RillValue
      );
      return structureMatches(fieldValue, resolved.structure);
    };

    if (finalAccess.kind === 'literal') {
      // Check if literal field exists in dict
      if (isDict(value)) {
        const fieldValue = (value as Record<string, RillValue>)[
          finalAccess.field
        ];
        const exists = fieldValue !== undefined && fieldValue !== null;

        // If type-qualified check, verify type matches
        if (exists && typeRef !== null) {
          return await matchesType(fieldValue);
        }

        return exists;
      }
      return false;
    }

    if (finalAccess.kind === 'variable') {
      // Resolve variable to get key (EC-9)
      let keyValue: RillValue | undefined;
      if (finalAccess.variableName === null) {
        keyValue = s.ctx.pipeValue ?? undefined;
      } else {
        keyValue = getVariable(s.ctx, finalAccess.variableName);
      }

      // EC-9: Variable undefined
      if (keyValue === undefined) {
        const varName = finalAccess.variableName ?? '$';
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateExistenceCheck',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R005],
          `Variable '${varName}' is undefined`
        );
      }

      // Check if key exists in dict or list
      if (isDict(value)) {
        // EC-10: Key variable non-string
        if (typeof keyValue !== 'string') {
          throwCatchableHostHalt(
            {
              location: getNodeLocation(s, node),
              sourceId: s.ctx.sourceId,
              fn: 'evaluateExistenceCheck',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Existence check key must be string, got ${inferType(keyValue)}`
          );
        }

        const fieldValue = (value as Record<string, RillValue>)[keyValue];
        const exists = fieldValue !== undefined && fieldValue !== null;

        // If type-qualified check, verify type matches
        if (exists && typeRef !== null) {
          return await matchesType(fieldValue);
        }

        return exists;
      }

      if (Array.isArray(value)) {
        if (typeof keyValue === 'number') {
          const index = keyValue < 0 ? value.length + keyValue : keyValue;
          return index >= 0 && index < value.length;
        }
        return false;
      }

      return false;
    }

    if (finalAccess.kind === 'computed') {
      // Evaluate the computed expression. Parsed inline while
      // building a live access chain (never via the statement-level
      // recovery path), so it only ever holds a PipeChainNode;
      // PartialExpressionNode is reserved for parser error recovery.
      if (!isPipeChainNode(finalAccess.expression)) {
        throwFatalHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateExistenceCheck',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Existence check computed key expression must be a pipe chain'
        );
      }
      const keyValue = await evaluatePipeChain(s, finalAccess.expression);

      // EC-11: Computed key non-string
      if (typeof keyValue !== 'string') {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateExistenceCheck',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Existence check key evaluated to ${inferType(keyValue)}, expected string`
        );
      }

      // Check if computed key exists in dict
      if (isDict(value)) {
        const fieldValue = (value as Record<string, RillValue>)[keyValue];
        const exists = fieldValue !== undefined && fieldValue !== null;

        // If type-qualified check, verify type matches
        if (exists && typeRef !== null) {
          return await matchesType(fieldValue);
        }

        return exists;
      }

      return false;
    }

    // For other access kinds (block, alternatives, annotation), not supported
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateExistenceCheck',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Existence check not yet supported for ${finalAccess.kind} access`
    );
  }

  // AC-6 / FR-ERR-4: apply default value when the final result is
  // vacant (empty OR invalid). `??` fires on vacancy so an invalid
  // LHS also routes to the default branch per GF-25.
  //
  // When an access chain was applied, the vacancy predicate covers
  // the full partition (null, empty, or invalid).
  //
  // When no access chain was applied, the variable itself is the
  // result and may be consumed as a pipe target by
  // `evaluatePipeTarget`. In pipe-target position the dispatcher
  // consumes `target.defaultValue` as a dispatch fallback (AC-19:
  // empty list dispatch returns default via the dispatcher). For
  // that path to work, we must return the empty collection here —
  // not short-circuit to the default branch — so the dispatcher can
  // reach its own default-handling. We therefore widen the bare
  // trigger to cover null OR invalid (FR-ERR-4's bare-invalid case),
  // but leave empty-valid collections for the dispatcher to handle.
  if (node.defaultValue) {
    const trigger =
      node.accessChain.length > 0
        ? isVacant(value)
        : node.isPipeTarget
          ? value === null || isInvalid(value)
          : isVacant(value);
    if (trigger) {
      return evaluateBody(s, node.defaultValue);
    }
  }

  return value;
}

/**
 * Evaluate field access using a variable as the key.
 * Resolves variable by name and uses resulting string/number as dict field or list index.
 *
 * @param s - Evaluator state
 * @param access - The field access node with variable name
 * @param value - The current value being accessed (dict or list)
 * @param node - The parent variable node for location info
 * @returns The field/element value or null if missing
 * @throws RuntimeError if variable undefined or wrong type (EC-1, EC-2, EC-3)
 */
export async function evaluateFieldAccessVariable(
  s: EvalState,
  access: {
    readonly kind: 'variable';
    readonly variableName: string | null;
  },
  value: RillValue,
  node: VariableNode
): Promise<RillValue> {
  // Resolve the variable (EC-1)
  let keyValue: RillValue | undefined;
  if (access.variableName === null) {
    // .$ (pipe variable as key)
    keyValue = s.ctx.pipeValue ?? undefined;
    if (keyValue === undefined) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateFieldAccessVariable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Pipe variable '$' is undefined`
      );
    }
  } else {
    // .$variable (named variable as key)
    keyValue = getVariable(s.ctx, access.variableName);
    if (keyValue === undefined) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateFieldAccessVariable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Variable '${access.variableName}' is undefined`
      );
    }
  }

  // Validate key type (EC-2, EC-3)
  if (typeof keyValue === 'boolean') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessVariable',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Key must be string or number, got bool`
    );
  }
  if (Array.isArray(keyValue)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessVariable',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Key must be string or number, got list`
    );
  }

  // Handle string key (dict access)
  if (typeof keyValue === 'string') {
    if (isDict(value)) {
      // Allow missing fields to return null
      return await accessDictField(
        s,
        value,
        keyValue,
        getNodeLocation(s, node),
        true
      );
    }
    return null;
  }

  // Handle number key (list access)
  if (typeof keyValue === 'number') {
    if (Array.isArray(value)) {
      let index = keyValue;
      // Handle negative indices
      if (index < 0) {
        index = value.length + index;
      }
      const result = value[index];
      // Return null for out of bounds (use allowMissing pattern)
      return result !== undefined ? result : null;
    }
    return null;
  }

  // Other types (dict, closure) - fall through to type error
  throwCatchableHostHalt(
    {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'evaluateFieldAccessVariable',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Key must be string or number, got ${inferType(keyValue)}`
  );
}

/**
 * Evaluate field access using a computed expression as the key.
 * Evaluates expression and uses resulting string/number as dict field or list index.
 *
 * @param s - Evaluator state
 * @param access - The field access node with expression
 * @param value - The current value being accessed (dict or list)
 * @param node - The parent variable node for location info
 * @returns The field/element value or null if missing
 * @throws RuntimeError if expression result is wrong type (EC-4, EC-5)
 */
export async function evaluateFieldAccessComputed(
  s: EvalState,
  access: {
    readonly kind: 'computed';
    readonly expression: ExpressionNode;
  },
  value: RillValue,
  node: VariableNode
): Promise<RillValue> {
  // Evaluate the expression to get the key. Parsed inline while
  // building a live access chain (never via the statement-level
  // recovery path), so it only ever holds a PipeChainNode;
  // PartialExpressionNode is reserved for parser error recovery.
  if (!isPipeChainNode(access.expression)) {
    throwFatalHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Computed field access expression must be a pipe chain'
    );
  }
  const keyValue = await evaluatePipeChain(s, access.expression);

  // EC-4: Expression result is closure
  if (isCallable(keyValue)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to closure, expected string or number`
    );
  }

  // EC-5: Expression result is dict
  if (isDict(keyValue)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to dict, expected string or number`
    );
  }

  // Other invalid types (boolean, list)
  if (typeof keyValue === 'boolean') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to bool, expected string or number`
    );
  }
  if (Array.isArray(keyValue)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to list, expected string or number`
    );
  }

  // Handle string key (dict access)
  if (typeof keyValue === 'string') {
    if (isDict(value)) {
      // Allow missing fields to return null
      return await accessDictField(
        s,
        value,
        keyValue,
        getNodeLocation(s, node),
        true
      );
    }
    return null;
  }

  // Handle number key (list access)
  if (typeof keyValue === 'number') {
    if (Array.isArray(value)) {
      let index = keyValue;
      // Handle negative indices
      if (index < 0) {
        index = value.length + index;
      }
      const result = value[index];
      // Return null for out of bounds (use allowMissing pattern)
      return result !== undefined ? result : null;
    }
    return null;
  }

  // Shouldn't reach here due to exhaustive type checks above
  throwCatchableHostHalt(
    {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'evaluateFieldAccessComputed',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Computed key evaluated to unexpected type`
  );
}

/**
 * Evaluate field access using alternatives (try keys left-to-right).
 * Returns first found value or null if all keys missing.
 *
 * @param s - Evaluator state
 * @param access - The field access node with alternatives array
 * @param value - The current value being accessed (must be dict)
 * @param node - The parent variable node for location info
 * @returns The first found field value or null if all keys missing
 * @throws RuntimeError if target is not dict (EC-6)
 */
export async function evaluateFieldAccessAlternatives(
  s: EvalState,
  access: {
    readonly kind: 'alternatives';
    readonly alternatives: string[];
  },
  value: RillValue,
  node: VariableNode
): Promise<RillValue> {
  // EC-6: Target must be dict
  if (!isDict(value)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessAlternatives',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Alternative access requires dict, got ${inferType(value)}`
    );
  }

  // Try each alternative left-to-right (short-circuit on first match)
  for (const key of access.alternatives) {
    const dictValue = (value as Record<string, RillValue>)[key];
    if (dictValue !== undefined && dictValue !== null) {
      // Use base class method for consistent property-style callable handling
      return await accessDictField(
        s,
        value,
        key,
        getNodeLocation(s, node),
        true
      );
    }
  }

  // All keys missing: return null
  return null;
}

/**
 * Evaluate capture: :> $name
 * Handles capture syntax which assigns the piped value to a variable.
 * Calls setVariable for type checking and fires observability callback.
 */
export async function evaluateCapture(
  s: EvalState,
  node: CaptureNode,
  input: RillValue
): Promise<RillValue> {
  if (node.typeRef !== null) {
    // Resolve TypeRef and validate against the declared type
    const resolved = await resolveTypeRef(
      s,
      node.typeRef,
      (name: string) => getVariable(s.ctx, name) as RillValue
    );
    setVariable(s, node.name, input, resolved.structure, node.span.start);
  } else {
    setVariable(s, node.name, input, undefined, node.span.start);
  }
  s.ctx.observability.onCapture?.({ name: node.name, value: input });
  return input;
}

/**
 * Handle statement capture (public API wrapper).
 * Returns capture info if a capture occurred.
 * This overrides the stub in EvaluatorBase.
 */
export async function handleCapture(
  s: EvalState,
  capture: CaptureNode | null,
  value: RillValue
): Promise<{ name: string; value: RillValue } | undefined> {
  if (!capture) return undefined;

  await evaluateCapture(s, capture, value);
  return { name: capture.name, value };
}
