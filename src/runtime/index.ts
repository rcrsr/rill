/**
 * Rill Runtime
 *
 * Public API for executing Rill scripts.
 *
 * Module Structure:
 * - core/: Essential execution engine
 *   - types.ts: Public types (RuntimeContext, RuntimeOptions, etc.)
 *   - callable.ts: Callable types and type guards
 *   - values.ts: RillValue, RillTuple, and value utilities
 *   - signals.ts: Control flow signals (BreakSignal, ReturnSignal)
 *   - context.ts: Runtime context factory
 *   - execute.ts: Script execution (execute, createStepper)
 *   - evaluate.ts: AST evaluation (internal)
 *   - equals.ts: AST structural equality (internal)
 * - ext/: Self-contained extensions
 *   - builtins.ts: Built-in functions and methods
 *   - content-parser.ts: LLM output parsing utilities
 */

// ============================================================
// PUBLIC TYPES
// ============================================================

export type {
  CaptureEvent,
  ErrorEvent,
  ExecutionResult,
  ExecutionStepper,
  HostCallEvent,
  FunctionReturnEvent,
  ObservabilityCallbacks,
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  StepEndEvent,
  StepResult,
  StepStartEvent,
} from './core/types.js';

// ============================================================
// CALLABLE TYPES AND GUARDS
// ============================================================

export type {
  ApplicationCallable,
  CallableFn,
  HostFunctionDefinition,
  HostFunctionParam,
  RillCallable,
  RuntimeCallable,
  ScriptCallable,
} from './core/callable.js';

export {
  callable,
  isApplicationCallable,
  isCallable,
  isDict,
  isRuntimeCallable,
  isScriptCallable,
  validateHostFunctionArgs,
} from './core/callable.js';

// ============================================================
// VALUE TYPES AND UTILITIES
// ============================================================

export type { RillTuple, RillValue } from './core/values.js';

export {
  isTuple,
  isReservedMethod,
  RESERVED_DICT_METHODS,
} from './core/values.js';

// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================

export { BreakSignal, ReturnSignal } from './core/signals.js';

// ============================================================
// EXTENSION API
// ============================================================

export type { ExtensionEvent } from './core/types.js';

export type { ExtensionFactory, ExtensionResult } from './ext/extensions.js';

export { prefixFunctions, emitExtensionEvent } from './ext/extensions.js';

// ============================================================
// CONTEXT FACTORY
// ============================================================

export { createRuntimeContext } from './core/context.js';

// ============================================================
// SCRIPT EXECUTION
// ============================================================

export { createStepper, execute } from './core/execute.js';
