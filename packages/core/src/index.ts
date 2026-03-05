/**
 * Rill Module
 * Exports lexer, parser, runtime, and AST types
 */

export { LexerError, tokenize, type TokenizeOptions } from './lexer/index.js';
export { parse, parseWithRecovery } from './parser/index.js';
export type { ParseResult, RecoveryErrorNode, ErrorNode } from './types.js';
export {
  type ApplicationCallable,
  BreakSignal,
  callable,
  type CallableFn,
  type CallableParam,
  type CallFrame,
  type CaptureEvent,
  type ConfigFieldDescriptor,
  createRuntimeContext,
  createStepper,
  createTuple,
  createVector,
  type DocumentationCoverageResult,
  emitExtensionEvent,
  type ErrorEvent,
  execute,
  type ExecutionResult,
  type ExecutionStepper,
  type ExtensionConfigSchema,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionResult,
  type FsExtensionContract,
  type FunctionMetadata,
  hoistExtension,
  type HoistedExtension,
  type HostCallEvent,
  type HostFunctionDefinition,
  type HostFunctionParam,
  type FunctionReturnEvent,
  getCallStack,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  buildFieldDescriptor,
  formatStructuralType,
  inferElementType,
  inferStructuralType,
  inferType,
  invokeCallable,
  isApplicationCallable,
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
  type NativeValue,
  type LlmExtensionContract,
  type SchemaEntry,
  type ObservabilityCallbacks,
  type ParamMetadata,
  popCallFrame,
  prefixFunctions,
  pushCallFrame,
  RESERVED_DICT_METHODS,
  ReturnSignal,
  type RillCallable,
  type RillStructuralType,
  type RillFunctionReturnType,
  type RillIterator,
  type RillTuple,
  type RillTypeValue,
  type RillValue,
  type RillVector,
  type RuntimeCallable,
  type RuntimeCallbacks,
  type RuntimeContext,
  type RuntimeOptions,
  type ScriptCallable,
  type StepEndEvent,
  type StepResult,
  type StepStartEvent,
  type VectorExtensionContract,
  structuralTypeEquals,
  structuralTypeMatches,
  toNative,
  validateHostFunctionArgs,
  VERSION,
  VERSION_INFO,
  type VersionInfo,
} from './runtime/index.js';

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
