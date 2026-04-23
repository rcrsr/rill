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
 */

// ============================================================
// PUBLIC TYPES (from types/ barrel)
// ============================================================

export type { RillAtom } from './core/types/atom-registry.js';
export type { FieldComparisonCallbacks } from './core/types/operations.js';
export type {
  TypeDefinition,
  TypeProtocol,
} from './core/types/registrations.js';
export type {
  CaptureEvent,
  ErrorEvent,
  ExecutionResult,
  ExecutionStepper,
  ExtensionEvent,
  ExtensionFactoryCtx,
  FunctionReturnEvent,
  HostCallEvent,
  InvalidMeta,
  NativeArray,
  NativePlainObject,
  NativeValue,
  ObservabilityCallbacks,
  ResolverResult,
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
  StepEndEvent,
  StepResult,
  StepStartEvent,
} from './core/types/runtime.js';
export type { InvalidateMeta } from './core/types/status.js';
export type {
  RillAtomValue,
  RillDatetime,
  RillDuration,
  RillFieldDef,
  RillIterator,
  RillStatus,
  RillStream,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
  TypeStructure,
} from './core/types/structures.js';
export type { TraceFrame, TraceKind } from './core/types/trace.js';

// ============================================================
// CALLABLE TYPES AND GUARDS
// ============================================================

export type {
  ApplicationCallable,
  CallableFn,
  MarshalOptions,
  RillCallable,
  RillFunction,
  RillParam,
  RuntimeCallable,
  ScriptCallable,
} from './core/callable.js';

export {
  callable,
  hydrateFieldDefaults,
  isApplicationCallable,
  isCallable,
  isDict,
  isRuntimeCallable,
  isScriptCallable,
  marshalArgs,
  toCallable,
} from './core/callable.js';

// ============================================================
// VALUE TYPES AND UTILITIES
// ============================================================

export type { NativeResult } from './core/values.js';

// Extracted to types/ sub-modules (via barrel)
export {
  atomName,
  registerErrorCode,
  resolveAtom,
} from './core/types/atom-registry.js';
export {
  copyValue,
  createOrdered,
  createRillStream,
  createTuple,
  createVector,
} from './core/types/constructors.js';
export {
  getStatus,
  isAtom,
  isDatetime,
  isDuration,
  isInvalid,
  isIterator,
  isRillStream,
  isStream,
  isTuple,
  isTypeValue,
  isVacant,
  isVector,
} from './core/types/guards.js';
export {
  commonType,
  compareStructuredFields,
  formatRillLiteral,
  formatStructure,
  inferElementType,
  inferStructure,
  paramToFieldDef,
  structureEquals,
  structureMatches,
} from './core/types/operations.js';
export {
  BUILT_IN_TYPES,
  deepEquals,
  deserializeValue,
  formatValue,
  inferType,
  serializeValue,
} from './core/types/registrations.js';
export { formatHalt } from './core/types/status.js';

// Remain in values.ts
export {
  anyTypeValue,
  isEmpty,
  isReservedMethod,
  isTruthy,
  RESERVED_DICT_METHODS,
  structureToTypeValue,
  toNative,
} from './core/values.js';

export { buildFieldDescriptor } from './core/field-descriptor.js';

// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================

export { BreakSignal, ReturnSignal, YieldSignal } from './core/signals.js';
export { RuntimeHaltSignal } from './core/types/halt.js';

// ============================================================
// EXTENSION API
// ============================================================

export type {
  ConfigFieldDescriptor,
  ExtensionConfigSchema,
  ExtensionFactory,
  ExtensionFactoryResult,
  ExtensionManifest,
} from './ext/extensions.js';

export { emitExtensionEvent } from './ext/extensions.js';

// ============================================================
// BUILT-IN RESOLVERS
// ============================================================

export {
  contextResolver,
  extResolver,
  moduleResolver,
} from './core/resolvers.js';

// ============================================================
// CONTEXT FACTORY
// ============================================================

export { createRuntimeContext } from './core/context.js';

export {
  createTestContext,
  ExtensionBindingError,
} from './ext/test-context.js';

// ============================================================
// CALL STACK MANAGEMENT
// ============================================================

export type { CallFrame } from '../types.js';

export { getCallStack, pushCallFrame, popCallFrame } from './core/context.js';

// ============================================================
// SCRIPT EXECUTION
// ============================================================

export { createStepper, execute } from './core/execute.js';

// ============================================================
// CALLABLE INVOCATION
// ============================================================

export { invokeCallable } from './core/eval/index.js';

// ============================================================
// BUILT-IN METHODS
// ============================================================

export { BUILTIN_METHODS } from './ext/builtins.js';

// ============================================================
// INTROSPECTION API
// ============================================================

export type {
  DocumentationCoverageResult,
  FunctionMetadata,
  HandlerMetadataStatic,
  HandlerParamStatic,
  ParamMetadata,
} from './core/introspection.js';

export {
  generateManifest,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  introspectHandlerFromAST,
} from './core/introspection.js';

export type { VersionInfo } from '../generated/version-data.js';

export { VERSION, VERSION_INFO } from '../generated/version-data.js';
