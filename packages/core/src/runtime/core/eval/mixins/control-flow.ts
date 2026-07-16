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
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, checkAborted } from '../shared.js';
import {
  evaluateAnnotations,
  getIterationLimit,
  executeStatement,
} from './annotations.js';
import {
  evaluateExpression,
  evaluatePostfixExpr,
  evaluatePipeChain,
} from './core.js';
import { evaluateString } from './literals.js';
import { evaluateGroupedExpr } from './expressions.js';

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
export async function evaluateConditional(
  s: EvalState,
  node: ConditionalNode
): Promise<RillValue> {
  // Preserve pipe value before evaluating condition (condition may modify it)
  const savedPipeValue = s.ctx.pipeValue;

  let conditionResult: boolean;
  if (node.condition) {
    const conditionValue = await evaluateBodyExpression(s, node.condition);
    // Condition must be boolean
    if (typeof conditionValue !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
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
    if (typeof s.ctx.pipeValue !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateConditional',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Piped conditional requires boolean, got ${inferType(s.ctx.pipeValue)}`
      );
    }
    conditionResult = s.ctx.pipeValue;
  }

  // Restore pipe value for then/else branch evaluation
  s.ctx.pipeValue = savedPipeValue;

  if (conditionResult) {
    // Create child scope for then branch (reads parent, writes local only)
    const thenCtx = createChildContext(s.ctx);
    thenCtx.pipeValue = savedPipeValue;
    // Use evaluateBody (not evaluateBodyExpression) so ReturnSignal
    // propagates up to the containing block rather than being caught here
    const savedCtx = s.ctx;
    s.ctx = thenCtx;
    try {
      return await evaluateBody(s, node.thenBranch);
    } finally {
      s.ctx = savedCtx;
    }
  } else if (node.elseBranch) {
    // Create child scope for else branch (reads parent, writes local only)
    const elseCtx = createChildContext(s.ctx);
    elseCtx.pipeValue = savedPipeValue;
    const savedCtx = s.ctx;
    s.ctx = elseCtx;
    try {
      if (node.elseBranch.type === 'Conditional') {
        return await evaluateConditional(s, node.elseBranch);
      }
      return await evaluateBody(s, node.elseBranch);
    } finally {
      s.ctx = savedCtx;
    }
  }

  return s.ctx.pipeValue;
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
export async function evaluateWhileLoop(
  s: EvalState,
  node: WhileLoopNode
): Promise<RillValue> {
  // Save original pipe value before evaluating condition
  const originalPipeValue = s.ctx.pipeValue;

  // Evaluate condition
  const conditionValue = await evaluateExpression(s, node.condition);

  // Restore original pipe value for loop body
  s.ctx.pipeValue = originalPipeValue;

  // Condition must be boolean
  if (typeof conditionValue !== 'boolean') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateWhileLoop',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `While loop condition must be boolean, got ${typeof conditionValue}`
    );
  }

  let value = s.ctx.pipeValue;
  let iterCount = 0;
  // Evaluate operator-level annotations (node.annotations) to read limit [IR-6].
  // Statement-level annotationStack is not consulted (EC-5).
  const operatorAnnotations = node.annotations?.length
    ? await evaluateAnnotations(s, node.annotations)
    : undefined;
  const maxIter = getIterationLimit(s, operatorAnnotations);

  try {
    let conditionResult = conditionValue;
    while (conditionResult) {
      iterCount++;
      if (iterCount > maxIter) {
        throwFatalHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateWhileLoop',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R010],
          `While loop exceeded ${maxIter} iterations`,
          { limit: maxIter, iterations: iterCount }
        );
      }
      checkAborted(s, node);

      // Create child scope for this iteration
      const iterCtx = createChildContext(s.ctx);
      iterCtx.pipeValue = value;
      const savedCtx = s.ctx;
      s.ctx = iterCtx;
      try {
        value = await evaluateBody(s, node.body);
      } finally {
        s.ctx = savedCtx;
      }
      s.ctx.pipeValue = value;

      // Re-evaluate condition for next iteration
      const nextCondition = await evaluateExpression(s, node.condition);
      if (typeof nextCondition !== 'boolean') {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateWhileLoop',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `While loop condition must be boolean, got ${typeof nextCondition}`
        );
      }
      conditionResult = nextCondition;
      // Restore pipeValue after condition evaluation
      s.ctx.pipeValue = value;
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
export async function evaluateDoWhileLoop(
  s: EvalState,
  node: DoWhileLoopNode
): Promise<RillValue> {
  let value = s.ctx.pipeValue;

  // Evaluate operator-level annotations (node.annotations) to read limit [IR-6].
  // Statement-level annotationStack is not consulted (EC-5).
  const operatorAnnotations = node.annotations?.length
    ? await evaluateAnnotations(s, node.annotations)
    : undefined;
  const maxIter = getIterationLimit(s, operatorAnnotations);
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
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDoWhileLoop',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R010],
          `Do-while loop exceeded ${maxIter} iterations`,
          { limit: maxIter, iterations: iterCount }
        );
      }
      checkAborted(s, node);

      const iterCtx = createChildContext(s.ctx);
      iterCtx.pipeValue = value;
      const savedCtx = s.ctx;
      s.ctx = iterCtx;
      try {
        value = await evaluateBody(s, node.body);
      } finally {
        s.ctx = savedCtx;
      }
      s.ctx.pipeValue = value;

      const conditionValue = await evaluateBodyExpression(s, node.condition);
      // Condition must be boolean
      if (typeof conditionValue !== 'boolean') {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
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
export async function evaluateBlock(
  s: EvalState,
  node: BlockNode
): Promise<RillValue> {
  // Create child scope for the block: reads from parent, writes to local only
  const blockCtx = createChildContext(s.ctx);

  // All siblings inherit the SAME $ from parent (captured when block entered)
  const parentPipeValue = blockCtx.pipeValue;
  let lastValue: RillValue = parentPipeValue;

  for (const stmt of node.statements) {
    // Each statement gets fresh child context with parent's $
    // This ensures siblings don't share $ - each sees the block's $
    const stmtCtx = createChildContext(blockCtx);
    stmtCtx.pipeValue = parentPipeValue; // Always parent's $, not previous sibling's

    const savedCtx = s.ctx;
    s.ctx = stmtCtx;
    try {
      lastValue = await executeStatement(s, stmt);
    } finally {
      s.ctx = savedCtx;
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
export async function evaluateBlockExpression(
  s: EvalState,
  node: BlockNode
): Promise<RillValue> {
  try {
    // Dispatch through s.evaluateBlock (not the bare sibling function) so
    // StreamClosuresMixin's scope-exit stream-disposal override still fires
    // for callers that reach blocks via this path.
    return await s.evaluateBlock(node);
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
 * @param s - Evaluator state
 * @param node - AssertNode to evaluate
 * @param input - Input value (for pipe targets) or undefined (for statements)
 * @returns Original pipe value on successful assertion
 * @throws RuntimeError with RUNTIME_ASSERTION_FAILED on false condition
 * @throws RuntimeError with RUNTIME_TYPE_ERROR on non-boolean condition
 */
export async function evaluateAssert(
  s: EvalState,
  node: AssertNode,
  input?: RillValue
): Promise<RillValue> {
  // Use input if provided (pipe target), otherwise use current pipe value (statement)
  const valueToReturn = input !== undefined ? input : s.ctx.pipeValue;

  // Save the current pipe value to restore after condition evaluation
  const savedPipeValue = s.ctx.pipeValue;

  // Evaluate the condition
  const conditionResult = await evaluateExpression(s, node.condition);

  // Restore the pipe value (condition evaluation may have changed it)
  s.ctx.pipeValue = savedPipeValue;

  // Condition must be boolean
  if (typeof conditionResult !== 'boolean') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
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
      const { value } = await evaluateString(s, node.message);
      errorMessage = value;
    } else {
      errorMessage = 'Assertion failed';
    }

    throwFatalHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
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
 * @param s - Evaluator state
 * @param node - ErrorNode to evaluate
 * @param input - Input value (for pipe targets) or undefined (for statements)
 * @returns Never returns (always throws)
 * @throws RuntimeError with RUNTIME_ERROR_RAISED using evaluated message
 * @throws RuntimeError with RUNTIME_TYPE_ERROR if message is not string
 */
export async function evaluateError(
  s: EvalState,
  node: ErrorNode,
  input?: RillValue
): Promise<never> {
  let messageValue: RillValue;
  let interpolated = false;

  if (node.message) {
    // Direct form: error "message"
    // Evaluate the message string literal (handles interpolation)
    const evaluated = await evaluateString(s, node.message);
    messageValue = evaluated.value;
    interpolated = evaluated.interpolated === true;
  } else if (input !== undefined) {
    // Piped form: "message" -> error
    messageValue = input;
  } else {
    // No message and no input - should not happen if parser is correct
    throwFatalHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
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
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
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
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
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
 *
 * Hot path: called from 11 external call sites. Signature is stable —
 * do not reorder or rename parameters.
 */
export async function evaluateBody(
  s: EvalState,
  node: BodyNode
): Promise<RillValue> {
  switch (node.type) {
    case 'Block':
      // Dispatch through s.evaluateBlock (not the bare sibling function) so
      // StreamClosuresMixin's scope-exit stream-disposal override still
      // fires.
      return s.evaluateBlock(node);
    case 'GroupedExpr':
      return evaluateGroupedExpr(s, node);
    case 'PostfixExpr':
      return evaluatePostfixExpr(s, node);
    case 'PipeChain':
      return evaluatePipeChain(s, node);
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
export async function evaluateBodyExpression(
  s: EvalState,
  node: BodyNode
): Promise<RillValue> {
  try {
    return await evaluateBody(s, node);
  } catch (e) {
    if (e instanceof ReturnSignal) {
      return e.value;
    }
    throw e;
  }
}

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
export function ControlFlowMixin<
  TBase extends EvaluatorConstructor<EvaluatorBase>,
>(Base: TBase) {
  return class ControlFlowEvaluator extends Base {
    evaluateConditional(node: ConditionalNode): Promise<RillValue> {
      return evaluateConditional(this as unknown as EvalState, node);
    }

    evaluateWhileLoop(node: WhileLoopNode): Promise<RillValue> {
      return evaluateWhileLoop(this as unknown as EvalState, node);
    }

    evaluateDoWhileLoop(node: DoWhileLoopNode): Promise<RillValue> {
      return evaluateDoWhileLoop(this as unknown as EvalState, node);
    }

    evaluateBlock(node: BlockNode): Promise<RillValue> {
      return evaluateBlock(this as unknown as EvalState, node);
    }

    evaluateBlockExpression(node: BlockNode): Promise<RillValue> {
      return evaluateBlockExpression(this as unknown as EvalState, node);
    }

    evaluateAssert(node: AssertNode, input?: RillValue): Promise<RillValue> {
      return evaluateAssert(this as unknown as EvalState, node, input);
    }

    evaluateError(node: ErrorNode, input?: RillValue): Promise<never> {
      return evaluateError(this as unknown as EvalState, node, input);
    }

    evaluateBody(node: BodyNode): Promise<RillValue> {
      return evaluateBody(this as unknown as EvalState, node);
    }

    evaluateBodyExpression(node: BodyNode): Promise<RillValue> {
      return evaluateBodyExpression(this as unknown as EvalState, node);
    }
  };
}

/**
 * Capability fragment: methods contributed by ControlFlowMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ControlFlowMixinCapability = {
  evaluateConditional(node: ConditionalNode): Promise<RillValue>;
  evaluateWhileLoop(node: WhileLoopNode): Promise<RillValue>;
  evaluateDoWhileLoop(node: DoWhileLoopNode): Promise<RillValue>;
  evaluateBlock(node: BlockNode): Promise<RillValue>;
  evaluateAssert(node: AssertNode, input?: RillValue): Promise<RillValue>;
  evaluateError(node: ErrorNode, input?: RillValue): Promise<never>;
  evaluateBody(node: BodyNode): Promise<RillValue>;
  evaluateBodyExpression(node: BodyNode): Promise<RillValue>;
};
