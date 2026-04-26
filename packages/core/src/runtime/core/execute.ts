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
import { RillError, RuntimeError } from '../../types.js';

// ============================================================
// HALT-SIGNAL MIGRATION BRIDGE (internal, phase-bounded)
// ============================================================
//
// `convertHaltToRuntimeError` attaches the halt's invalid `RillValue`
// payload to the rematerialised `RuntimeError` under a non-enumerable
// `haltValue` property so protected language tests
// (`tests/language/trace-frames.test.ts`) can assert wrap-frame
// structure on halts that escape the host boundary (IR-3, IR-5).
//
// The property is added via `Object.defineProperty` (non-enumerable,
// non-writable, non-configurable) to preserve the existing
// serialization shape of `RuntimeError` for consumers that iterate
// own keys. This declaration merging provides a compile-time contract
// so consumers can read `err.haltValue` without `as any` casts.
//
// @internal Attached only by `convertHaltToRuntimeError` during the
// halt-signal migration. Do not rely on this in host code outside the
// language-spec test surface.
declare module '../../error-classes.js' {
  interface RuntimeError {
    readonly haltValue?: RillValue;
  }
}
import {
  executeStatement,
  checkAutoExceptions,
  checkAborted,
} from './eval/index.js';
import { ControlSignal, ReturnSignal } from './signals.js';
import { isExtensionThrow } from './extension-throw.js';
import type {
  ExecutionResult,
  ExecutionStepper,
  RuntimeContext,
  StepResult,
} from './types/runtime.js';
import type { RillValue } from './types/structures.js';
import { getStatus, invalidate } from './types/status.js';
import { atomName, registerErrorCode } from './types/atom-registry.js';
import { RuntimeHaltSignal, throwFatalHostHalt } from './types/halt.js';
import { createTraceFrame } from './types/trace.js';
import { formatAccessSite } from './eval/mixins/access.js';

// ============================================================
// HALT-ATOM REGISTRATIONS (IC-6, Phase 2)
// ============================================================
//
// Atoms for fatal host halts thrown by execute() itself (frontmatter
// validation and script-no-value) are registered here at module load.
// The underscore form is required by ATOM_NAME_REGEX; the hyphen form
// (RILL-R043, RILL-R060) is the host-facing error ID in error-registry.ts.
//
// Idempotent: re-registering with the same kind is a no-op. Re-registering
// with a different kind throws, which would surface at module load.
registerErrorCode('RILL_R043', 'runtime');
registerErrorCode('RILL_R060', 'runtime');
// IC-5: closures.ts halt-builder migration atoms.
registerErrorCode('RILL_R001', 'runtime');
registerErrorCode('RILL_R005', 'runtime');
registerErrorCode('RILL_R006', 'runtime');
registerErrorCode('RILL_R007', 'runtime');
registerErrorCode('RILL_R008', 'runtime');
registerErrorCode('RILL_R009', 'runtime');
// IC-3: control-flow.ts assert halt site.
registerErrorCode('RILL_R015', 'runtime');

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
  try {
    // Guard against removed frontmatter keys
    if (script.frontmatter) {
      const content = script.frontmatter.content;
      if (/(?:^|\n)\s*use\s*:/.test(content)) {
        throwFatalHostHalt(
          {
            location: script.frontmatter.span.start,
            sourceId: context.sourceId,
            fn: 'execute',
          },
          'RILL_R060',
          'Frontmatter key removed: use: frontmatter removed; use use<module:...> instead'
        );
      }
      if (/(?:^|\n)\s*export\s*:/.test(content)) {
        throwFatalHostHalt(
          {
            location: script.frontmatter.span.start,
            sourceId: context.sourceId,
            fn: 'execute',
          },
          'RILL_R060',
          'Frontmatter key removed: export: frontmatter removed; use last-expression result instead'
        );
      }
    }

    const stepper = createStepper(script, context);
    while (!stepper.done) {
      await stepper.step();
    }
    return stepper.getResult();
  } catch (error) {
    // Convert fatal RuntimeHaltSignal instances that escape the stepper
    // (frontmatter validation and getResult() no-value halts) into
    // RuntimeError so host callers see the same err.errorId contract
    // they observed pre-migration (AC-NOD-6).
    if (error instanceof RuntimeHaltSignal) {
      const converted = convertHaltToRuntimeError(
        error,
        script as unknown as StatementNode
      );
      if (converted !== undefined) throw converted;
    }
    throw error;
  }
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
        // - RuntimeError rethrows to preserve halts
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

        // IR-5 surface: a non-catchable RuntimeHaltSignal that was not
        // caught by guard/retry must bubble out to the host as a
        // RuntimeError for backward compatibility with existing language
        // tests that assert `err.errorId`. We convert halts whose atom
        // code maps to a known host-facing runtime error ID (e.g.
        // `RILL_R016` -> `RILL-R016`). Trace-frame order is preserved on
        // the underlying invalid value for downstream `.!trace`
        // introspection; the conversion only wraps the halt in an Error
        // shape the host expects.
        if (error instanceof RuntimeHaltSignal) {
          const converted = convertHaltToRuntimeError(error, stmt);
          if (converted !== undefined) {
            context.observability.onError?.({ error: converted, index });
            throw converted;
          }
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
          throwFatalHostHalt(
            { sourceId: context.sourceId, fn: 'execute' },
            'RILL_R043',
            'Script produced no value'
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
 * `#R999` invalid values carried by the step's result.
 * Returns `undefined` when the throw should continue to propagate
 * (preserves existing halt semantics for structured runtime errors).
 *
 * Semantics (§Migration Strategy, AC-E4, EC-6):
 * - {@link RillError} (including {@link RuntimeError}, {@link TimeoutError},
 *   recovery halts) and internal control-flow {@link Error} subclasses
 *   ({@link ReturnSignal}, {@link BreakSignal}, {@link YieldSignal},
 *   `RuntimeHaltSignal`) continue to propagate so pre-existing halt
 *   semantics are preserved.
 * - Non-Error throws reshape to `#R999` with `.!raw.original = String(thrown)`
 *   (EC-6). This is the narrow unhandled-throw path because structured
 *   errors are carriers whose existing halt behavior must survive until
 *   Phase 5 cleanup.
 */
function reshapeUnhandledThrow(
  error: unknown,
  stmt: StatementNode | AnnotatedStatementNode | RecoveryErrorNode,
  ctx: RuntimeContext
): RillValue | undefined {
  // Preserve control-flow signals and halt signals: these are legitimate
  // non-error flows carrying values/break/yield/halt state through the
  // statement boundary.  ControlSignal covers all three subclasses
  // (BreakSignal, ReturnSignal, YieldSignal) uniformly via instanceof.
  if (error instanceof ControlSignal || error instanceof RuntimeHaltSignal) {
    return undefined;
  }

  // AC-E4 / EC-6 (Option A): Only reshape throws that originated at the
  // extension dispatch boundary (`invokeFnCallable`). Internal engine
  // halts (from checkAborted, checkAutoExceptions, TimeoutError, parse
  // recoveries, RuntimeError raised by runtime internals) continue to
  // propagate so their existing halt contracts survive.
  if (!isExtensionThrow(error)) {
    return undefined;
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

/**
 * Map from invalid-atom codes to host-facing RuntimeError IDs.
 *
 * Halt atom names use underscore form (ATOM_NAME_REGEX); host-facing
 * error IDs use hyphen form. The IR-5 migration replaces
 * `RuntimeError.fromNode('RILL-R016', ...)` with a `RuntimeHaltSignal`
 * carrying atom `RILL_R016`. When such a halt escapes guard/retry, we
 * rematerialise the old RuntimeError shape here so existing language
 * tests asserting `err.errorId` keep working.
 */
const HALT_ATOM_TO_ERROR_ID: Record<string, string> = {
  RILL_R016: 'RILL-R016',
  // IC-4: collections.ts halt-builder migration mappings.
  RILL_R002: 'RILL-R002',
  RILL_R003: 'RILL-R003',
  RILL_R010: 'RILL-R010',
  // IC-6: execute.ts frontmatter-validation and script-no-value halt sites.
  RILL_R043: 'RILL-R043',
  RILL_R060: 'RILL-R060',
  // Phase 2 migrations: closures.ts halt sites (IC-5).
  RILL_R001: 'RILL-R001',
  RILL_R005: 'RILL-R005',
  RILL_R006: 'RILL-R006',
  RILL_R007: 'RILL-R007',
  RILL_R008: 'RILL-R008',
  RILL_R009: 'RILL-R009',
  // Phase 2 migrations: control-flow.ts assert site (IC-3).
  RILL_R015: 'RILL-R015',
  // Evaluator-mixin migration: type-conversion and list-dispatch.
  RILL_R036: 'RILL-R036',
  RILL_R037: 'RILL-R037',
  RILL_R038: 'RILL-R038',
  RILL_R041: 'RILL-R041',
  RILL_R042: 'RILL-R042',
  RILL_R044: 'RILL-R044',
  // use.ts resolver migration.
  RILL_R054: 'RILL-R054',
  RILL_R055: 'RILL-R055',
  RILL_R056: 'RILL-R056',
  RILL_R057: 'RILL-R057',
  RILL_R058: 'RILL-R058',
  RILL_R061: 'RILL-R061',
};

/**
 * Convert a non-catchable `RuntimeHaltSignal` that escaped guard/retry
 * into a `RuntimeError` for host consumption (IR-5 surface path).
 *
 * Returns `undefined` when the halt's atom code has no registered
 * host-facing error ID; the caller falls back to rethrowing the signal
 * unchanged so abort / auto-exception halts (`#DISPOSED`, `#R999`)
 * preserve their existing propagation contract.
 *
 * The underlying invalid value's trace frames are not mutated: the host
 * error wraps the halt's message only. Downstream `.!trace` consumers
 * that inspect the invalid via recovery paths still see original
 * ordering (host frame first, optional wrap frame last).
 *
 * The original halt's invalid value is attached to the rematerialised
 * `RuntimeError` under the non-enumerable `haltValue` property so
 * language tests (`tests/language/trace-frames.test.ts`) can assert
 * wrap-frame structure on halts that escape the host boundary. The
 * property is non-enumerable to preserve serialization shape of
 * `RuntimeError` for existing consumers that iterate own keys.
 */
/**
 * Parse the source identifier from a TraceFrame.site string.
 *
 * Sites are formatted by halt.ts:formatSite as `<sourceId>:line:col`,
 * `<sourceId>` alone, or `"<unknown>"` / `"<script>"`. Returns `undefined`
 * when the source is a synthetic placeholder or no real file path is present.
 *
 * Used by convertHaltToRuntimeError to recover the originating module's
 * sourceId from a RuntimeHaltSignal's first trace frame so host callers see
 * the same `err.sourceId` contract they observed pre-migration (AC-NOD-6).
 */
function parseSourceIdFromSite(site: string): string | undefined {
  if (site === '<unknown>' || site === '<script>') return undefined;
  // Strip optional ":line:column" numeric suffix (e.g. "/path/to/greet.rill:1:5")
  const m = site.match(/^(.*?):\d+:\d+$/);
  const sourceId = m ? m[1] : site;
  if (sourceId === '<unknown>' || sourceId === '<script>') return undefined;
  return sourceId;
}

function convertHaltToRuntimeError(
  signal: RuntimeHaltSignal,
  stmt: StatementNode | AnnotatedStatementNode | RecoveryErrorNode
): RuntimeError | undefined {
  const status = getStatus(signal.value);
  const code = atomName(status.code);
  const errorId = HALT_ATOM_TO_ERROR_ID[code];
  if (errorId === undefined) return undefined;

  // Restore original context metadata: status.raw carries the message and any
  // extra payload fields (e.g. limit/iterations for RILL_R010). Strip the
  // message key and pass the rest as the RuntimeError context if non-empty.
  const rawDict = status.raw as Record<string, unknown>;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(rawDict)) {
    if (key !== 'message') rest[key] = rawDict[key];
  }
  const context: Record<string, unknown> | undefined =
    Object.keys(rest).length > 0 ? rest : undefined;

  const err = new RuntimeError(
    errorId,
    status.message,
    stmt.span.start,
    context,
    stmt.span
  );
  Object.defineProperty(err, 'haltValue', {
    value: signal.value,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  // Propagate sourceId from the first trace frame's site string so host
  // callers observe the same err.sourceId contract pre-migration (AC-NOD-6).
  // The first frame is the origin (origin-first ordering per appendFrame).
  const traces = status.trace;
  if (traces.length > 0) {
    const firstSite = traces[0]!.site;
    const sourceId = parseSourceIdFromSite(firstSite);
    if (sourceId !== undefined) {
      (err as { sourceId: string }).sourceId = sourceId;
    }
  }

  return err;
}
