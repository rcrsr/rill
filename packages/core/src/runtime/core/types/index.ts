/**
 * Types Module Barrel
 *
 * Re-exports all public symbols from the types/ sub-modules.
 * Internal runtime code may import sub-modules directly;
 * this barrel provides a single import path for runtime/index.ts
 * and other consumers.
 */

// ============================================================
// STRUCTURES (foundational value types and TypeStructure union)
// ============================================================

export type {
  RillAtomValue,
  RillDatetime,
  RillDuration,
  RillFieldDef,
  RillIterator,
  RillOrdered,
  RillStatus,
  RillStream,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
  TypeStructure,
} from './structures.js';

// ============================================================
// MARKERS (forward-declaration interfaces for circular dep breaking)
// ============================================================

export type { CallableMarker, FieldDescriptorMarker } from './markers.js';

// ============================================================
// GUARDS (type guard functions for all Rill value types)
// ============================================================

export {
  emptyStatus,
  getStatus,
  isAtom,
  isCallable,
  isDatetime,
  isDict,
  isDuration,
  isInvalid,
  isIterator,
  isOrdered,
  isRillStream,
  isStream,
  isTuple,
  isTypeValue,
  isVacant,
  isVector,
} from './guards.js';

// ============================================================
// STATUS & ATOM REGISTRY (error-handling sidecar surface)
// ============================================================

export type { InvalidateMeta } from './status.js';
export { formatHalt } from './status.js';
export { RuntimeHaltSignal } from './halt.js';
export type { RillAtom } from './atom-registry.js';
export { atomName, registerErrorCode, resolveAtom } from './atom-registry.js';
export type { TraceFrame, TraceKind } from './trace.js';
export { createTraceFrame, TRACE_KINDS } from './trace.js';

// ============================================================
// CONSTRUCTORS (factory functions for compound values)
// ============================================================

export {
  copyValue,
  createOrdered,
  createRillStream,
  createTuple,
  createVector,
  emptyForType,
} from './constructors.js';

// ============================================================
// OPERATIONS (structural comparison, matching, inference, formatting)
// ============================================================

export type {
  DictStructure,
  FieldComparisonCallbacks,
  OrderedStructure,
  TupleStructure,
} from './operations.js';

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
} from './operations.js';

// ============================================================
// REGISTRATIONS (type registry, protocol dispatch, serialization)
// ============================================================

export type { TypeDefinition, TypeProtocol } from './registrations.js';

export {
  BUILT_IN_TYPES,
  deepEquals,
  deserializeValue,
  formatValue,
  inferType,
  populateBuiltinMethods,
  serializeValue,
} from './registrations.js';

// ============================================================
// RUNTIME (context, options, observability, execution types)
// ============================================================

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
} from './runtime.js';

export { bindDictCallables } from './runtime.js';
