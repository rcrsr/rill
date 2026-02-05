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
export type { CaptureEvent, ErrorEvent, ExecutionResult, ExecutionStepper, HostCallEvent, FunctionReturnEvent, ObservabilityCallbacks, RuntimeCallbacks, RuntimeContext, RuntimeOptions, StepEndEvent, StepResult, StepStartEvent, } from './core/types.js';
export type { ApplicationCallable, CallableFn, HostFunctionDefinition, HostFunctionParam, RillCallable, RillFunctionReturnType, RuntimeCallable, ScriptCallable, } from './core/callable.js';
export { callable, isApplicationCallable, isCallable, isDict, isRuntimeCallable, isScriptCallable, validateHostFunctionArgs, validateReturnType, } from './core/callable.js';
export type { RillTuple, RillValue } from './core/values.js';
export { isTuple, isReservedMethod, RESERVED_DICT_METHODS, } from './core/values.js';
export { BreakSignal, ReturnSignal } from './core/signals.js';
export type { ExtensionEvent } from './core/types.js';
export type { ExtensionFactory, ExtensionResult } from './ext/extensions.js';
export { prefixFunctions, emitExtensionEvent } from './ext/extensions.js';
export { createRuntimeContext } from './core/context.js';
export type { CallFrame } from '../types.js';
export { getCallStack, pushCallFrame, popCallFrame } from './core/context.js';
export { createStepper, execute } from './core/execute.js';
export type { DocumentationCoverageResult, FunctionMetadata, ParamMetadata, } from './core/introspection.js';
export { getDocumentationCoverage, getFunctions, getLanguageReference, } from './core/introspection.js';
export type { VersionInfo } from '../generated/version-data.js';
export { VERSION, VERSION_INFO } from '../generated/version-data.js';
//# sourceMappingURL=index.d.ts.map