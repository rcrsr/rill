/**
 * Rill Module
 * Exports lexer, parser, runtime, and AST types
 */

export { LexerError, tokenize } from './lexer/index.js';
export { parse, parseWithRecovery } from './parser/index.js';
export type { ParseResult, ErrorNode } from './types.js';
export {
  type ApplicationCallable,
  BreakSignal,
  callable,
  type CallableFn,
  type CaptureEvent,
  createRuntimeContext,
  createStepper,
  emitExtensionEvent,
  type ErrorEvent,
  execute,
  type ExecutionResult,
  type ExecutionStepper,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionResult,
  type HostCallEvent,
  type HostFunctionDefinition,
  type HostFunctionParam,
  type FunctionReturnEvent,
  isApplicationCallable,
  isTuple,
  isCallable,
  isDict,
  isReservedMethod,
  isRuntimeCallable,
  isScriptCallable,
  type ObservabilityCallbacks,
  prefixFunctions,
  RESERVED_DICT_METHODS,
  ReturnSignal,
  type RillTuple,
  type RillCallable,
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
} from './runtime/index.js';
export * from './types.js';
