/**
 * Rill Module
 * Exports lexer, parser, runtime, and AST types
 */

export { LexerError, tokenize, type TokenizeOptions } from './lexer/index.js';
export { parse, parseWithRecovery } from './parser/index.js';
export type { ParseResult, RecoveryErrorNode, ErrorNode } from './types.js';
export {
  anyTypeValue,
  type ApplicationCallable,
  BreakSignal,
  buildFieldDescriptor,
  callable,
  type CallableFn,
  type CallFrame,
  commonType,
  type CaptureEvent,
  type ConfigFieldDescriptor,
  contextResolver,
  createRuntimeContext,
  createStepper,
  createTestContext,
  createTuple,
  createVector,
  type DocumentationCoverageResult,
  emitExtensionEvent,
  type ErrorEvent,
  execute,
  type ExecutionResult,
  type ExecutionStepper,
  ExtensionBindingError,
  type ExtensionConfigSchema,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionFactoryResult,
  type ExtensionManifest,
  extResolver,
  formatStructure,
  type FsExtensionContract,
  type FunctionMetadata,
  type FunctionReturnEvent,
  generateManifest,
  getCallStack,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  type HostCallEvent,
  inferElementType,
  inferStructure,
  inferType,
  invokeCallable,
  isApplicationCallable,
  isCallable,
  isDict,
  isIterator,
  isReservedMethod,
  isRuntimeCallable,
  isScriptCallable,
  isTuple,
  isTypeValue,
  isVector,
  type KvExtensionContract,
  type LlmExtensionContract,
  moduleResolver,
  type NativeArray,
  type NativePlainObject,
  type NativeResult,
  type NativeValue,
  type ObservabilityCallbacks,
  type ParamMetadata,
  paramToFieldDef,
  popCallFrame,
  pushCallFrame,
  RESERVED_DICT_METHODS,
  type ResolverResult,
  ReturnSignal,
  type RillCallable,
  type RillFieldDef,
  type RillFunction,
  type RillIterator,
  type RillParam,
  type RillTuple,
  type RillTypeValue,
  type RillValue,
  type RillVector,
  type RuntimeCallable,
  type RuntimeCallbacks,
  type RuntimeContext,
  type RuntimeOptions,
  type SchemaEntry,
  type SchemeResolver,
  type ScriptCallable,
  type StepEndEvent,
  type StepResult,
  type StepStartEvent,
  structureEquals,
  structureMatches,
  structureToTypeValue,
  toCallable,
  toNative,
  type TypeDefinition,
  type TypeProtocol,
  type TypeStructure,
  type VectorExtensionContract,
  VERSION,
  VERSION_INFO,
  type VersionInfo,
} from './runtime/index.js';

/** @deprecated Use TypeStructure instead. Will be removed in the next major version. */
export type { RillType } from './runtime/index.js';

// Deprecated aliases — old names kept for one release
/** @deprecated Use formatStructure instead. */
export { formatStructuralType } from './runtime/index.js';
/** @deprecated Use inferStructure instead. */
export { inferStructuralType } from './runtime/index.js';
/** @deprecated Use isIterator instead. */
export { isRillIterator } from './runtime/index.js';
/** @deprecated Use structureToTypeValue instead. */
export { rillTypeToTypeValue } from './runtime/index.js';
/** @deprecated Use structureEquals instead. */
export { structuralTypeEquals } from './runtime/index.js';
/** @deprecated Use structureMatches instead. */
export { structuralTypeMatches } from './runtime/index.js';

// ============================================================
// ERROR TAXONOMY
// ============================================================
export {
  type ErrorCategory,
  type ErrorDefinition,
  type ErrorSeverity,
  ERROR_REGISTRY,
  renderMessage,
  getHelpUrl,
  createError,
} from './types.js';

// ============================================================
// ERROR FORMATTING
// ============================================================
export {
  formatRillError,
  formatRillErrorJson,
  type FormatErrorOptions,
  type FormatErrorJsonOptions,
  type SourceMap,
} from './error-formatter.js';

// ============================================================
// SYNTAX HIGHLIGHTING
// ============================================================
export {
  type HighlightCategory,
  TOKEN_HIGHLIGHT_MAP,
} from './highlight-map.js';

export * from './types.js';
