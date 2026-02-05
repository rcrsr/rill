/**
 * Script Execution
 *
 * Public API for executing Rill scripts.
 * Provides both full execution and step-by-step execution.
 */

import type {
  AnnotatedStatementNode,
  RecoveryErrorNode,
  ScriptNode,
  StatementNode,
} from '../../types.js';
import { RuntimeError } from '../../types.js';
import {
  executeStatement,
  checkAutoExceptions,
  checkAborted,
} from './eval/index.js';
import { ReturnSignal } from './signals.js';
import type {
  ExecutionResult,
  ExecutionStepper,
  RuntimeContext,
  StepResult,
} from './types.js';
import type { RillValue } from './values.js';

/**
 * Execute a parsed Rill script.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns The final value and all captured variables
 */
export async function execute(
  script: ScriptNode,
  context: RuntimeContext
): Promise<ExecutionResult> {
  const stepper = createStepper(script, context);
  while (!stepper.done) {
    await stepper.step();
  }
  return stepper.getResult();
}

/**
 * Create a stepper for controlled step-by-step execution.
 * Allows the caller to control the execution loop and inspect state between steps.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns A stepper for step-by-step execution
 */
export function createStepper(
  script: ScriptNode,
  context: RuntimeContext
): ExecutionStepper {
  const statements = script.statements;
  const total = statements.length;
  let index = 0;
  let lastValue: RillValue = null;
  let isDone = total === 0;

  const collectVariables = (): Record<string, RillValue> => {
    const vars: Record<string, RillValue> = {};
    for (const [name, value] of context.variables) {
      vars[name] = value;
    }
    return vars;
  };

  return {
    get done() {
      return isDone;
    },
    get index() {
      return index;
    },
    get total() {
      return total;
    },
    get context() {
      return context;
    },

    async step(): Promise<StepResult> {
      if (isDone) {
        return {
          value: lastValue,
          done: true,
          index: index,
          total,
        };
      }

      const stmt = statements[index];
      if (!stmt) {
        isDone = true;
        return { value: lastValue, done: true, index, total };
      }

      // Check for abort before each step
      checkAborted(context, stmt);

      const startTime = Date.now();

      // Fire onStepStart
      context.observability.onStepStart?.({
        index,
        total,
        pipeValue: context.pipeValue,
      });

      let captured: { name: string; value: RillValue } | undefined;

      try {
        // Check for RecoveryErrorNode from recovery mode parsing
        if (isRecoveryErrorNode(stmt)) {
          throw RuntimeError.fromNode(
            'RILL-P002',
            `Cannot execute RecoveryErrorNode: ${stmt.message}. Use parse() instead of parseWithRecovery() for execution.`,
            stmt
          );
        }

        // Execute the statement (handles both regular and annotated)
        const value = await executeStatement(stmt, context);

        // Get the inner statement's expression for capture detection
        // Check both terminator (legacy -> $var) and pipes (new :> $var)
        const innerStmt = getInnerStatement(stmt);
        const expr = innerStmt.expression;
        if (expr.terminator?.type === 'Capture') {
          captured = { name: expr.terminator.name, value };
        } else {
          // Check for :> captures in pipes array (last capture wins)
          for (const pipe of expr.pipes) {
            if (pipe.type === 'Capture') {
              const captureValue = context.variables.get(pipe.name);
              captured = { name: pipe.name, value: captureValue ?? value };
            }
          }
        }
        lastValue = value;

        checkAutoExceptions(value, context, stmt);

        // Fire onStepEnd
        context.observability.onStepEnd?.({
          index,
          total,
          value,
          durationMs: Date.now() - startTime,
        });

        index++;
        isDone = index >= total;

        return {
          value,
          done: isDone,
          index: index - 1,
          total,
          captured,
        };
      } catch (error) {
        // Handle script-level return
        if (error instanceof ReturnSignal) {
          lastValue = error.value;
          isDone = true;
          return {
            value: lastValue,
            done: true,
            index,
            total,
            captured,
          };
        }

        // Fire onError
        context.observability.onError?.({
          error: error instanceof Error ? error : new Error(String(error)),
          index,
        });
        throw error;
      }
    },

    getResult(): ExecutionResult {
      // Empty script implicitly evaluates to $
      if (total === 0) {
        if (context.pipeValue === null) {
          throw new RuntimeError(
            'RILL-R005',
            'Undefined variable: $',
            undefined,
            { variable: '$' }
          );
        }
        return {
          value: context.pipeValue,
          variables: collectVariables(),
        };
      }
      return {
        value: lastValue,
        variables: collectVariables(),
      };
    },
  };
}

/**
 * Type guard to check if a statement is an RecoveryErrorNode from recovery mode parsing.
 * @internal
 */
function isRecoveryErrorNode(
  stmt: StatementNode | AnnotatedStatementNode | RecoveryErrorNode
): stmt is RecoveryErrorNode {
  return stmt.type === 'RecoveryError';
}

/**
 * Get the inner StatementNode from either a StatementNode or AnnotatedStatementNode.
 * For annotated statements, returns the wrapped statement.
 */
function getInnerStatement(
  stmt: StatementNode | AnnotatedStatementNode
): StatementNode {
  return stmt.type === 'AnnotatedStatement' ? stmt.statement : stmt;
}
