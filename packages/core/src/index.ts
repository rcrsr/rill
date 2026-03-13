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
  callable,
  type CallableFn,
  type CallFrame,
  type CaptureEvent,
  type ConfigFieldDescriptor,
  createRuntimeContext,
  createStepper,
  createTuple,
  createVector,
  type DocumentationCoverageResult,
  emitExtensionEvent,
  contextResolver,
  extResolver,
  type ErrorEvent,
  execute,
  type ExecutionResult,
  type ExecutionStepper,
  type ExtensionConfigSchema,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionManifest,
  type ExtensionResult,
  type FsExtensionContract,
  type FunctionMetadata,
  hoistExtension,
  type HoistedExtension,
  type HostCallEvent,
  type FunctionReturnEvent,
  getCallStack,
  generateManifest,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  buildFieldDescriptor,
  buildTypeMethodDicts,
  formatStructuralType,
  inferElementType,
  inferStructuralType,
  inferType,
  invokeCallable,
  isApplicationCallable,
  moduleResolver,
  isTuple,
  isCallable,
  isDict,
  isReservedMethod,
  isRillIterator,
  isRuntimeCallable,
  isScriptCallable,
  isTypeValue,
  isVector,
  type KvExtensionContract,
  type NativeArray,
  type NativePlainObject,
  type NativeResult,
  type NativeValue,
  type LlmExtensionContract,
  type SchemaEntry,
  type ObservabilityCallbacks,
  type ParamMetadata,
  popCallFrame,
  prefixFunctions,
  pushCallFrame,
  RESERVED_DICT_METHODS,
  rillTypeToTypeValue,
  ReturnSignal,
  type RillCallable,
  type RillFunction,
  type RillParam,
  type RillIterator,
  type RillTuple,
  type RillType,
  type RillTypeValue,
  type RillValue,
  type RillVector,
  type RuntimeCallable,
  type ResolverResult,
  type RuntimeCallbacks,
  type RuntimeContext,
  type RuntimeOptions,
  type SchemeResolver,
  type ScriptCallable,
  type StepEndEvent,
  type StepResult,
  type StepStartEvent,
  type VectorExtensionContract,
  structuralTypeEquals,
  structuralTypeMatches,
  toNative,
  VERSION,
  VERSION_INFO,
  type VersionInfo,
} from './runtime/index.js';

/** @deprecated Use RillType instead. Will be removed in the next major version. */
export type { RillStructuralType } from './runtime/index.js';

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
// CONSTANTS
// ============================================================
export { VALID_TYPE_NAMES } from './constants.js';

// ============================================================
// SYNTAX HIGHLIGHTING
// ============================================================
export {
  type HighlightCategory,
  TOKEN_HIGHLIGHT_MAP,
} from './highlight-map.js';

export * from './types.js';
