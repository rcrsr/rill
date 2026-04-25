/**
 * Rill Module
 * Exports lexer, parser, runtime, and AST types
 */

export { LexerError, tokenize } from './lexer/index.js';
export {
  parse,
  parseWithRecovery,
  parseTypeRef,
  createParserState,
} from './parser/index.js';
export type { ParseResult, RecoveryErrorNode, ErrorNode } from './types.js';
// ============================================================
// PUBLIC TYPES
// ============================================================

export type { FieldComparisonCallbacks } from './runtime/core/types/operations.js';
export type {
  TypeDefinition,
  TypeProtocol,
} from './runtime/core/types/registrations.js';
export type {
  CaptureEvent,
  ControlFlowContext,
  DispatchContext,
  ErrorEvent,
  ExecutionResult,
  ExecutionStepper,
  ExtensionEvent,
  ExtensionFactoryCtx,
  FunctionReturnEvent,
  HostCallEvent,
  LifecycleContext,
  MetadataContext,
  NativeArray,
  NativePlainObject,
  NativeValue,
  ObservabilityCallbacks,
  ResolverContext,
  ResolverResult,
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
  ScopeContext,
  StepEndEvent,
  StepResult,
  StepStartEvent,
} from './runtime/core/types/runtime.js';
export type { InvalidateMeta } from './runtime/core/types/status.js';
export type {
  RillAtomValue,
  RillDatetime,
  RillDuration,
  RillFieldDef,
  RillIterator,
  RillStream,
  RillTuple,
  RillTypeValue,
  RillValue,
  RillVector,
  TypeStructure,
} from './runtime/core/types/structures.js';
export type { TraceFrame, TraceKind } from './runtime/core/types/trace.js';

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
  ScriptCallable,
} from './runtime/core/callable.js';

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
} from './runtime/core/callable.js';

// ============================================================
// VALUE TYPES AND UTILITIES
// ============================================================

export type { NativeResult } from './runtime/core/values.js';

// Extracted to types/ sub-modules (via barrel)
export { atomName, resolveAtom } from './runtime/core/types/atom-registry.js';
export {
  copyValue,
  createOrdered,
  createRillStream,
  createTuple,
  createVector,
} from './runtime/core/types/constructors.js';
export {
  getStatus,
  isAtom,
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
} from './runtime/core/types/guards.js';
export {
  commonType,
  compareStructuredFields,
  formatRillLiteral,
  formatStructure,
  inferStructure,
  structureEquals,
  structureMatches,
} from './runtime/core/types/operations.js';
export {
  BUILT_IN_TYPES,
  deepEquals,
  deserializeValue,
  formatValue,
  inferType,
  serializeValue,
} from './runtime/core/types/registrations.js';
export { formatHalt } from './runtime/core/types/status.js';

// Remain in values.ts
export {
  anyTypeValue,
  isEmpty,
  isTruthy,
  structureToTypeValue,
  toNative,
} from './runtime/core/values.js';

export { buildFieldDescriptor } from './runtime/core/field-descriptor.js';

// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================

export {
  BreakSignal,
  ReturnSignal,
  YieldSignal,
} from './runtime/core/signals.js';
export { RuntimeHaltSignal } from './runtime/core/types/halt.js';

// ============================================================
// EXTENSION API
// ============================================================

export type {
  ConfigFieldDescriptor,
  ExtensionConfigSchema,
  ExtensionFactory,
  ExtensionFactoryResult,
  ExtensionManifest,
} from './runtime/ext/extensions.js';

export { emitExtensionEvent } from './runtime/ext/extensions.js';

// ============================================================
// BUILT-IN RESOLVERS
// ============================================================

export {
  contextResolver,
  extResolver,
  moduleResolver,
} from './runtime/core/resolvers.js';

// ============================================================
// CONTEXT FACTORY
// ============================================================

export {
  createRuntimeContext,
  createChildContext,
  getVariable,
  hasVariable,
} from './runtime/core/context.js';

export {
  createTestContext,
  ExtensionBindingError,
} from './runtime/ext/test-context.js';

// ============================================================
// CALL STACK MANAGEMENT
// ============================================================

export type { CallFrame } from './types.js';

export {
  getCallStack,
  pushCallFrame,
  popCallFrame,
} from './runtime/core/context.js';

// ============================================================
// SCRIPT EXECUTION
// ============================================================

export { createStepper, execute } from './runtime/core/execute.js';

// ============================================================
// CALLABLE INVOCATION
// ============================================================

export { invokeCallable } from './runtime/core/eval/index.js';

// ============================================================
// BUILT-IN METHODS
// ============================================================

export { BUILTIN_METHODS } from './runtime/ext/builtins.js';

// ============================================================
// INTROSPECTION API
// ============================================================

export type {
  DocumentationCoverageResult,
  FunctionMetadata,
  HandlerMetadataStatic,
  HandlerParamStatic,
  ParamMetadata,
} from './runtime/core/introspection.js';

export {
  generateManifest,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  introspectHandlerFromAST,
} from './runtime/core/introspection.js';

export type { VersionInfo } from './generated/version-data.js';

export { VERSION, VERSION_INFO } from './generated/version-data.js';

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

// ============================================================
// AST, TYPE, ERROR, TOKEN DEFINITIONS
// Surfaces formerly exposed via `export * from './types.js'`.
// Keep this list explicit so additions to the underlying files are
// not accidentally published. Use `pnpm exec tsx scripts/list-public-exports.ts`
// to audit the full public surface.
// ============================================================

// --- from ./ast-nodes.js ---
export type {
  AnnotatedExprNode,
  AnnotatedStatementNode,
  AnnotationAccessNode,
  AnnotationArg,
  ArithHead,
  AssertNode,
  ASTNode,
  AtomLiteralNode,
  BinaryExprNode,
  BinaryOp,
  BlockNode,
  BodyNode,
  BoolLiteralNode,
  BracketAccess,
  BreakNode,
  CaptureNode,
  ChainTerminator,
  ClosureCallNode,
  ClosureNode,
  ClosureParamNode,
  ClosureSigLiteralNode,
  ConditionalNode,
  DestructNode,
  DestructPatternNode,
  DestructureNode,
  DictEntryNode,
  DictKeyComputed,
  DictKeyVariable,
  DictLiteralNode,
  DictNode,
  DoWhileLoopNode,
  ExistenceCheck,
  ExpressionNode,
  FieldAccess,
  FieldAccessAlternatives,
  FieldAccessAnnotation,
  FieldAccessBlock,
  FieldAccessComputed,
  FieldAccessLiteral,
  FieldAccessVariable,
  FrontmatterNode,
  GroupedExprNode,
  GuardBlockNode,
  HostCallNode,
  HostRefNode,
  InterpolationNode,
  InvokeNode,
  ListLiteralNode,
  ListSpreadNode,
  LiteralNode,
  MethodCallNode,
  NamedArgNode,
  NumberLiteralNode,
  OrderedLiteralNode,
  PassNode,
  PipeChainNode,
  PipeInvokeNode,
  PipeTargetNode,
  PostfixExprNode,
  PrimaryNode,
  PropertyAccess,
  RetryBlockNode,
  ReturnNode,
  ScriptNode,
  SimplePrimaryNode,
  SliceBoundNode,
  SliceNode,
  SpreadArgNode,
  StatementNode,
  StatusProbeNode,
  StringLiteralNode,
  TupleLiteralNode,
  TypeAssertionNode,
  TypeCheckNode,
  TypeConstructorNode,
  TypeNameExprNode,
  UnaryExprNode,
  UseExprNode,
  UseIdentifier,
  VariableNode,
  WhileLoopNode,
  YieldNode,
} from './ast-nodes.js';

// --- from ./ast-unions.js ---
export type { NodeType } from './ast-unions.js';

// --- from ./error-classes.js ---
export {
  ParseError,
  RillError,
  RuntimeError,
  TimeoutError,
} from './error-classes.js';

// --- from ./error-patterns.js ---
export type {
  ErrorHandlingExample,
  ErrorHandlingPattern,
} from './error-patterns.js';
export { ERROR_HANDLING_PATTERNS } from './error-patterns.js';

// --- from ./error-registry.js ---
export type { ErrorExample, ErrorRegistry } from './error-registry.js';

// --- from ./source-location.js ---
export type { SourceLocation, SourceSpan } from './source-location.js';

// --- from ./token-types.js ---
export type { Token, TokenType } from './token-types.js';
export { TOKEN_TYPES } from './token-types.js';

// --- from ./types.js ---
export type { ParseOptions } from './types.js';

// --- from ./value-types.js ---
export type { FieldArg, RillTypeName, TypeRef } from './value-types.js';

// ============================================================
// CONSTANTS
// ============================================================
export { VALID_TYPE_NAMES } from './constants.js';
