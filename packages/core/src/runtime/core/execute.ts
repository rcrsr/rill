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
import {
  AbortError,
  AutoExceptionError,
  RillError,
  RuntimeError,
} from '../../types.js';
import {
  executeStatement,
  checkAutoExceptions,
  checkAborted,
} from './eval/index.js';
import { ReturnSignal } from './signals.js';
import { isExtensionThrow } from './extension-throw.js';
import type {
  ExecutionResult,
  ExecutionStepper,
  RuntimeContext,
  StepResult,
} from './types/runtime.js';
import type { RillValue } from './types/structures.js';
import { invalidate } from './types/status.js';
import { createTraceFrame } from './types/trace.js';
import { formatAccessSite } from './eval/mixins/access.js';

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
  // Guard against removed frontmatter keys
  if (script.frontmatter) {
    const content = script.frontmatter.content;
    if (/(?:^|\n)\s*use\s*:/.test(content)) {
      throw new RuntimeError(
        'RILL-R060',
        'Frontmatter key removed: use: frontmatter removed; use use<module:...> instead',
        undefined,
        { context: 'Script' }
      );
    }
    if (/(?:^|\n)\s*export\s*:/.test(content)) {
      throw new RuntimeError(
        'RILL-R060',
        'Frontmatter key removed: export: frontmatter removed; use last-expression result instead',
        undefined,
        { context: 'Script' }
      );
    }
  }

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
        // EC-12 / EC-14: a RecoveryErrorNode reaching execution produces an
        // invalid value with `.!code == #R001` (FR-ERR-4). Parse-recovery
        // emitted the node; runtime surfaces it as an invalid value so
        // guard / retry downstream can observe and recover.
        if (isRecoveryErrorNode(stmt)) {
          const site = formatAccessSite(stmt.span.start, context.sourceId);
          const value = invalidate(
            {},
            {
              code: 'R001',
              provider: 'parse-recovery',
              raw: { message: stmt.message },
            },
            createTraceFrame({ site, kind: 'host', fn: 'parse-recovery' })
          );
          lastValue = value;
          checkAutoExceptions(value, context, stmt);
          context.observability.onStepEnd?.({
            index,
            total,
            value,
            durationMs: Date.now() - startTime,
          });
          index++;
          isDone = index >= total;
          return { value, done: isDone, index: index - 1, total };
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

        // AC-E4 / EC-6: Extension-boundary reshape wrapper. Unhandled
        // throws from extension-provided host functions (non-RillError)
        // surface as `#R999` invalid values at the script's mount point
        // instead of propagating as JS exceptions. Known RillError halts
        // (RuntimeError thrown by runtime internals) preserve existing
        // halt semantics by rethrowing.
        //
        // Migration (§Migration Strategy):
        // - AbortError thrown at the boundary reshapes to `#DISPOSED`
        // - AutoExceptionError thrown at the boundary reshapes to `#R999`
        // - RuntimeError (other than the above) rethrows to preserve halts
        // - Non-RillError Error reshapes to `#R999` with sanitized message
        // - Non-Error throw reshapes to `#R999` with `.!raw.original`
        const reshaped = reshapeUnhandledThrow(error, stmt, context);
        if (reshaped !== undefined) {
          lastValue = reshaped;

          // Fire onError for observability: host applications still see
          // the original throw even though the script result is reshaped.
          context.observability.onError?.({
            error: error instanceof Error ? error : new Error(String(error)),
            index,
          });

          // Fire onStepEnd so observability sees the reshaped value.
          context.observability.onStepEnd?.({
            index,
            total,
            value: reshaped,
            durationMs: Date.now() - startTime,
          });

          index++;
          isDone = index >= total;

          return {
            value: reshaped,
            done: isDone,
            index: index - 1,
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
            'RILL-R043',
            'Script produced no value',
            undefined,
            { context: 'Script' }
          );
        }
        return { result: context.pipeValue };
      }
      return { result: lastValue };
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
 * Extension-boundary reshape (AC-E4, EC-6).
 *
 * Translates unhandled throws from extension-provided host functions into
 * `#R999` (or `#DISPOSED`) invalid values carried by the step's result.
 * Returns `undefined` when the throw should continue to propagate
 * (preserves existing halt semantics for structured runtime errors).
 *
 * Semantics (§Migration Strategy, AC-E4, EC-6):
 * - {@link RillError} (including {@link RuntimeError}, {@link AbortError},
 *   {@link AutoExceptionError}, {@link TimeoutError}, recovery halts)
 *   and internal control-flow {@link Error} subclasses ({@link ReturnSignal},
 *   {@link BreakSignal}, {@link YieldSignal}, `RuntimeHaltSignal`) continue
 *   to propagate so pre-existing halt semantics are preserved.
 * - Non-Error throws reshape to `#R999` with `.!raw.original = String(thrown)`
 *   (EC-6). This is the narrow unhandled-throw path because structured
 *   errors are carriers whose existing halt behavior must survive until
 *   Phase 5 cleanup.
 *
 * The {@link AbortError}/{@link AutoExceptionError} branches are wired
 * here as scaffolding for task 3.6, which owns the tests that flip the
 * migration semantics; those branches currently defer to the RillError
 * preservation rule and are preserved as comments so the reshape helpers
 * retain their binding to the §Migration Strategy contract.
 */
function reshapeUnhandledThrow(
  error: unknown,
  stmt: StatementNode | AnnotatedStatementNode | RecoveryErrorNode,
  ctx: RuntimeContext
): RillValue | undefined {
  // Preserve control-flow signals: these are legitimate non-error flows
  // carrying values/break/yield state through the statement boundary.
  if (
    error instanceof ReturnSignal ||
    (error instanceof Error && error.name === 'RuntimeHaltSignal') ||
    (error instanceof Error && error.name === 'BreakSignal') ||
    (error instanceof Error && error.name === 'YieldSignal')
  ) {
    return undefined;
  }

  // AC-E4 / EC-6 (Option A): Only reshape throws that originated at the
  // extension dispatch boundary (`invokeFnCallable`). Internal engine
  // halts (AbortError from checkAborted, AutoExceptionError from
  // checkAutoExceptions, TimeoutError, parse recoveries, RuntimeError
  // raised by runtime internals) continue to propagate so their
  // existing halt contracts survive.
  if (!isExtensionThrow(error)) {
    return undefined;
  }

  // §Migration Strategy: AbortError at the extension boundary reshapes
  // to `#DISPOSED`. Must precede the generic RillError branch because
  // AbortError extends RuntimeError (which extends RillError).
  if (error instanceof AbortError) {
    return makeBoundaryInvalid(
      {
        code: 'DISPOSED',
        provider: 'runtime',
        raw: { message: error.message },
      },
      stmt,
      ctx
    );
  }

  // §Migration Strategy: AutoExceptionError at the extension boundary
  // reshapes to `#R999`. Also precedes the generic RillError branch.
  if (error instanceof AutoExceptionError) {
    return makeBoundaryInvalid(
      {
        code: 'R999',
        provider: 'extension',
        raw: { message: error.message },
      },
      stmt,
      ctx
    );
  }

  // Preserve halt semantics for structured runtime errors raised at the
  // extension boundary (RuntimeError constructed by the extension itself,
  // TimeoutError, ParseError, RecoveryError emitters). These continue to
  // propagate so internal halts retain their existing contract.
  if (error instanceof RillError) {
    return undefined;
  }

  // AC-E4: Generic `Error` thrown from extension-provided host functions
  // reshapes to `#R999` at the script's mount point instead of surfacing
  // as a JS exception (§Migration Strategy). `raw.message` carries the
  // sanitised first line so formatHalt can render a diagnostic.
  if (error instanceof Error) {
    return makeBoundaryInvalid(
      {
        code: 'R999',
        provider: 'extension',
        raw: { message: sanitizeErrorMessage(error.message) },
      },
      stmt,
      ctx
    );
  }

  // EC-6: Non-Error throw -> #R999 with `.!raw.original = String(thrown)`.
  // This is the unhandled-throw path: provider code threw a non-Error
  // value (e.g. `throw "oops"` or `throw 42`). Reshape at the script's
  // mount point instead of propagating the raw JS throw upstream.
  return makeBoundaryInvalid(
    {
      code: 'R999',
      provider: 'extension',
      raw: { original: String(error) },
    },
    stmt,
    ctx
  );
}

/**
 * Strip trailing location suffixes and multi-line stack traces from a
 * caught Error's message before embedding it in `raw.message`. Mirrors
 * the helper used by `RuntimeContext.catch` (context.ts) so reshape
 * output is consistent across boundary paths.
 */
function sanitizeErrorMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.trim();
}

/**
 * Build the reshape invalid value with a `host`-kind trace frame pointing
 * at the statement span so post-halt diagnostics carry an origin frame.
 */
function makeBoundaryInvalid(
  meta: { code: string; provider: string; raw: Record<string, unknown> },
  stmt: StatementNode | AnnotatedStatementNode | RecoveryErrorNode,
  ctx: RuntimeContext
): RillValue {
  const site = formatAccessSite(stmt.span.start, ctx.sourceId);
  return invalidate(
    {},
    meta,
    createTraceFrame({ site, kind: 'host', fn: meta.provider })
  );
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
