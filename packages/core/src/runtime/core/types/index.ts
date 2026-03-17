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
  RillFieldDef,
  RillIterator,
  RillOrdered,
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
  isCallable,
  isDict,
  isIterator,
  isOrdered,
  isTuple,
  isTypeValue,
  isVector,
} from './guards.js';

// ============================================================
// CONSTRUCTORS (factory functions for compound values)
// ============================================================

export {
  copyValue,
  createOrdered,
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
  FunctionReturnEvent,
  HostCallEvent,
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
