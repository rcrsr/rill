/**
 * Annotated Statement Execution
 *
 * Provides statement execution wrapper with annotation handling.
 * Annotations modify execution behavior (e.g., iteration limits).
 *
 * Interface requirements (from spec IR-53 through IR-55):
 * - executeStatement(stmt) -> Promise<RillValue> [IR-53]
 * - getAnnotation(key) -> RillValue | undefined [IR-54]
 * - getIterationLimit() -> number [IR-55]
 *
 * Error Handling:
 * - Annotated statement execution errors propagate [EC-25]
 * - Annotation evaluation errors propagate [EC-26]
 *
 * @internal
 */

import type {
  StatementNode,
  AnnotatedStatementNode,
  AnnotationArg,
  NamedArgNode,
  SpreadArgNode,
} from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { isCallable } from '../../callable.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { evaluateExpression } from './core.js';
import { checkAutoExceptions } from '../shared.js';

/** Default maximum loop iterations */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * Execute statement with annotation handling [IR-53].
 *
 * Handles both regular and annotated statements.
 * For annotated statements, evaluates annotations, pushes to stack,
 * executes inner statement, and pops annotations.
 *
 * Special: this is the executeStatement entry point. Its class-level
 * delegate stays a one-line call into this module function; it is never
 * inlined into eval/index.ts.
 */
export async function executeStatement(
  s: EvalState,
  stmt: StatementNode | AnnotatedStatementNode
): Promise<RillValue> {
  // Handle annotated statements
  if (stmt.type === 'AnnotatedStatement') {
    return executeAnnotatedStatement(s, stmt);
  }

  // Regular statement: evaluate expression
  const value = await evaluateExpression(s, stmt.expression);

  // Note: Do NOT set ctx.pipeValue = value here.
  // Statements don't propagate $ to siblings. $ flows only via explicit ->.
  checkAutoExceptions(s, value, stmt);

  // Terminator handling is now inside PipeChainNode evaluation
  // (evaluatePipeChain handles capture/break/return terminators)

  return value;
}

/**
 * Execute an annotated statement.
 * Evaluates annotations, pushes them to the stack, executes the inner statement,
 * and pops the annotations.
 *
 * Errors during annotation evaluation or statement execution propagate.
 */
export async function executeAnnotatedStatement(
  s: EvalState,
  stmt: AnnotatedStatementNode
): Promise<RillValue> {
  // Evaluate annotation arguments to build annotation dict [EC-26]
  const newAnnotations = await evaluateAnnotations(s, stmt.annotations);

  // No inheritance: use only the annotations declared on this statement [IR-7]
  const merged = newAnnotations;

  // Set immediateAnnotation for closure capture before pushing to stack
  s.ctx.immediateAnnotation = newAnnotations;

  // Push annotations, execute inner statement, pop
  s.ctx.annotationStack.push(merged);
  try {
    return await executeStatement(s, stmt.statement);
  } finally {
    s.ctx.annotationStack.pop();
    s.ctx.immediateAnnotation = undefined;
  }
}

/**
 * Evaluate annotation arguments to a dict of key-value pairs.
 * Handles both named arguments and spread arguments.
 *
 * Errors during evaluation propagate [EC-26].
 */
export async function evaluateAnnotations(
  s: EvalState,
  annotations: AnnotationArg[]
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};

  for (const arg of annotations) {
    if (arg.type === 'NamedArg') {
      const namedArg = arg as NamedArgNode;
      result[namedArg.name] = await evaluateExpression(s, namedArg.value);
    } else {
      // SpreadArg: spread tuple/dict keys as annotations
      const spreadArg = arg as SpreadArgNode;
      const spreadValue = await evaluateExpression(s, spreadArg.expression);

      if (
        typeof spreadValue === 'object' &&
        spreadValue !== null &&
        !Array.isArray(spreadValue) &&
        !isCallable(spreadValue)
      ) {
        // Dict: spread all key-value pairs
        Object.assign(result, spreadValue);
      } else if (Array.isArray(spreadValue)) {
        // Tuple/list: not valid for annotations (need named keys)
        throwCatchableHostHalt(
          {
            location: spreadArg.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateAnnotations',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Annotation spread requires dict with named keys, got list'
        );
      } else {
        throwCatchableHostHalt(
          {
            location: spreadArg.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateAnnotations',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Annotation spread requires dict, got ${typeof spreadValue}`
        );
      }
    }
  }

  return result;
}

/**
 * Get the current value of an annotation from the annotation stack [IR-54].
 *
 * Returns the value from the top of the annotation stack (innermost scope).
 */
export function getAnnotation(
  s: EvalState,
  key: string
): RillValue | undefined {
  return s.ctx.annotationStack.at(-1)?.[key];
}

/**
 * Get the iteration limit for loops from operator-level annotations [IR-55, IR-6].
 *
 * Reads from the provided operator-level annotations dict when given.
 * Falls back to DEFAULT_MAX_ITERATIONS when no valid positive number is found.
 * Statement-level annotationStack is NOT consulted (EC-5).
 *
 * @param operatorAnnotations - Evaluated operator-level annotations (from node.annotations)
 */
export function getIterationLimit(
  _s: EvalState,
  operatorAnnotations?: Record<string, RillValue>
): number {
  const limit = operatorAnnotations?.['limit'];
  if (typeof limit === 'number' && limit > 0) {
    return Math.floor(limit);
  }
  return DEFAULT_MAX_ITERATIONS;
}
