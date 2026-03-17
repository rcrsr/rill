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
  FunctionReturnEvent,
  HostCallEvent,
  NativeArray,
  NativePlainObject,
  NativeValue,
  ObservabilityCallbacks,
  ResolverResult,
  RillFieldDef,
  RillIterator,
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

export type { NativeResult } from './core/values.js';

// Extracted to types/ sub-modules
export { inferType } from './core/types/registrations.js';
export {
  commonType,
  formatStructure,
  inferElementType,
  inferStructure,
  paramToFieldDef,
  structureEquals,
  structureMatches,
} from './core/types/operations.js';
export { createTuple, createVector } from './core/types/constructors.js';
export {
  isIterator,
  isTuple,
  isTypeValue,
  isVector,
} from './core/types/guards.js';

// Remain in values.ts
export {
  anyTypeValue,
  isReservedMethod,
  RESERVED_DICT_METHODS,
  structureToTypeValue,
  toNative,
} from './core/values.js';

export { buildFieldDescriptor } from './core/field-descriptor.js';

// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================

export { BreakSignal, ReturnSignal } from './core/signals.js';

// ============================================================
// EXTENSION API
// ============================================================

export type {
  ConfigFieldDescriptor,
  ExtensionConfigSchema,
  ExtensionFactory,
  ExtensionFactoryResult,
  ExtensionManifest,
  FsExtensionContract,
  KvExtensionContract,
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
