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

export type {
  CaptureEvent,
  ErrorEvent,
  ExecutionResult,
  ExecutionStepper,
  ExtensionEvent,
  ExtensionFactoryCtx,
  FieldComparisonCallbacks,
  FunctionReturnEvent,
  HostCallEvent,
  InvalidateMeta,
  InvalidMeta,
  NativeArray,
  NativePlainObject,
  NativeValue,
  ObservabilityCallbacks,
  ResolverResult,
  RillCode,
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
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
  StepEndEvent,
  StepResult,
  StepStartEvent,
  TraceFrame,
  TraceKind,
  TypeDefinition,
  TypeProtocol,
  TypeStructure,
} from './core/types/index.js';

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
  BUILT_IN_TYPES,
  commonType,
  compareStructuredFields,
  copyValue,
  createOrdered,
  createRillStream,
  createTuple,
  createVector,
  deepEquals,
  deserializeValue,
  formatHalt,
  formatRillLiteral,
  formatStructure,
  formatValue,
  getStatus,
  inferElementType,
  inferStructure,
  inferType,
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
  paramToFieldDef,
  resolveAtom,
  serializeValue,
  structureEquals,
  structureMatches,
} from './core/types/index.js';

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
export { RuntimeHaltSignal } from './core/types/index.js';

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
