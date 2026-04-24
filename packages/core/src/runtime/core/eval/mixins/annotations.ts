/**
 * AnnotationsMixin: Annotated Statement Execution
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
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { isCallable } from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';

/** Default maximum loop iterations */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * AnnotationsMixin implementation.
 *
 * Provides methods for handling annotated statements and retrieving
 * annotation values from the context stack.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation(), checkAutoExceptions()
 * - CoreMixin: evaluateExpression()
 *
 * Methods added:
 * - executeStatement(stmt) -> Promise<RillValue>
 * - getAnnotation(key) -> RillValue | undefined
 * - getIterationLimit() -> number
 */
function createAnnotationsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class AnnotationsEvaluator extends Base {
    /**
     * Execute statement with annotation handling [IR-53].
     *
     * Handles both regular and annotated statements.
     * For annotated statements, evaluates annotations, pushes to stack,
     * executes inner statement, and pops annotations.
     */
    async executeStatement(
      stmt: StatementNode | AnnotatedStatementNode
    ): Promise<RillValue> {
      // Handle annotated statements
      if (stmt.type === 'AnnotatedStatement') {
        return this.executeAnnotatedStatement(stmt);
      }

      // Regular statement: evaluate expression
      const value = await (
        this as unknown as EvaluatorInterface
      ).evaluateExpression(stmt.expression);

      // Note: Do NOT set ctx.pipeValue = value here.
      // Statements don't propagate $ to siblings. $ flows only via explicit ->.
      this.checkAutoExceptions(value, stmt);

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
    private async executeAnnotatedStatement(
      stmt: AnnotatedStatementNode
    ): Promise<RillValue> {
      // Evaluate annotation arguments to build annotation dict [EC-26]
      const newAnnotations = await this.evaluateAnnotations(stmt.annotations);

      // No inheritance: use only the annotations declared on this statement [IR-7]
      const merged = newAnnotations;

      // Set immediateAnnotation for closure capture before pushing to stack
      this.ctx.immediateAnnotation = newAnnotations;

      // Push annotations, execute inner statement, pop
      this.ctx.annotationStack.push(merged);
      try {
        return await this.executeStatement(stmt.statement);
      } finally {
        this.ctx.annotationStack.pop();
        this.ctx.immediateAnnotation = undefined;
      }
    }

    /**
     * Evaluate annotation arguments to a dict of key-value pairs.
     * Handles both named arguments and spread arguments.
     *
     * Errors during evaluation propagate [EC-26].
     */
    protected async evaluateAnnotations(
      annotations: AnnotationArg[]
    ): Promise<Record<string, RillValue>> {
      const result: Record<string, RillValue> = {};
      const self = this as unknown as EvaluatorInterface;

      for (const arg of annotations) {
        if (arg.type === 'NamedArg') {
          const namedArg = arg as NamedArgNode;
          result[namedArg.name] = await self.evaluateExpression(namedArg.value);
        } else {
          // SpreadArg: spread tuple/dict keys as annotations
          const spreadArg = arg as SpreadArgNode;
          const spreadValue = await self.evaluateExpression(
            spreadArg.expression
          );

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
            throw new RuntimeError(
              'RILL-R002',
              'Annotation spread requires dict with named keys, got list',
              spreadArg.span.start
            );
          } else {
            throw new RuntimeError(
              'RILL-R002',
              `Annotation spread requires dict, got ${typeof spreadValue}`,
              spreadArg.span.start
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
    getAnnotation(key: string): RillValue | undefined {
      return this.ctx.annotationStack.at(-1)?.[key];
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
    getIterationLimit(operatorAnnotations?: Record<string, RillValue>): number {
      const limit = operatorAnnotations?.['limit'];
      if (typeof limit === 'number' && limit > 0) {
        return Math.floor(limit);
      }
      return DEFAULT_MAX_ITERATIONS;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AnnotationsMixin = createAnnotationsMixin as any;

/**
 * Capability fragment: methods contributed by AnnotationsMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type AnnotationsMixinCapability = {
  evaluateAnnotations(
    annotations: AnnotationArg[]
  ): Promise<Record<string, RillValue>>;
  executeStatement(
    stmt: StatementNode | AnnotatedStatementNode
  ): Promise<RillValue>;
  getIterationLimit(operatorAnnotations?: Record<string, RillValue>): number;
};
