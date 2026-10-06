/**
 * Field Access Evaluation
 *
 * Evaluates the field-access forms of a variable chain:
 * - Variable key: $data.$key
 * - Computed key: $data.(expr)
 * - Alternatives: $data.(a || b)
 *
 * Called from evaluateVariableAsync in variables.ts.
 *
 * @internal
 */

import type { ExpressionNode, VariableNode } from '../../../../types.js';
import { isPipeChainNode } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isOrdered } from '../../types/guards.js';
import { getVariable } from '../../context.js';
import { isDict, isCallable } from '../../callable.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, accessDictField } from '../shared.js';
import {
  getTypedKey,
  getTypedKeyMap,
  hasTypedKey,
} from '../../types/dict-keys.js';
import { evaluatePipeChain } from './core.js';

/**
 * Evaluate field access using a variable as the key.
 * Resolves variable by name and uses resulting string/number as dict field or list index.
 *
 * @param s - Evaluator state
 * @param access - The field access node with variable name
 * @param value - The current value being accessed (dict or list)
 * @param node - The parent variable node for location info
 * @returns The field/element value or null if missing
 * @throws RuntimeHaltSignal (catchable) if variable undefined or wrong type
 */
export async function evaluateFieldAccessVariable(
  s: EvalState,
  access: {
    readonly kind: 'variable';
    readonly variableName: string | null;
  },
  value: RillValue,
  node: VariableNode,
  allowMissing: boolean
): Promise<RillValue> {
  // Resolve the variable
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

  // Number/boolean keys on a dict that carries a typed-key sidecar resolve
  // against it, mirroring the bracket-access path. A dict with no typed keys
  // falls through to the string-key rules below, so a boolean key on a plain
  // dict still halts with the key-type error.
  if (
    isDict(value) &&
    (typeof keyValue === 'number' || typeof keyValue === 'boolean') &&
    getTypedKeyMap(value) !== undefined
  ) {
    if (!hasTypedKey(value, keyValue)) {
      if (allowMissing) {
        return null;
      }
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateFieldAccessVariable',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        `Undefined dict key: ${keyValue}`
      );
    }
    return getTypedKey(value, keyValue) as RillValue;
  }

  // Validate key type
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
    // Non-dict target with a permissive access resolves to null; otherwise
    // accessDictField halts with the non-dict / missing-field error, matching
    // literal field access.
    if (!isDict(value) && allowMissing) {
      return null;
    }
    return await accessDictField(
      s,
      value,
      keyValue,
      getNodeLocation(s, node),
      allowMissing
    );
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
      if (result === undefined) {
        // Out of bounds. Halt unless a default / existence check permits null.
        if (allowMissing) {
          return null;
        }
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateFieldAccessVariable',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `List index out of bounds: ${keyValue}`
        );
      }
      return result;
    }
    if (isOrdered(value)) {
      const entries = value.entries;
      let index = keyValue;
      if (index < 0) {
        index = entries.length + index;
      }
      const entry = entries[index];
      if (entry === undefined) {
        if (allowMissing) {
          return null;
        }
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateFieldAccessVariable',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `Ordered index out of bounds: ${keyValue}`
        );
      }
      return entry[1];
    }
    // Number key on a non-list target.
    if (allowMissing) {
      return null;
    }
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessVariable',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot index ${inferType(value)}`
    );
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
 * @throws RuntimeHaltSignal (catchable or fatal) if expression result is
 *   the wrong type
 */
export async function evaluateFieldAccessComputed(
  s: EvalState,
  access: {
    readonly kind: 'computed';
    readonly expression: ExpressionNode;
  },
  value: RillValue,
  node: VariableNode,
  allowMissing: boolean
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

  // Expression result is closure
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

  // Expression result is dict
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

  // Number/boolean keys on a dict that carries a typed-key sidecar resolve
  // against it, mirroring the bracket-access path. A dict with no typed keys
  // falls through to the existing key-type rules below.
  if (
    isDict(value) &&
    (typeof keyValue === 'number' || typeof keyValue === 'boolean') &&
    getTypedKeyMap(value) !== undefined
  ) {
    if (!hasTypedKey(value, keyValue)) {
      if (allowMissing) {
        return null;
      }
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateFieldAccessComputed',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        `Undefined dict key: ${keyValue}`
      );
    }
    return getTypedKey(value, keyValue) as RillValue;
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
    // Non-dict target with a permissive access resolves to null; otherwise
    // accessDictField halts with the non-dict / missing-field error, matching
    // literal field access.
    if (!isDict(value) && allowMissing) {
      return null;
    }
    return await accessDictField(
      s,
      value,
      keyValue,
      getNodeLocation(s, node),
      allowMissing
    );
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
      if (result === undefined) {
        // Out of bounds. Halt unless a default / existence check permits null.
        if (allowMissing) {
          return null;
        }
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateFieldAccessComputed',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `List index out of bounds: ${keyValue}`
        );
      }
      return result;
    }
    if (isOrdered(value)) {
      const entries = value.entries;
      let index = keyValue;
      if (index < 0) {
        index = entries.length + index;
      }
      const entry = entries[index];
      if (entry === undefined) {
        if (allowMissing) {
          return null;
        }
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateFieldAccessComputed',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R009],
          `Ordered index out of bounds: ${keyValue}`
        );
      }
      return entry[1];
    }
    // Number key on a non-list target.
    if (allowMissing) {
      return null;
    }
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateFieldAccessComputed',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot index ${inferType(value)}`
    );
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
 * @throws RuntimeHaltSignal (catchable) if target is not dict
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
  // Target must be dict
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
    const dictValue = Object.hasOwn(value, key)
      ? (value as Record<string, RillValue>)[key]
      : undefined;
    if (dictValue !== undefined && dictValue !== null) {
      // Delegate to accessDictField (shared.ts) for consistent property-style callable handling
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
