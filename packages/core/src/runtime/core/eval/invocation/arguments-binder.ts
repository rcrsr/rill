/**
 * ArgumentsBinder: Stateless argument-to-parameter binding
 *
 * Produces a BoundArguments map from a list of argument nodes and a callable's
 * parameter metadata. This is Phase 1 of the two-phase invocation system.
 * Phase 2 (marshalling) runs via marshalArgs in callable.ts and remains unchanged.
 *
 * ## Responsibilities
 * - Detect spread arguments (single owner of spread detection)
 * - Validate spread constraints (untyped builtin, extra positional, null source)
 * - Produce BoundArguments map for downstream marshalling
 * - Return pre-allocated empty sentinel for zero-arg or non-spread calls
 *
 * ## Error Cases
 * - EC-1: Spread on untyped builtin → RILL-R001 (message matches closures.ts:1079)
 * - EC-2: Extra positional argument → RILL-R001 (message matches closures.ts:1893)
 * - EC-3: Null spread source → RILL-R001 (message matches closures.ts:1912)
 * - EC-4: Spread value not tuple/dict/ordered → RILL-R001
 * - EC-5: Dict spread key matches no parameter → RILL-R001
 * - EC-6: Ordered spread key-order mismatch → RILL-R001
 * - EC-7: Duplicate binding → RILL-R001
 * - EC-11: ApplicationCallable with undefined params → RILL-R001
 *
 * ## Implementation Notes
 *
 * [SPEC] IR-1 signature omits evaluateExpression callback.
 * Spec: `bind(args, callable, pipeInput, location) => Promise<BoundArguments>`
 * Actual: `bind(args, callable, pipeInput, evaluate, location) => Promise<BoundArguments>`
 * Rationale: args are AST nodes requiring evaluation. A stateless class with no context
 * dependency must receive evaluateExpression as an explicit callback parameter. The pipeInput
 * parameter is kept as specified; the caller is responsible for applying it to ctx before
 * constructing the evaluate callback, preserving save/restore semantics.
 *
 * @internal
 */

import type {
  ExpressionNode,
  SpreadArgNode,
  SourceLocation,
} from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { RillCallable, ApplicationCallable } from '../../callable.js';
import {
  isApplicationCallable,
  isRuntimeCallable,
  isDict,
} from '../../callable.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTuple, isOrdered } from '../../types/guards.js';

// ============================================================
// BOUND ARGUMENTS
// ============================================================

/**
 * Result of ArgumentsBinder.bind: parameter names mapped to evaluated values.
 *
 * Only explicitly bound parameters are present (positional, tuple, ordered,
 * or dict spread). Missing parameters are absent from the map; callers pass
 * undefined for them, and marshalArgs handles defaults and required checks.
 *
 * Phase 2 integration: callers convert this to a positional RillValue[] via
 *   params.map(p => bound.params.get(p.name)!)
 * and pass that to marshalArgs stages 2-3 (skipping stage 1 excess check,
 * which bind handles differently via per-source arity validation).
 */
export interface BoundArguments {
  readonly params: Map<string, RillValue>;
}

// Pre-allocated empty sentinel: returned for zero-arg calls and non-spread paths.
// Callers must not mutate this object.
const EMPTY_BOUND_ARGUMENTS: BoundArguments = Object.freeze({
  params: new Map<string, RillValue>(),
});

// ============================================================
// ARGUMENTS BINDER
// ============================================================

/**
 * Stateless argument binder.
 *
 * No instance fields. No context dependency. All state is passed via parameters.
 * Instantiate once and reuse across calls.
 */
export class ArgumentsBinder {
  /**
   * Returns true when any argument in the list is a spread arg.
   *
   * Single owner of `args.some(a => a.type === 'SpreadArg')`.
   * Phase 2 callers use this to decide whether to invoke bind.
   */
  hasSpread(args: (ExpressionNode | SpreadArgNode)[]): boolean {
    return args.some((a) => a.type === 'SpreadArg');
  }

  /**
   * Bind arguments to callable parameters.
   *
   * Returns the pre-allocated empty sentinel when:
   * - args.length === 0
   * - No spread is present (non-spread path; normal marshalArgs handles the rest)
   *
   * Allocates and populates BoundArguments only when spread is present.
   *
   * @param args - Argument nodes from the call site
   * @param callable - Resolved callable with parameter metadata
   * @param _pipeInput - Active pipe value ($ in expressions); reserved for future use.
   *   Caller is responsible for applying pipeInput to ctx before constructing evaluate.
   * @param evaluate - Expression evaluator; caller sets pipeInput on ctx before passing
   * @param location - Call-site source location for error reporting
   */
  async bind(
    args: (ExpressionNode | SpreadArgNode)[],
    callable: RillCallable,
    _pipeInput: RillValue | undefined,
    evaluate: (node: ExpressionNode) => Promise<RillValue>,
    location: SourceLocation
  ): Promise<BoundArguments> {
    // AC-14: zero args — return sentinel with no allocation
    if (args.length === 0) {
      return EMPTY_BOUND_ARGUMENTS;
    }

    // AC-15: non-spread path — return sentinel; marshalArgs handles normal arg passing
    if (!this.hasSpread(args)) {
      return EMPTY_BOUND_ARGUMENTS;
    }

    // EC-11: ApplicationCallable with undefined params (e.g. created via callable() helper)
    // has no param metadata. Emit "parameter metadata required" to match baseline behavior.
    // Must be checked before the isUntypedBuiltin (empty params) branch.
    if (
      isApplicationCallable(callable as RillValue) &&
      ((callable as ApplicationCallable).params as unknown) === undefined
    ) {
      const name = _getCallableName(callable);
      throwCatchableHostHalt(
        { location, fn: 'bind' },
        'RILL_R001',
        `Spread not supported for host function '${name}': parameter metadata required`
      );
    }

    // EC-1: Spread on untyped builtin — ApplicationCallable with empty params array.
    // Message matches closures.ts:1079 verbatim.
    const isUntypedBuiltin =
      isRuntimeCallable(callable as RillValue) ||
      (isApplicationCallable(callable as RillValue) &&
        ((callable as ApplicationCallable).params?.length ?? 0) === 0);

    if (isUntypedBuiltin) {
      const name = _getCallableName(callable);
      throwCatchableHostHalt(
        { location, fn: 'bind' },
        'RILL_R001',
        `Spread not supported for built-in function '${name}'`
      );
    }

    const params = callable.params as readonly { name: string }[];
    const bound = new Map<string, RillValue>();

    // Positional index: next unbound parameter position
    let positionalIndex = 0;

    for (const argNode of args) {
      if (argNode.type !== 'SpreadArg') {
        // Positional argument
        const param = params[positionalIndex];
        if (param === undefined) {
          // EC-2: extra positional arg beyond param count.
          // Message matches closures.ts:1893 verbatim.
          throwCatchableHostHalt(
            { location, fn: 'bind' },
            'RILL_R001',
            `Extra positional argument at position ${positionalIndex} (function has ${params.length} parameters)`
          );
        }
        const value = await evaluate(argNode);
        bound.set(param.name, value);
        positionalIndex++;
      } else {
        // SpreadArg: evaluate the spread expression
        const spreadValue = await evaluate(argNode.expression);

        // EC-3: spread source is null (bare ... with no pipe value).
        // Message matches closures.ts:1912 verbatim.
        if (spreadValue === null) {
          throwCatchableHostHalt(
            { location, fn: 'bind' },
            'RILL_R001',
            'Spread requires an active pipe value ($)'
          );
        }

        // Dispatch by type: isOrdered BEFORE isDict per spec (IC-3 algorithm step 2)
        if (isTuple(spreadValue)) {
          // Tuple: fill remaining params positionally LTR (EC-9)
          const tupleEntries = spreadValue.entries;
          const remaining = params.length - positionalIndex;
          if (tupleEntries.length > remaining) {
            throwCatchableHostHalt(
              { location, fn: 'bind' },
              'RILL_R001',
              `Spread tuple has ${tupleEntries.length} values but only ${remaining} parameter(s) remain`
            );
          }
          for (let i = 0; i < tupleEntries.length; i++) {
            const param = params[positionalIndex + i]!;
            // EC-7: duplicate binding
            if (bound.has(param.name)) {
              throwCatchableHostHalt(
                { location, fn: 'bind' },
                'RILL_R001',
                `Duplicate binding for parameter '${param.name}': already bound positionally`
              );
            }
            bound.set(param.name, tupleEntries[i]!);
          }
          positionalIndex += tupleEntries.length;
        } else if (isOrdered(spreadValue)) {
          // Ordered: match key by name AND position
          const orderedEntries = spreadValue.entries;
          for (let i = 0; i < orderedEntries.length; i++) {
            const [key, value] = orderedEntries[i]!;
            const expectedParam = params[positionalIndex + i];
            // EC-6: key-order mismatch
            if (expectedParam === undefined || expectedParam.name !== key) {
              const expectedName = expectedParam?.name ?? '<none>';
              throwCatchableHostHalt(
                { location, fn: 'bind' },
                'RILL_R001',
                `Ordered spread key '${key}' at position ${i} does not match expected parameter '${expectedName}' at position ${positionalIndex + i}`
              );
            }
            // EC-7: duplicate binding
            if (bound.has(key)) {
              throwCatchableHostHalt(
                { location, fn: 'bind' },
                'RILL_R001',
                `Duplicate binding for parameter '${key}': already bound positionally`
              );
            }
            bound.set(key, value);
          }
          positionalIndex += orderedEntries.length;
        } else if (isDict(spreadValue)) {
          // Dict: match each key to param by name (order irrelevant)
          const dictValue = spreadValue as Record<string, RillValue>;
          const paramNames = new Set(params.map((p) => p.name));
          for (const [key, value] of Object.entries(dictValue)) {
            // EC-5: key matches no parameter
            if (!paramNames.has(key)) {
              const validParams = params.map((p) => p.name).join(', ');
              throwCatchableHostHalt(
                { location, fn: 'bind' },
                'RILL_R001',
                `Dict spread key '${key}' does not match any parameter. Valid parameters: ${validParams}`
              );
            }
            // EC-7: duplicate binding
            if (bound.has(key)) {
              throwCatchableHostHalt(
                { location, fn: 'bind' },
                'RILL_R001',
                `Duplicate binding for parameter '${key}': already bound positionally`
              );
            }
            bound.set(key, value);
          }
        } else {
          // EC-4: spread value is not tuple/dict/ordered
          const actualType = inferType(spreadValue);
          throwCatchableHostHalt(
            { location, fn: 'bind' },
            'RILL_R001',
            `Spread requires a tuple, dict, or ordered value, got ${actualType}`
          );
        }
      }
    }

    return { params: bound };
  }
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Get a display name from a callable for use in error messages.
 * Returns the JS function name when available, '<anonymous>' otherwise.
 */
function _getCallableName(callable: RillCallable): string {
  if (isApplicationCallable(callable as RillValue)) {
    const fn = (callable as ApplicationCallable).fn;
    return fn.name !== '' ? fn.name : '<anonymous>';
  }
  if (isRuntimeCallable(callable as RillValue)) {
    const fn = (callable as import('../../callable.js').RuntimeCallable).fn;
    return fn.name !== '' ? fn.name : '<anonymous>';
  }
  return '<anonymous>';
}
