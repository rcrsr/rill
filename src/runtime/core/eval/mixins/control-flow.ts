/**
 * ControlFlowMixin: Conditionals, Loops, and Blocks
 *
 * Handles control flow constructs:
 * - Conditionals (if-else)
 * - While loops
 * - Do-while loops
 * - Block expressions
 * - Body evaluation
 *
 * Interface requirements (from spec):
 * - evaluateConditional(node) -> Promise<RillValue>
 * - evaluateWhileLoop(node) -> Promise<RillValue>
 * - evaluateDoWhileLoop(node) -> Promise<RillValue>
 * - evaluateBlockExpression(node) -> Promise<RillValue>
 * - evaluateBody(node) -> Promise<RillValue>
 * - evaluateBodyExpression(node) -> Promise<RillValue>
 *
 * Error Handling:
 * - Non-boolean conditions throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-15]
 * - BreakSignal/ReturnSignal are caught and handled appropriately [EC-16]
 * - Body evaluation errors propagate correctly [EC-17]
 *
 * @internal
 */

import type {
  ConditionalNode,
  WhileLoopNode,
  DoWhileLoopNode,
  BlockNode,
  BodyNode,
  AssertNode,
  ErrorNode,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { inferType } from '../../values.js';
import { createChildContext } from '../../context.js';
import { BreakSignal, ReturnSignal } from '../../signals.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * Default maximum iteration count for while/do-while loops.
 * Can be overridden with ^(limit: N) annotation.
 */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * ControlFlowMixin implementation.
 *
 * Evaluates conditionals, loops, blocks, and body nodes.
 * Handles BreakSignal and ReturnSignal for control flow.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluateGroupedExpr() (from ExpressionsMixin)
 * - evaluatePostfixExpr() (from future CoreMixin composition)
 * - evaluatePipeChain() (from future CoreMixin composition)
 * - executeStatement() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluateConditional(node) -> Promise<RillValue>
 * - evaluateWhileLoop(node) -> Promise<RillValue>
 * - evaluateDoWhileLoop(node) -> Promise<RillValue>
 * - evaluateBlock(node) -> Promise<RillValue>
 * - evaluateBlockExpression(node) -> Promise<RillValue>
 * - evaluateBody(node) -> Promise<RillValue>
 * - evaluateBodyExpression(node) -> Promise<RillValue>
 * - getIterationLimit() -> number (helper)
 */
function createControlFlowMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ControlFlowEvaluator extends Base {
    /**
     * Get the iteration limit for loops from the `limit` annotation.
     * Returns the default if not set or if the value is not a positive number.
     */
    protected getIterationLimit(): number {
      const limit = this.ctx.annotationStack.at(-1)?.['limit'];
      if (typeof limit === 'number' && limit > 0) {
        return Math.floor(limit);
      }
      return DEFAULT_MAX_ITERATIONS;
    }

    /**
     * Evaluate conditional expression (ternary if-else).
     *
     * Syntax:
     *   cond ? then ! else     - explicit condition
     *   $ -> ? then ! else     - piped conditional ($ is condition)
     *
     * Condition must evaluate to boolean. Branches create child scopes.
     * ReturnSignal propagates up (not caught here).
     */
    protected async evaluateConditional(
      node: ConditionalNode
    ): Promise<RillValue> {
      // Preserve pipe value before evaluating condition (condition may modify it)
      const savedPipeValue = this.ctx.pipeValue;

      let conditionResult: boolean;
      if (node.condition) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conditionValue = await (this as any).evaluateBodyExpression(
          node.condition
        );
        // Condition must be boolean
        if (typeof conditionValue !== 'boolean') {
          throw RuntimeError.fromNode(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Conditional expression must be boolean, got ${inferType(conditionValue)}`,
            node
          );
        }
        conditionResult = conditionValue;
      } else {
        // Piped conditional: $ -> ? then ! else
        // The pipe value must be boolean
        if (typeof this.ctx.pipeValue !== 'boolean') {
          throw RuntimeError.fromNode(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Piped conditional requires boolean, got ${inferType(this.ctx.pipeValue)}`,
            node
          );
        }
        conditionResult = this.ctx.pipeValue;
      }

      // Restore pipe value for then/else branch evaluation
      this.ctx.pipeValue = savedPipeValue;

      if (conditionResult) {
        // Create child scope for then branch (reads parent, writes local only)
        const thenCtx = createChildContext(this.ctx);
        thenCtx.pipeValue = savedPipeValue;
        // Use evaluateBody (not evaluateBodyExpression) so ReturnSignal
        // propagates up to the containing block rather than being caught here
        const savedCtx = this.ctx;
        this.ctx = thenCtx;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluateBody(node.thenBranch);
        } finally {
          this.ctx = savedCtx;
        }
      } else if (node.elseBranch) {
        // Create child scope for else branch (reads parent, writes local only)
        const elseCtx = createChildContext(this.ctx);
        elseCtx.pipeValue = savedPipeValue;
        const savedCtx = this.ctx;
        this.ctx = elseCtx;
        try {
          if (node.elseBranch.type === 'Conditional') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).evaluateConditional(node.elseBranch);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluateBody(node.elseBranch);
        } finally {
          this.ctx = savedCtx;
        }
      }

      return this.ctx.pipeValue;
    }

    /**
     * Evaluate while loop: (cond) @ body
     *
     * Condition must evaluate to boolean. Re-evaluated each iteration.
     * Each iteration creates a child scope (reads parent, writes local only).
     * Loop body result becomes the accumulator ($) for next iteration.
     *
     * BreakSignal exits loop and returns break value.
     * ReturnSignal propagates up to containing block.
     */
    protected async evaluateWhileLoop(node: WhileLoopNode): Promise<RillValue> {
      // Save original pipe value before evaluating condition
      const originalPipeValue = this.ctx.pipeValue;

      // Evaluate condition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditionValue = await (this as any).evaluateExpression(
        node.condition
      );

      // Restore original pipe value for loop body
      this.ctx.pipeValue = originalPipeValue;

      // Condition must be boolean
      if (typeof conditionValue !== 'boolean') {
        throw RuntimeError.fromNode(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `While loop condition must be boolean, got ${typeof conditionValue}`,
          node
        );
      }

      let value = this.ctx.pipeValue;
      let iterCount = 0;
      const maxIter = this.getIterationLimit();

      try {
        let conditionResult = conditionValue;
        while (conditionResult) {
          iterCount++;
          if (iterCount > maxIter) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_LIMIT_EXCEEDED,
              `RILL-R010: While loop exceeded ${maxIter} iterations`,
              this.getNodeLocation(node),
              { limit: maxIter, iterations: iterCount }
            );
          }
          this.checkAborted(node);

          // Create child scope for this iteration
          const iterCtx = createChildContext(this.ctx);
          iterCtx.pipeValue = value;
          const savedCtx = this.ctx;
          this.ctx = iterCtx;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = await (this as any).evaluateBody(node.body);
          } finally {
            this.ctx = savedCtx;
          }
          this.ctx.pipeValue = value;

          // Re-evaluate condition for next iteration
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nextCondition = await (this as any).evaluateExpression(
            node.condition
          );
          if (typeof nextCondition !== 'boolean') {
            throw RuntimeError.fromNode(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `While loop condition must be boolean, got ${typeof nextCondition}`,
              node
            );
          }
          conditionResult = nextCondition;
          // Restore pipeValue after condition evaluation
          this.ctx.pipeValue = value;
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          return e.value;
        }
        throw e;
      }

      return value;
    }

    /**
     * Evaluate do-while loop: @ body ? cond
     *
     * Body executes at least once, then condition is checked.
     * Condition must evaluate to boolean.
     * Each iteration creates a child scope (reads parent, writes local only).
     * Loop body result becomes the accumulator ($) for next iteration.
     *
     * BreakSignal exits loop and returns break value.
     * ReturnSignal propagates up to containing block.
     */
    protected async evaluateDoWhileLoop(
      node: DoWhileLoopNode
    ): Promise<RillValue> {
      let value = this.ctx.pipeValue;

      try {
        // Do-while: body executes first, then condition is checked
        // Each iteration creates a child scope (reads parent, writes local only)
        let shouldContinue = true;
        while (shouldContinue) {
          this.checkAborted(node);

          const iterCtx = createChildContext(this.ctx);
          iterCtx.pipeValue = value;
          const savedCtx = this.ctx;
          this.ctx = iterCtx;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = await (this as any).evaluateBody(node.body);
          } finally {
            this.ctx = savedCtx;
          }
          this.ctx.pipeValue = value;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const conditionValue = await (this as any).evaluateBodyExpression(
            node.condition
          );
          // Condition must be boolean
          if (typeof conditionValue !== 'boolean') {
            throw RuntimeError.fromNode(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `Do-while condition must be boolean, got ${inferType(conditionValue)}`,
              node
            );
          }
          shouldContinue = conditionValue;
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          return e.value;
        }
        throw e;
      }

      return value;
    }

    /**
     * Evaluate block: { statements }
     *
     * Creates child scope for the block (reads parent, writes local only).
     * All siblings inherit the SAME $ from parent (captured when block entered).
     * Each statement gets fresh child context so siblings don't share $.
     *
     * Variables captured via :> are promoted to block scope for visibility
     * to later siblings.
     *
     * Returns value of last statement.
     * ReturnSignal NOT caught here - propagates up to evaluateBlockExpression.
     */
    protected async evaluateBlock(node: BlockNode): Promise<RillValue> {
      // Create child scope for the block: reads from parent, writes to local only
      const blockCtx = createChildContext(this.ctx);

      // All siblings inherit the SAME $ from parent (captured when block entered)
      const parentPipeValue = blockCtx.pipeValue;
      let lastValue: RillValue = parentPipeValue;

      for (const stmt of node.statements) {
        // Each statement gets fresh child context with parent's $
        // This ensures siblings don't share $ - each sees the block's $
        const stmtCtx = createChildContext(blockCtx);
        stmtCtx.pipeValue = parentPipeValue; // Always parent's $, not previous sibling's

        const savedCtx = this.ctx;
        this.ctx = stmtCtx;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lastValue = await (this as any).executeStatement(stmt);
        } finally {
          this.ctx = savedCtx;
        }

        // Variables captured via :> need to be promoted to block scope
        // so they're visible to later siblings
        for (const [name, value] of stmtCtx.variables) {
          if (!blockCtx.variables.has(name)) {
            blockCtx.variables.set(name, value);
            const varType = stmtCtx.variableTypes.get(name);
            if (varType !== undefined) {
              blockCtx.variableTypes.set(name, varType);
            }
          }
        }
      }

      return lastValue; // Last sibling's result is block result
    }

    /**
     * Evaluate block expression: catches ReturnSignal.
     *
     * This is the entry point for blocks used as expressions
     * (e.g., in conditionals, as function bodies).
     *
     * Catches ReturnSignal and returns its value.
     * Other signals (BreakSignal) and errors propagate up.
     */
    protected async evaluateBlockExpression(
      node: BlockNode
    ): Promise<RillValue> {
      try {
        return await this.evaluateBlock(node);
      } catch (e) {
        if (e instanceof ReturnSignal) {
          return e.value;
        }
        throw e;
      }
    }

    /**
     * Evaluate assert statement.
     *
     * Evaluates condition expression, halts with RuntimeError if false.
     * Returns piped value unchanged on success.
     *
     * @param node - AssertNode to evaluate
     * @param input - Input value (for pipe targets) or undefined (for statements)
     * @returns Original pipe value on successful assertion
     * @throws RuntimeError with RUNTIME_ASSERTION_FAILED on false condition
     * @throws RuntimeError with RUNTIME_TYPE_ERROR on non-boolean condition
     */
    protected async evaluateAssert(
      node: AssertNode,
      input?: RillValue
    ): Promise<RillValue> {
      // Use input if provided (pipe target), otherwise use current pipe value (statement)
      const valueToReturn = input !== undefined ? input : this.ctx.pipeValue;

      // Save the current pipe value to restore after condition evaluation
      const savedPipeValue = this.ctx.pipeValue;

      // Evaluate the condition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditionResult = await (this as any).evaluateExpression(
        node.condition
      );

      // Restore the pipe value (condition evaluation may have changed it)
      this.ctx.pipeValue = savedPipeValue;

      // Condition must be boolean
      if (typeof conditionResult !== 'boolean') {
        throw RuntimeError.fromNode(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `assert requires boolean condition, got ${inferType(conditionResult)}`,
          node
        );
      }

      // If condition is false, throw assertion error
      if (!conditionResult) {
        // Use custom message if provided, otherwise use default
        let errorMessage: string;
        if (node.message) {
          // Evaluate the message string literal
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const messageValue = await (this as any).evaluateString(node.message);
          errorMessage = String(messageValue);
        } else {
          errorMessage = 'Assertion failed';
        }

        throw RuntimeError.fromNode(
          RILL_ERROR_CODES.RUNTIME_ASSERTION_FAILED,
          errorMessage,
          node
        );
      }

      // Assertion passed, return original pipe value unchanged
      return valueToReturn;
    }

    /**
     * Evaluate error statement.
     *
     * Evaluates message string literal and halts execution with RuntimeError.
     * Never returns normally (always throws).
     *
     * Forms:
     * - Direct: error "message" - Uses literal message
     * - Piped: "message" -> error - Uses piped input as message
     *
     * @param node - ErrorNode to evaluate
     * @param input - Input value (for pipe targets) or undefined (for statements)
     * @returns Never returns (always throws)
     * @throws RuntimeError with RUNTIME_ERROR_RAISED using evaluated message
     * @throws RuntimeError with RUNTIME_TYPE_ERROR if message is not string
     */
    protected async evaluateError(
      node: ErrorNode,
      input?: RillValue
    ): Promise<never> {
      let messageValue: RillValue;

      if (node.message) {
        // Direct form: error "message"
        // Evaluate the message string literal (handles interpolation)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messageValue = await (this as any).evaluateString(node.message);
      } else if (input !== undefined) {
        // Piped form: "message" -> error
        messageValue = input;
      } else {
        // No message and no input - should not happen if parser is correct
        throw RuntimeError.fromNode(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'error statement requires string message',
          node
        );
      }

      // Message must be string
      if (typeof messageValue !== 'string') {
        throw RuntimeError.fromNode(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `error statement requires string message, got ${inferType(messageValue)}`,
          node
        );
      }

      // Always throw with user-provided message
      throw RuntimeError.fromNode(
        RILL_ERROR_CODES.RUNTIME_ERROR_RAISED,
        messageValue,
        node
      );
    }

    /**
     * Evaluate a body node (Block, GroupedExpr, PostfixExpr, or PipeChain).
     * Used by conditionals and loops.
     *
     * Does NOT catch ReturnSignal - it propagates up.
     * BreakSignal should be caught by the loop that called this.
     */
    protected async evaluateBody(node: BodyNode): Promise<RillValue> {
      switch (node.type) {
        case 'Block':
          return this.evaluateBlock(node);
        case 'GroupedExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateGroupedExpr(node);
        case 'PostfixExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePostfixExpr(node);
        case 'PipeChain':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePipeChain(node);
      }
    }

    /**
     * Evaluate a body node as an expression (catches ReturnSignal).
     *
     * Used when a body needs to be treated as an expression
     * (e.g., conditional condition, do-while condition).
     *
     * Catches ReturnSignal and returns its value.
     * Other signals (BreakSignal) and errors propagate up.
     */
    protected async evaluateBodyExpression(node: BodyNode): Promise<RillValue> {
      try {
        return await this.evaluateBody(node);
      } catch (e) {
        if (e instanceof ReturnSignal) {
          return e.value;
        }
        throw e;
      }
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ControlFlowMixin = createControlFlowMixin as any;
