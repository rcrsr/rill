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
  ResolverResult,
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
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
  RillCallable,
  RillFunction,
  RillParam,
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
  toCallable,
} from './core/callable.js';

// ============================================================
// VALUE TYPES AND UTILITIES
// ============================================================

export type {
  NativeArray,
  NativePlainObject,
  NativeResult,
  NativeValue,
  RillFieldDef,
  RillIterator,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
  TypeStructure,
} from './core/values.js';

/** @deprecated Use TypeStructure instead. Will be removed in the next major version. */
export type { RillType } from './core/values.js';

export type {
  TypeDefinition,
  TypeProtocol,
} from './core/type-registrations.js';

export {
  anyTypeValue,
  commonType,
  createTuple,
  createVector,
  formatStructure,
  inferElementType,
  inferStructure,
  inferType,
  isIterator,
  isTuple,
  isTypeValue,
  isVector,
  isReservedMethod,
  paramToFieldDef,
  structureToTypeValue,
  RESERVED_DICT_METHODS,
  structureEquals,
  structureMatches,
  toNative,
} from './core/values.js';

// Deprecated aliases — old names kept for one release
/** @deprecated Use formatStructure instead. */
export { formatStructuralType } from './core/values.js';
/** @deprecated Use inferStructure instead. */
export { inferStructuralType } from './core/values.js';
/** @deprecated Use isIterator instead. */
export { isRillIterator } from './core/values.js';
/** @deprecated Use structureToTypeValue instead. */
export { rillTypeToTypeValue } from './core/values.js';
/** @deprecated Use structureEquals instead. */
export { structuralTypeEquals } from './core/values.js';
/** @deprecated Use structureMatches instead. */
export { structuralTypeMatches } from './core/values.js';

export { buildFieldDescriptor } from './core/field-descriptor.js';

// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================

export { BreakSignal, ReturnSignal } from './core/signals.js';

// ============================================================
// EXTENSION API
// ============================================================

export type { ExtensionEvent } from './core/types.js';

export type {
  ConfigFieldDescriptor,
  ExtensionConfigSchema,
  ExtensionFactory,
  ExtensionFactoryResult,
  ExtensionManifest,
  FsExtensionContract,
  KvExtensionContract,
  LlmExtensionContract,
  VectorExtensionContract,
} from './ext/extensions.js';

export type { SchemaEntry } from '../ext/kv/index.js';

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
// INTROSPECTION API
// ============================================================

export type {
  DocumentationCoverageResult,
  FunctionMetadata,
  ParamMetadata,
} from './core/introspection.js';

export {
  generateManifest,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
} from './core/introspection.js';

export type { VersionInfo } from '../generated/version-data.js';

export { VERSION, VERSION_INFO } from '../generated/version-data.js';
