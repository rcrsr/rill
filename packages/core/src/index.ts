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
  type CallFrame,
  type CaptureEvent,
  createRuntimeContext,
  createStepper,
  type DocumentationCoverageResult,
  emitExtensionEvent,
  type ErrorEvent,
  execute,
  type ExecutionResult,
  type ExecutionStepper,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionResult,
  type FunctionMetadata,
  type HostCallEvent,
  type HostFunctionDefinition,
  type HostFunctionParam,
  type FunctionReturnEvent,
  getCallStack,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  isApplicationCallable,
  isTuple,
  isCallable,
  isDict,
  isReservedMethod,
  isRuntimeCallable,
  isScriptCallable,
  type ObservabilityCallbacks,
  type ParamMetadata,
  popCallFrame,
  prefixFunctions,
  pushCallFrame,
  RESERVED_DICT_METHODS,
  ReturnSignal,
  type RillTuple,
  type RillCallable,
  type RillFunctionReturnType,
  type RillValue,
  type RuntimeCallable,
  type RuntimeCallbacks,
  type RuntimeContext,
  type RuntimeOptions,
  type ScriptCallable,
  type StepEndEvent,
  type StepResult,
  type StepStartEvent,
  validateHostFunctionArgs,
  validateReturnType,
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
// SYNTAX HIGHLIGHTING
// ============================================================
export {
  type HighlightCategory,
  TOKEN_HIGHLIGHT_MAP,
} from './highlight-map.js';

export * from './types.js';
