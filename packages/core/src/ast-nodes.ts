import type { SourceSpan } from './source-location.js';
import type { RillTypeName, TypeRef } from './value-types.js';

interface BaseNode {
  readonly span: SourceSpan;
}

// ============================================================
// SCRIPT STRUCTURE
// ============================================================

export interface ScriptNode extends BaseNode {
  readonly type: 'Script';
  readonly frontmatter: FrontmatterNode | null;
  /** Statements in the script. May include RecoveryErrorNode when parsed with recoveryMode. */
  readonly statements: (
    | StatementNode
    | AnnotatedStatementNode
    | RecoveryErrorNode
  )[];
}

export interface FrontmatterNode extends BaseNode {
  readonly type: 'Frontmatter';
  readonly content: string; // Raw YAML content
}

/**
 * Closure: |params| body
 * First-class closure with optional typed parameters and defaults.
 * Scope rules: captures outer (read-only), local mutable.
 *
 * Body can be:
 * - Simple: |x| $x (postfix-expr)
 * - Grouped: |x| ($x * 2) (compound expression)
 * - Block: |x| { $a ↵ $b } (multiple statements)
 *
 * Optional postfix return type target: |params| body :type-target
 * Asserts the closure return value against the type target at invocation time.
 * `:any` is valid and equivalent to omission.
 */
export interface ClosureNode extends BaseNode {
  readonly type: 'Closure';
  readonly params: ClosureParamNode[];
  readonly body: BodyNode;
  readonly returnTypeTarget?: TypeRef | TypeConstructorNode | undefined;
}

/**
 * Function parameter with optional type and default value.
 * - (x) { }           -- untyped
 * - (x: string) { }   -- typed
 * - (x: string = "hi") { }  -- typed with default
 * - ^(key: value) (x) { }  -- with parameter annotations
 */
export interface ClosureParamNode extends BaseNode {
  readonly type: 'ClosureParam';
  readonly name: string;
  readonly typeRef: TypeRef | null; // null = untyped
  readonly defaultValue: LiteralNode | null;
  readonly annotations?: AnnotationArg[] | undefined; // Parameter-level annotations (default: empty array)
}

// ============================================================
// STATEMENTS
// ============================================================

/**
 * Statement: a pipe chain expression.
 * Termination (capture/break/return) is now part of PipeChainNode.
 */
export interface StatementNode extends BaseNode {
  readonly type: 'Statement';
  readonly expression: PipeChainNode;
}

/**
 * Recovery error node for parse error recovery mode.
 * Represents unparseable content that was skipped during error recovery.
 * Only appears in ASTs when parsing with `recoveryMode: true`.
 */
export interface RecoveryErrorNode extends BaseNode {
  readonly type: 'RecoveryError';
  /** The error message describing what went wrong */
  readonly message: string;
  /** The raw source text that could not be parsed */
  readonly text: string;
}

// ============================================================
// ANNOTATIONS
// ============================================================

/**
 * Annotated statement: ^(key: value, ...) statement
 * Annotations modify operational parameters for statements.
 * They prefix statements and bind to the immediately following construct.
 *
 * Examples:
 *   ^(limit: 100) $items @ process()
 *   ^(timeout: 30) fetch($url)
 *   ^(retry: 3, backoff: 1.5) api_call()
 */
export interface AnnotatedStatementNode extends BaseNode {
  readonly type: 'AnnotatedStatement';
  readonly annotations: AnnotationArg[];
  readonly statement: StatementNode;
}

/**
 * Annotation argument: named or spread
 * Reuses similar structure to dict entries but with spread support.
 */
export type AnnotationArg = NamedArgNode | SpreadArgNode;

/**
 * Named annotation argument: key: value
 * Example: limit: 100, timeout: 30
 */
export interface NamedArgNode extends BaseNode {
  readonly type: 'NamedArg';
  readonly name: string;
  readonly value: ExpressionNode;
}

/**
 * Spread annotation argument: *expr
 * Example: *$opts spreads tuple keys as annotations
 */
export interface SpreadArgNode extends BaseNode {
  readonly type: 'SpreadArg';
  readonly expression: ExpressionNode;
}

export interface CaptureNode extends BaseNode {
  readonly type: 'Capture';
  readonly name: string;
  /**
   * Optional explicit type annotation: $name:type or $name:$t
   */
  readonly typeRef: TypeRef | null;
  readonly inlineShape: null;
}

/**
 * Break: exit loop with current pipe value.
 * Used as chain terminator: $x -> break
 * Or bare: break (implicit $ -> break)
 */
export interface BreakNode extends BaseNode {
  readonly type: 'Break';
}

/**
 * Return: exit closure with current pipe value.
 * Used as chain terminator: $x -> return
 * Or bare: return (implicit $ -> return)
 */
export interface ReturnNode extends BaseNode {
  readonly type: 'Return';
}

/**
 * Pass: pass through pipe value unchanged.
 * Used as chain terminator: $x -> pass
 * Or bare: pass (implicit $ -> pass)
 */
export interface PassNode extends BaseNode {
  readonly type: 'Pass';
}

/**
 * Assert: halt execution if condition is false.
 * Syntax: assert condition
 * Or: assert condition "custom error message"
 */
export interface AssertNode extends BaseNode {
  readonly type: 'Assert';
  readonly condition: ExpressionNode;
  readonly message: StringLiteralNode | null;
}

/**
 * Error: explicitly raise an error with a message.
 * Syntax: error "message"
 * Or: error "interpolated {$var} message"
 */
export interface ErrorNode extends BaseNode {
  readonly type: 'Error';
  readonly message: StringLiteralNode | null;
}

// ============================================================
// EXPRESSIONS
// ============================================================

export type ExpressionNode = PipeChainNode;

/** Chain terminator: capture, break, or return */
export type ChainTerminator = CaptureNode | BreakNode | ReturnNode;

export interface PipeChainNode extends BaseNode {
  readonly type: 'PipeChain';
  readonly head: ArithHead;
  /**
   * Pipe targets and inline captures.
   * Inline captures act as implicit .set() — store value and return unchanged.
   * Semantically: "-> $a ->" ≡ "-> $a.set($) ->"
   */
  readonly pipes: (PipeTargetNode | CaptureNode)[];
  /**
   * Chain terminator: final capture, break, or return.
   * Examples:
   *   $x -> $y         terminator = Capture($y)
   *   $x -> break      terminator = Break
   *   $x -> return     terminator = Return
   *   $x -> .method    terminator = null
   */
  readonly terminator: ChainTerminator | null;
}

export interface PostfixExprNode extends BaseNode {
  readonly type: 'PostfixExpr';
  readonly primary: PrimaryNode;
  readonly methods: (MethodCallNode | InvokeNode | AnnotationAccessNode)[];
  readonly defaultValue: BodyNode | null;
}

export type PrimaryNode =
  | LiteralNode
  | ListLiteralNode
  | DictLiteralNode
  | TupleLiteralNode
  | OrderedLiteralNode
  | VariableNode
  | HostCallNode
  | HostRefNode
  | AnnotatedExprNode
  | ClosureCallNode
  | MethodCallNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | AssertNode
  | ErrorNode
  | PassNode
  | GroupedExprNode
  | TypeAssertionNode
  | TypeCheckNode
  | TypeNameExprNode
  | TypeConstructorNode
  | ClosureSigLiteralNode
  | UseExprNode;

export type PipeTargetNode =
  | HostCallNode
  | HostRefNode
  | ClosureCallNode
  | MethodCallNode
  | PipeInvokeNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | ClosureNode
  | StringLiteralNode
  | DictNode
  | GroupedExprNode
  | DestructureNode
  | SliceNode
  | TypeAssertionNode
  | TypeCheckNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | PostfixExprNode
  | VariableNode
  | AssertNode
  | ErrorNode
  | AnnotationAccessNode
  | ConvertNode
  | DestructNode
  | ListLiteralNode
  | UseExprNode;

/** Invoke pipe value as a closure: -> $() or -> $(arg1, arg2) */
export interface PipeInvokeNode extends BaseNode {
  readonly type: 'PipeInvoke';
  readonly args: (ExpressionNode | SpreadArgNode)[];
}

// ============================================================
// LITERALS
// ============================================================

export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BoolLiteralNode
  | ListLiteralNode
  | DictNode
  | ClosureNode;

export interface StringLiteralNode extends BaseNode {
  readonly type: 'StringLiteral';
  readonly parts: (string | InterpolationNode)[];
  readonly isMultiline: boolean;
}

export interface InterpolationNode extends BaseNode {
  readonly type: 'Interpolation';
  readonly expression: ExpressionNode;
}

export interface NumberLiteralNode extends BaseNode {
  readonly type: 'NumberLiteral';
  readonly value: number;
}

export interface BoolLiteralNode extends BaseNode {
  readonly type: 'BoolLiteral';
  readonly value: boolean;
}

export interface ListSpreadNode extends BaseNode {
  readonly type: 'ListSpread';
  readonly expression: ExpressionNode;
}

export interface DictNode extends BaseNode {
  readonly type: 'Dict';
  readonly entries: DictEntryNode[];
  readonly defaultValue: BodyNode | null;
}

export interface DictKeyVariable {
  readonly kind: 'variable';
  readonly variableName: string;
}

export interface DictKeyComputed {
  readonly kind: 'computed';
  readonly expression: ExpressionNode;
}

export interface DictEntryNode extends BaseNode {
  readonly type: 'DictEntry';
  readonly key:
    | string
    | number
    | boolean
    | ListLiteralNode
    | DictKeyVariable
    | DictKeyComputed;
  readonly value: ExpressionNode;
}

/**
 * Type constructor: list(string), dict(string, number), tuple(string, number), ordered(string)
 * Constructs a parameterized type expression for use in type assertions and shape constraints.
 *
 * Examples:
 *   list(string)
 *   dict(string, number)
 *   tuple(string, number, boolean)
 *   ordered(string)
 *   list(element: string)
 */
export interface TypeConstructorNode extends BaseNode {
  readonly type: 'TypeConstructor';
  readonly constructorName: 'list' | 'dict' | 'tuple' | 'ordered';
  readonly args: TypeConstructorArg[];
}

export type TypeConstructorArg =
  | { kind: 'positional'; value: ExpressionNode }
  | { kind: 'named'; name: string; value: ExpressionNode };

/**
 * Closure signature literal: |param: type, ...| :returnType
 * Represents a closure type signature as a first-class value.
 * Distinguished from a closure literal by absence of a `{` body block.
 *
 * Examples:
 *   |x: string| :number
 *   |a: string, b: number| :boolean
 */
export interface ClosureSigLiteralNode extends BaseNode {
  readonly type: 'ClosureSigLiteral';
  readonly params: { name: string; typeExpr: ExpressionNode }[];
  readonly returnType: PostfixExprNode;
}

// ============================================================
// ARITHMETIC & GROUPED EXPRESSIONS
// ============================================================

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%' // arithmetic
  | '&&'
  | '||' // logical
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='; // comparison

/**
 * Expression head types for binary/unary expressions.
 * Includes arithmetic (+, -, *, /, %) and logical (&&, ||, !) operators.
 */
export type ArithHead = BinaryExprNode | UnaryExprNode | PostfixExprNode;

/**
 * Binary expression: left op right
 * Arithmetic: ($x + 5), ($a * $b), (2 + 3 * 4)
 * Logical: ($a && $b), ($x || $y)
 */
export interface BinaryExprNode extends BaseNode {
  readonly type: 'BinaryExpr';
  readonly op: BinaryOp;
  readonly left: ArithHead;
  readonly right: ArithHead;
}

/**
 * Unary expression: -operand or !operand
 * Examples: (-5), (-$x), (!$ready)
 */
export interface UnaryExprNode extends BaseNode {
  readonly type: 'UnaryExpr';
  readonly op: '-' | '!';
  readonly operand: UnaryExprNode | PostfixExprNode;
}

/**
 * Grouped expression: ( expression )
 * Single-expression block with () delimiters.
 * Provides scoping — captures inside are local and not visible outside.
 *
 * Scoping rules identical to blocks:
 *   ("hello" -> $local)  — $local is scoped to group, returns "hello"
 */
export interface GroupedExprNode extends BaseNode {
  readonly type: 'GroupedExpr';
  readonly expression: PipeChainNode;
}

/**
 * Simple body: expression that can follow closure params, conditionals, or loops.
 * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
 *
 * Valid: block, grouped, or postfix-expr (variable, literal, method, function call)
 * Examples:
 *   |x| $x           — postfix-expr
 *   |x| ($x * 2)     — grouped (compound)
 *   |x| { $a ↵ $b }  — block (multiple statements)
 */
export type BodyNode =
  | BlockNode
  | GroupedExprNode
  | PostfixExprNode
  | PipeChainNode;

// ============================================================
// VARIABLES
// ============================================================

export interface VariableNode extends BaseNode {
  readonly type: 'Variable';
  readonly name: string | null; // null for $ (pipe variable)
  readonly isPipeVar: boolean;
  /** Ordered chain of property accesses: .name, [0], .$var, etc. */
  readonly accessChain: PropertyAccess[];
  /**
   * Default value for null-coalescing: $data.path ?? default
   * If property access returns null/missing, use this value instead.
   */
  readonly defaultValue: BodyNode | null;
  /**
   * Existence check on final path element: $data.?path
   * Returns boolean (true if path exists).
   * When set, implies safe traversal (no error on missing intermediate paths).
   */
  readonly existenceCheck: ExistenceCheck | null;
}

/**
 * Existence check configuration.
 * For .?path (just exists) or .?path&type (exists AND type matches).
 */
export interface ExistenceCheck {
  /** The final field/index being checked for existence */
  readonly finalAccess: FieldAccess;
  /** Optional type check: returns true only if exists AND matches type */
  readonly typeRef: TypeRef | null;
}

/**
 * Field access element in a property access chain (dot-based).
 *
 * Access forms:
 * - literal: .identifier (string key)
 * - variable: .$var (variable as key)
 * - computed: .(expr) (computed expression)
 * - block: .{block} (block returning key)
 * - alternatives: .(a || b) (try keys left-to-right)
 *
 * Note: Numeric indices use bracket syntax [0], [-1] instead of dot.
 */
export type FieldAccess =
  | FieldAccessLiteral
  | FieldAccessVariable
  | FieldAccessComputed
  | FieldAccessBlock
  | FieldAccessAlternatives
  | FieldAccessAnnotation;

/** Literal field access: .identifier */
export interface FieldAccessLiteral {
  readonly kind: 'literal';
  readonly field: string;
}

/** Variable as key: .$var or .$ (pipe variable) */
export interface FieldAccessVariable {
  readonly kind: 'variable';
  readonly variableName: string | null; // null for pipe variable ($)
}

/** Computed expression: .(expr) */
export interface FieldAccessComputed {
  readonly kind: 'computed';
  readonly expression: ExpressionNode;
}

/** Block returning key: .{block} */
export interface FieldAccessBlock {
  readonly kind: 'block';
  readonly block: BlockNode;
}

/** Alternatives (try keys left-to-right): .(a || b) */
export interface FieldAccessAlternatives {
  readonly kind: 'alternatives';
  readonly alternatives: string[];
}

/** Annotation reflection: .^key */
export interface FieldAccessAnnotation {
  readonly kind: 'annotation';
  readonly key: string;
}

/**
 * Bracket index access: [expr]
 * Used for numeric indexing into lists/strings.
 * Expression can be positive (from start) or negative (from end).
 */
export interface BracketAccess {
  /** Discriminator for the unified PropertyAccess type */
  readonly accessKind: 'bracket';
  /** The index expression (evaluates to number) */
  readonly expression: ExpressionNode;
  /** Source span from opening [ to closing ] (inclusive) */
  readonly span: SourceSpan;
}

/**
 * Unified property access type.
 * Used to maintain order of mixed dot and bracket accesses.
 * e.g., $data[0].name[1] has accesses: [bracket(0), field(name), bracket(1)]
 */
export type PropertyAccess = FieldAccess | BracketAccess;

/**
 * Annotated expression: ^(key: value, ...) expression
 * Attaches annotation data to a primary expression value.
 * When the expression is a closure, annotations are captured by createClosure().
 * When the expression is a non-closure, annotations are ignored at runtime.
 *
 * Examples:
 *   ^("describe it") |x| ($x * 2)    -- closure gets description annotation
 *   ^(label: "add") app::add         -- host ref gets annotation (runtime: ignored)
 */
export interface AnnotatedExprNode extends BaseNode {
  readonly type: 'AnnotatedExpr';
  readonly annotations: AnnotationArg[];
  readonly expression: PrimaryNode;
}

// ============================================================
// FUNCTIONS & METHODS
// ============================================================

export interface HostCallNode extends BaseNode {
  readonly type: 'HostCall';
  readonly name: string;
  readonly args: (ExpressionNode | SpreadArgNode)[];
}

export interface HostRefNode extends BaseNode {
  readonly type: 'HostRef';
  readonly name: string;
}

export interface MethodCallNode extends BaseNode {
  readonly type: 'MethodCall';
  readonly name: string;
  readonly args: ExpressionNode[];
  readonly receiverSpan: SourceSpan | null;
}

/** Postfix invocation: expr(args) - calls the result of expr as a closure */
export interface InvokeNode extends BaseNode {
  readonly type: 'Invoke';
  readonly args: (ExpressionNode | SpreadArgNode)[];
}

/** Annotation reflection access on expressions: expr.^key */
export interface AnnotationAccessNode extends BaseNode {
  readonly type: 'AnnotationAccess';
  readonly key: string;
}

/** Call a closure stored in a variable: $fn(args) or $obj.method(args) */
export interface ClosureCallNode extends BaseNode {
  readonly type: 'ClosureCall';
  readonly name: string; // Variable name (without $)
  readonly accessChain: string[]; // Property access chain (e.g., ['double'] for $math.double)
  readonly args: (ExpressionNode | SpreadArgNode)[];
}

// ============================================================
// CONTROL FLOW
// ============================================================

/**
 * Conditional: ?($cond) body : else
 * Body can be any simple-body (block, grouped, or postfix-expr).
 *
 * Examples:
 *   ?($x > 0) "positive" : "negative"    — literals
 *   ?($x > 0) ($x * 2) : ($x / 2)        — grouped
 *   ?($x > 0) { complex } : { other }    — blocks
 */
export interface ConditionalNode extends BaseNode {
  readonly type: 'Conditional';
  readonly input: ExpressionNode | null; // null = implied $
  readonly condition: BodyNode | null; // null = truthy check on input (piped form)
  readonly thenBranch: BodyNode;
  readonly elseBranch: BodyNode | ConditionalNode | null;
}

export interface WhileLoopNode extends BaseNode {
  readonly type: 'WhileLoop';
  readonly condition: ExpressionNode; // must evaluate to boolean
  readonly body: BodyNode;
  readonly annotations?: AnnotationArg[] | undefined;
}

export interface DoWhileLoopNode extends BaseNode {
  readonly type: 'DoWhileLoop';
  readonly input: ExpressionNode | null; // null = implied $
  readonly body: BodyNode;
  readonly condition: BodyNode;
  readonly annotations?: AnnotationArg[] | undefined;
}

export interface BlockNode extends BaseNode {
  readonly type: 'Block';
  readonly statements: (StatementNode | AnnotatedStatementNode)[];
}

// ============================================================
// COLLECTION OPERATORS
// ============================================================

/**
 * Collection operator body types.
 * These are the valid forms for the body of each/map/fold operators.
 */
export type IteratorBody =
  | ClosureNode // |x| body or |x, acc = init| body
  | BlockNode // { body }
  | GroupedExprNode // (expr)
  | VariableNode // $fn
  | PostfixExprNode // $ or other simple expression
  | HostCallNode // greet (bare function name)
  | HostRefNode; // ns::func (namespaced host function reference)

/**
 * Each expression: sequential iteration returning list of all results.
 *
 * Syntax forms:
 *   collection -> each |x| body
 *   collection -> each { body }
 *   collection -> each (expr)
 *   collection -> each $fn
 *   collection -> each $
 *
 * With accumulator:
 *   collection -> each(init) { body }         -- $@ is accumulator
 *   collection -> each |x, acc = init| body   -- $acc is accumulator
 *
 * Returns: list of all body results (or scan results if accumulator)
 */
export interface EachExprNode extends BaseNode {
  readonly type: 'EachExpr';
  /** The body to execute for each element */
  readonly body: IteratorBody;
  /**
   * Optional accumulator initial value (for block form with $@ access).
   * null when using inline closure with accumulator (it's in the closure params)
   * or when no accumulator is used.
   */
  readonly accumulator: ExpressionNode | null;
  readonly annotations?: AnnotationArg[] | undefined;
}

/**
 * Map expression: parallel iteration returning list of all results.
 *
 * Syntax forms:
 *   collection -> map |x| body
 *   collection -> map { body }
 *   collection -> map (expr)
 *   collection -> map $fn
 *   collection -> map $
 *
 * No accumulator (parallel execution has no "previous").
 * Concurrency limit via ^(limit: N) annotation.
 *
 * Returns: list of all body results (order preserved)
 */
export interface MapExprNode extends BaseNode {
  readonly type: 'MapExpr';
  /** The body to execute for each element (in parallel) */
  readonly body: IteratorBody;
  readonly annotations?: AnnotationArg[] | undefined;
}

/**
 * Fold expression: sequential reduction returning final result only.
 *
 * Syntax forms:
 *   collection -> fold |x, acc = init| body   -- $acc is accumulator
 *   collection -> fold(init) { body }         -- $@ is accumulator
 *   collection -> fold $fn                    -- fn must have accumulator param
 *
 * Accumulator is required.
 *
 * Returns: final accumulated value only
 */
export interface FoldExprNode extends BaseNode {
  readonly type: 'FoldExpr';
  /** The body to execute for each element */
  readonly body: IteratorBody;
  /**
   * Accumulator initial value (for block form with $@ access).
   * null when using inline closure (accumulator is in closure params).
   */
  readonly accumulator: ExpressionNode | null;
  readonly annotations?: AnnotationArg[] | undefined;
}

/**
 * Filter expression: parallel filtering returning elements where predicate is truthy.
 *
 * Syntax forms:
 *   collection -> filter |x| body
 *   collection -> filter { body }
 *   collection -> filter (expr)
 *   collection -> filter $fn
 *
 * Predicate returns truthy/falsy. Elements where predicate is truthy are kept.
 *
 * Returns: list of elements where body was truthy
 */
export interface FilterExprNode extends BaseNode {
  readonly type: 'FilterExpr';
  /** The predicate body to evaluate for each element */
  readonly body: IteratorBody;
  readonly annotations?: AnnotationArg[] | undefined;
}

// ============================================================
// EXTRACTION OPERATORS
// ============================================================

/**
 * Destructure operator: destruct<...>
 * Extracts elements from tuples/dicts into variables.
 *
 * Tuple: [1, 2, 3] -> destruct<$a, $b, $c>
 * Dict:  [name: "x"] -> destruct<name: $n>
 * Nested: [[1, 2], 3] -> destruct<destruct<$a, $b>, $c>
 */
export interface DestructureNode extends BaseNode {
  readonly type: 'Destructure';
  readonly elements: DestructPatternNode[];
}

/**
 * Element in a destructure pattern.
 * Can be: typed variable, key-variable pair, skip placeholder, or nested destructure.
 */
export interface DestructPatternNode extends BaseNode {
  readonly type: 'DestructPattern';
  readonly kind: 'variable' | 'keyValue' | 'skip' | 'nested';
  /** Variable name (for 'variable' and 'keyValue' kinds) */
  readonly name: string | null;
  /** Key name (for 'keyValue' kind - dict destructuring) */
  readonly key: string | null;
  /** Type annotation (for 'variable' and 'keyValue' kinds) */
  readonly typeRef: TypeRef | null;
  /** Nested destructure pattern (for 'nested' kind) */
  readonly nested: DestructureNode | null;
}

/**
 * Slice operator: /<start:stop:step>
 * Extracts a portion of a tuple or string using Python-style slicing.
 *
 * Examples:
 *   $tuple -> /<0:3>       # elements 0, 1, 2
 *   $tuple -> /<::-1>      # reversed
 *   "hello" -> /<1:4>      # "ell"
 */
export interface SliceNode extends BaseNode {
  readonly type: 'Slice';
  /** Start index (null = from beginning) */
  readonly start: SliceBoundNode | null;
  /** Stop index (null = to end) */
  readonly stop: SliceBoundNode | null;
  /** Step (null = 1) */
  readonly step: SliceBoundNode | null;
}

/** A slice bound: number, variable, or grouped expression */
export type SliceBoundNode = NumberLiteralNode | VariableNode | GroupedExprNode;

// ============================================================
// TYPE OPERATIONS
// ============================================================

/**
 * Type assertion: expr:type
 * Asserts that the expression evaluates to the specified type.
 * Returns the value unchanged if assertion passes, errors on mismatch.
 *
 * Examples:
 *   fetchData():string                # assert result is string
 *   $val -> :number -> process()      # assert pipe value is number
 *   "hello":string                    # "hello" (pass)
 *   "hello":number                    # Error: expected number, got string
 *
 * When operand is null, it acts on the implicit $:
 *   :string ≡ $:string
 */
export interface TypeAssertionNode extends BaseNode {
  readonly type: 'TypeAssertion';
  /** The expression to assert (null for bare :type which uses $) */
  readonly operand: PostfixExprNode | null;
  /** The expected type reference (static or dynamic) */
  readonly typeRef: TypeRef;
}

/**
 * Type check: expr:?type
 * Checks if the expression evaluates to the specified type.
 * Returns true if types match, false otherwise.
 *
 * Examples:
 *   fetchData():?string               # is result a string?
 *   $val -> :?number -> process()     # is pipe value a number?
 *   "hello":?string                   # true
 *   "hello":?number                   # false
 *
 * When operand is null, it checks the implicit $:
 *   :?string ≡ $:?string
 */
export interface TypeCheckNode extends BaseNode {
  readonly type: 'TypeCheck';
  /** The expression to check (null for bare :?type which uses $) */
  readonly operand: PostfixExprNode | null;
  /** The type reference to check for (static or dynamic) */
  readonly typeRef: TypeRef;
}

/**
 * Type name expression: a bare type keyword used as a first-class value.
 * Produces a type value that can be passed to type assertion/check operators
 * or stored in variables.
 *
 * Examples:
 *   string          # the type value for 'string'
 *   number -> :type # assert the result is of kind 'type'
 */
export interface TypeNameExprNode extends BaseNode {
  readonly type: 'TypeNameExpr';
  /** The rill type name this expression represents */
  readonly typeName: RillTypeName;
}

// ============================================================
// COLLECTION LITERALS
// ============================================================

/**
 * List literal: list[expr, expr, ...]
 * Constructs a list collection from comma-separated expressions.
 *
 * Examples:
 *   list[1, 2, 3]
 *   list["a", "b", $x]
 */
export interface ListLiteralNode extends BaseNode {
  readonly type: 'ListLiteral';
  readonly elements: ExpressionNode[];
  readonly defaultValue: BodyNode | null;
}

/**
 * Dict literal: dict[key: value, ...]
 * Constructs a dict collection from comma-separated key-value pairs.
 *
 * Examples:
 *   dict[name: "Alice", age: 30]
 *   dict["x": 1, "y": 2]
 */
export interface DictLiteralNode extends BaseNode {
  readonly type: 'DictLiteral';
  readonly entries: DictEntryNode[];
}

/**
 * Tuple literal: tuple[expr, expr, ...]
 * Constructs a typed tuple from comma-separated expressions (mixed types allowed).
 *
 * Examples:
 *   tuple[1, "hello", true]
 *   tuple[$a, $b]
 */
export interface TupleLiteralNode extends BaseNode {
  readonly type: 'TupleLiteral';
  readonly elements: ExpressionNode[];
}

/**
 * Ordered literal: ordered[key: value, ...]
 * Constructs an ordered collection from comma-separated key-value pairs.
 *
 * Examples:
 *   ordered[name: "Alice", score: 42]
 */
export interface OrderedLiteralNode extends BaseNode {
  readonly type: 'OrderedLiteral';
  readonly entries: DictEntryNode[];
}

// ============================================================
// DESTRUCT OPERATOR
// ============================================================

/**
 * Destruct operator: destruct<$a, $b, ...>
 * Extracts elements from collections into named captures.
 * Supports skip placeholders (_), typed captures, and key-value patterns.
 *
 * Examples:
 *   $tuple -> destruct<$a, $b, $c>
 *   $tuple -> destruct<$a, _, $c>
 *   $dict  -> destruct<name: $n, age: $a>
 */
export interface DestructNode extends BaseNode {
  readonly type: 'Destruct';
  readonly elements: DestructPatternNode[];
}

// ============================================================
// CONVERT OPERATOR
// ============================================================

/**
 * Convert operator: -> :>type or -> :>$var
 * Converts the pipe value to the specified type.
 * Accepts a static type name, a dynamic type variable, or a structural
 * ordered type signature for field-ordered conversion.
 *
 * Examples:
 *   $items -> :>list
 *   $data  -> :>$targetType
 *   $row   -> :>ordered(name: string, age: number)
 */
export interface ConvertNode extends BaseNode {
  readonly type: 'Convert';
  /** Static or dynamic type reference, or a structural type constructor */
  readonly typeRef: TypeRef | TypeConstructorNode;
}

/**
 * Discriminated union for the identifier in a use expression.
 * - 'static': scheme:seg1.seg2 — parsed at parse time into scheme and segments
 * - 'variable': $varName — resolved to string at runtime
 * - 'computed': (pipeChain) — expression resolved to string at runtime
 *
 * static.segments contains at minimum 1 element.
 */
export type UseIdentifier =
  | { kind: 'static'; scheme: string; segments: string[] }
  | { kind: 'variable'; name: string }
  | { kind: 'computed'; expression: ExpressionNode };

/**
 * Use expression: use<identifier> or use<identifier>:TypeRef
 * Resolves a module or resource identifier at runtime.
 *
 * Examples:
 *   use<scheme:path.to.module>
 *   use<$moduleVar>
 *   use<(computedExpr)>:TypeName
 *   use<scheme:fn>:|param: string|
 */
export interface UseExprNode extends BaseNode {
  readonly type: 'UseExpr';
  readonly identifier: UseIdentifier;
  readonly typeRef: TypeRef | null;
  readonly closureAnnotation: ReadonlyArray<{
    readonly name: string;
    readonly typeRef: TypeRef;
  }> | null;
}

export type SimplePrimaryNode =
  | LiteralNode
  | VariableNode
  | HostCallNode
  | MethodCallNode
  | BlockNode
  | BinaryExprNode
  | UnaryExprNode
  | GroupedExprNode
  | PostfixExprNode
  | TypeAssertionNode
  | TypeCheckNode;

// ============================================================
// UNION TYPE FOR ALL NODES
// ============================================================

export type ASTNode =
  | ScriptNode
  | FrontmatterNode
  | ClosureNode
  | ClosureParamNode
  | StatementNode
  | CaptureNode
  | BreakNode
  | ReturnNode
  | PassNode
  | AssertNode
  | PipeChainNode
  | PostfixExprNode
  | MethodCallNode
  | InvokeNode
  | AnnotationAccessNode
  | HostCallNode
  | HostRefNode
  | ClosureCallNode
  | PipeInvokeNode
  | VariableNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | StringLiteralNode
  | InterpolationNode
  | NumberLiteralNode
  | BoolLiteralNode
  | ListSpreadNode
  | DictNode
  | DictEntryNode
  | BinaryExprNode
  | UnaryExprNode
  | GroupedExprNode
  | DestructureNode
  | DestructPatternNode
  | SliceNode
  | TypeAssertionNode
  | TypeCheckNode
  | TypeConstructorNode
  | ClosureSigLiteralNode
  | AnnotatedStatementNode
  | AnnotatedExprNode
  | NamedArgNode
  | SpreadArgNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | RecoveryErrorNode
  | ErrorNode
  | TypeNameExprNode
  | ListLiteralNode
  | DictLiteralNode
  | TupleLiteralNode
  | OrderedLiteralNode
  | DestructNode
  | ConvertNode
  | UseExprNode;
