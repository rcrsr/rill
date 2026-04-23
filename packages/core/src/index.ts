/**
 * Rill Module
 * Exports lexer, parser, runtime, and AST types
 */

export { LexerError, tokenize, type TokenizeOptions } from './lexer/index.js';
export {
  parse,
  parseWithRecovery,
  parseTypeRef,
  createParserState,
  type ParserState,
} from './parser/index.js';
export type { ParseResult, RecoveryErrorNode, ErrorNode } from './types.js';
export {
  anyTypeValue,
  type ApplicationCallable,
  atomName,
  BreakSignal,
  BUILT_IN_TYPES,
  BUILTIN_METHODS,
  buildFieldDescriptor,
  callable,
  type CallableFn,
  type CallFrame,
  commonType,
  compareStructuredFields,
  type CaptureEvent,
  type ConfigFieldDescriptor,
  contextResolver,
  copyValue,
  createOrdered,
  createRillStream,
  createRuntimeContext,
  createStepper,
  createTestContext,
  createTuple,
  createVector,
  deepEquals,
  deserializeValue,
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
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type ExtensionManifest,
  extResolver,
  type FieldComparisonCallbacks,
  formatHalt,
  formatRillLiteral,
  formatStructure,
  formatValue,
  type FunctionMetadata,
  type FunctionReturnEvent,
  generateManifest,
  getCallStack,
  getDocumentationCoverage,
  getFunctions,
  getLanguageReference,
  getStatus,
  type HandlerMetadataStatic,
  type HandlerParamStatic,
  type HostCallEvent,
  hydrateFieldDefaults,
  inferElementType,
  inferStructure,
  inferType,
  introspectHandlerFromAST,
  type InvalidateMeta,
  type InvalidMeta,
  invokeCallable,
  isApplicationCallable,
  isAtom,
  isCallable,
  isDatetime,
  isDict,
  isDuration,
  isEmpty,
  isInvalid,
  isIterator,
  isReservedMethod,
  isRillStream,
  isRuntimeCallable,
  isScriptCallable,
  isStream,
  isTruthy,
  isTuple,
  isTypeValue,
  isVacant,
  isVector,
  marshalArgs,
  type MarshalOptions,
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
  registerErrorCode,
  RESERVED_DICT_METHODS,
  resolveAtom,
  type ResolverResult,
  ReturnSignal,
  RuntimeHaltSignal,
  YieldSignal,
  type RillAtom,
  type RillAtomValue,
  type RillCallable,
  type RillDatetime,
  type RillDuration,
  type RillFieldDef,
  type RillFunction,
  type RillIterator,
  type RillParam,
  type RillStatus,
  type RillStream,
  type RillTuple,
  type RillTypeValue,
  type RillValue,
  type RillVector,
  type RuntimeCallable,
  type RuntimeCallbacks,
  type RuntimeContext,
  type RuntimeOptions,
  type SchemeResolver,
  type ScriptCallable,
  serializeValue,
  type StepEndEvent,
  type StepResult,
  type StepStartEvent,
  structureEquals,
  structureMatches,
  structureToTypeValue,
  toCallable,
  toNative,
  type TraceFrame,
  type TraceKind,
  type TypeDefinition,
  type TypeProtocol,
  type TypeStructure,
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
export type { RillErrorData } from './error-classes.js';
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
