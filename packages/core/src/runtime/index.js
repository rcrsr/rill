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
export { callable, isApplicationCallable, isCallable, isDict, isRuntimeCallable, isScriptCallable, validateHostFunctionArgs, validateReturnType, } from './core/callable.js';
export { isTuple, isReservedMethod, RESERVED_DICT_METHODS, } from './core/values.js';
// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================
export { BreakSignal, ReturnSignal } from './core/signals.js';
export { prefixFunctions, emitExtensionEvent } from './ext/extensions.js';
// ============================================================
// CONTEXT FACTORY
// ============================================================
export { createRuntimeContext } from './core/context.js';
export { getCallStack, pushCallFrame, popCallFrame } from './core/context.js';
// ============================================================
// SCRIPT EXECUTION
// ============================================================
export { createStepper, execute } from './core/execute.js';
export { getDocumentationCoverage, getFunctions, getLanguageReference, } from './core/introspection.js';
export { VERSION, VERSION_INFO } from '../generated/version-data.js';
//# sourceMappingURL=index.js.map