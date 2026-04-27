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
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { createChildContext } from '../../context.js';
import { BreakSignal, ReturnSignal } from '../../signals.js';
import {
  throwCatchableHostHalt,
  throwErrorHalt,
  throwFatalHostHalt,
  type TypeHaltSite,
} from '../../types/halt.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

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
        const conditionValue = await (
          this as unknown as EvaluatorInterface
        ).evaluateBodyExpression(node.condition);
        // Condition must be boolean
        if (typeof conditionValue !== 'boolean') {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateConditional',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Conditional expression must be boolean, got ${inferType(conditionValue)}`
          );
        }
        conditionResult = conditionValue;
      } else {
        // Piped conditional: $ -> ? then ! else
        // The pipe value must be boolean
        if (typeof this.ctx.pipeValue !== 'boolean') {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateConditional',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Piped conditional requires boolean, got ${inferType(this.ctx.pipeValue)}`
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
          return await (this as unknown as EvaluatorInterface).evaluateBody(
            node.thenBranch
          );
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
            return await (
              this as unknown as EvaluatorInterface
            ).evaluateConditional(node.elseBranch);
          }
          return await (this as unknown as EvaluatorInterface).evaluateBody(
            node.elseBranch
          );
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
      const conditionValue = await (
        this as unknown as EvaluatorInterface
      ).evaluateExpression(node.condition);

      // Restore original pipe value for loop body
      this.ctx.pipeValue = originalPipeValue;

      // Condition must be boolean
      if (typeof conditionValue !== 'boolean') {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateWhileLoop',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `While loop condition must be boolean, got ${typeof conditionValue}`
        );
      }

      let value = this.ctx.pipeValue;
      let iterCount = 0;
      // Evaluate operator-level annotations (node.annotations) to read limit [IR-6].
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? await (this as unknown as EvaluatorInterface).evaluateAnnotations(
            node.annotations
          )
        : undefined;
      const maxIter = (this as unknown as EvaluatorInterface).getIterationLimit(
        operatorAnnotations
      );

      try {
        let conditionResult = conditionValue;
        while (conditionResult) {
          iterCount++;
          if (iterCount > maxIter) {
            throwFatalHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'evaluateWhileLoop',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R010],
              `While loop exceeded ${maxIter} iterations`,
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
            value = await (this as unknown as EvaluatorInterface).evaluateBody(
              node.body
            );
          } finally {
            this.ctx = savedCtx;
          }
          this.ctx.pipeValue = value;

          // Re-evaluate condition for next iteration
          const nextCondition = await (
            this as unknown as EvaluatorInterface
          ).evaluateExpression(node.condition);
          if (typeof nextCondition !== 'boolean') {
            throwCatchableHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'evaluateWhileLoop',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `While loop condition must be boolean, got ${typeof nextCondition}`
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
     * Evaluate do-while loop: `do { body } while (cond)`
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

      // Evaluate operator-level annotations (node.annotations) to read limit [IR-6].
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? await (this as unknown as EvaluatorInterface).evaluateAnnotations(
            node.annotations
          )
        : undefined;
      const maxIter = (this as unknown as EvaluatorInterface).getIterationLimit(
        operatorAnnotations
      );
      let iterCount = 0;

      try {
        // Do-while: body executes first, then condition is checked
        // Each iteration creates a child scope (reads parent, writes local only)
        let shouldContinue = true;
        while (shouldContinue) {
          iterCount++;
          if (iterCount > maxIter) {
            throwFatalHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'evaluateDoWhileLoop',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R010],
              `Do-while loop exceeded ${maxIter} iterations`,
              { limit: maxIter, iterations: iterCount }
            );
          }
          this.checkAborted(node);

          const iterCtx = createChildContext(this.ctx);
          iterCtx.pipeValue = value;
          const savedCtx = this.ctx;
          this.ctx = iterCtx;
          try {
            value = await (this as unknown as EvaluatorInterface).evaluateBody(
              node.body
            );
          } finally {
            this.ctx = savedCtx;
          }
          this.ctx.pipeValue = value;

          const conditionValue = await (
            this as unknown as EvaluatorInterface
          ).evaluateBodyExpression(node.condition);
          // Condition must be boolean
          if (typeof conditionValue !== 'boolean') {
            throwCatchableHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'evaluateDoWhileLoop',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `Do-while condition must be boolean, got ${inferType(conditionValue)}`
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
          lastValue = await (
            this as unknown as EvaluatorInterface
          ).executeStatement(stmt);
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
      const conditionResult = await (
        this as unknown as EvaluatorInterface
      ).evaluateExpression(node.condition);

      // Restore the pipe value (condition evaluation may have changed it)
      this.ctx.pipeValue = savedPipeValue;

      // Condition must be boolean
      if (typeof conditionResult !== 'boolean') {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateAssert',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `assert requires boolean condition, got ${inferType(conditionResult)}`
        );
      }

      // If condition is false, throw assertion error
      if (!conditionResult) {
        // Use custom message if provided, otherwise use default
        let errorMessage: string;
        if (node.message) {
          // Evaluate the message string literal
          const { value } = await (
            this as unknown as EvaluatorInterface
          ).evaluateString(node.message);
          errorMessage = value;
        } else {
          errorMessage = 'Assertion failed';
        }

        throwFatalHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateAssert',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R015],
          errorMessage
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
      let interpolated = false;

      if (node.message) {
        // Direct form: error "message"
        // Evaluate the message string literal (handles interpolation)
        const evaluated = await (
          this as unknown as EvaluatorInterface
        ).evaluateString(node.message);
        messageValue = evaluated.value;
        interpolated = evaluated.interpolated === true;
      } else if (input !== undefined) {
        // Piped form: "message" -> error
        messageValue = input;
      } else {
        // No message and no input - should not happen if parser is correct
        throwFatalHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateError',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'error statement requires string message'
        );
      }

      // Message must be string
      if (typeof messageValue !== 'string') {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateError',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `error statement requires string message, got ${inferType(messageValue)}`
        );
      }

      // IR-5: route through throwErrorHalt so the halt surfaces as a
      // typed-atom invalid carrying `#RILL_R016` with a wrap frame when
      // the source message used interpolation.
      const site: TypeHaltSite = {
        location: this.getNodeLocation(node),
        sourceId: this.ctx.sourceId,
        fn: 'evaluateError',
      };
      throwErrorHalt(site, messageValue, interpolated);
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
          return (this as unknown as EvaluatorInterface).evaluateGroupedExpr(
            node
          );
        case 'PostfixExpr':
          return (this as unknown as EvaluatorInterface).evaluatePostfixExpr(
            node
          );
        case 'PipeChain':
          return (this as unknown as EvaluatorInterface).evaluatePipeChain(
            node
          );
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

/**
 * Capability fragment: methods contributed by ControlFlowMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ControlFlowMixinCapability = {
  evaluateConditional(node: ConditionalNode): Promise<RillValue>;
  evaluateWhileLoop(node: WhileLoopNode): Promise<RillValue>;
  evaluateDoWhileLoop(node: DoWhileLoopNode): Promise<RillValue>;
  evaluateAssert(node: AssertNode, input?: RillValue): Promise<RillValue>;
  evaluateError(node: ErrorNode, input?: RillValue): Promise<never>;
  evaluateBody(node: BodyNode): Promise<RillValue>;
  evaluateBodyExpression(node: BodyNode): Promise<RillValue>;
};
