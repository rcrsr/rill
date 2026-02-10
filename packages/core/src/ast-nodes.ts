import type { SourceSpan } from './source-location.js';
import type { RillTypeName } from './value-types.js';

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
 */
export interface ClosureNode extends BaseNode {
  readonly type: 'Closure';
  readonly params: ClosureParamNode[];
  readonly body: BodyNode;
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
  readonly typeName: 'string' | 'number' | 'bool' | null; // null = untyped
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
  /** Optional explicit type annotation: $name:string */
  readonly typeName: RillTypeName | null;
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
  readonly methods: (MethodCallNode | InvokeNode)[];
  readonly defaultValue: BodyNode | null;
}

export type PrimaryNode =
  | LiteralNode
  | VariableNode
  | HostCallNode
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
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode;

export type PipeTargetNode =
  | HostCallNode
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
  | TupleNode
  | GroupedExprNode
  | ClosureChainNode
  | DestructureNode
  | SliceNode
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | PostfixExprNode
  | VariableNode
  | AssertNode
  | ErrorNode;

/** Invoke pipe value as a closure: -> $() or -> $(arg1, arg2) */
export interface PipeInvokeNode extends BaseNode {
  readonly type: 'PipeInvoke';
  readonly args: ExpressionNode[];
}

// ============================================================
// LITERALS
// ============================================================

export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BoolLiteralNode
  | TupleNode
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

export interface TupleNode extends BaseNode {
  readonly type: 'Tuple';
  readonly elements: (ExpressionNode | ListSpreadNode)[];
  readonly defaultValue: BodyNode | null;
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
    | TupleNode
    | DictKeyVariable
    | DictKeyComputed;
  readonly value: ExpressionNode;
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
  readonly typeName: RillTypeName | null;
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

// ============================================================
// FUNCTIONS & METHODS
// ============================================================

export interface HostCallNode extends BaseNode {
  readonly type: 'HostCall';
  readonly name: string;
  readonly args: ExpressionNode[];
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
  readonly args: ExpressionNode[];
}

/** Call a closure stored in a variable: $fn(args) or $obj.method(args) */
export interface ClosureCallNode extends BaseNode {
  readonly type: 'ClosureCall';
  readonly name: string; // Variable name (without $)
  readonly accessChain: string[]; // Property access chain (e.g., ['double'] for $math.double)
  readonly args: ExpressionNode[];
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
}

export interface DoWhileLoopNode extends BaseNode {
  readonly type: 'DoWhileLoop';
  readonly input: ExpressionNode | null; // null = implied $
  readonly body: BodyNode;
  readonly condition: BodyNode;
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
  | SpreadNode // * (spread element to tuple)
  | HostCallNode; // greet (bare function name)

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
}

// ============================================================
// SPREAD OPERATIONS
// ============================================================

/**
 * Sequential spread: $input -> @$closures
 * Chains closures where each receives the previous result.
 *
 * Equivalent to a fold: $input -> [$f, $g, $h] -> @ { $() }
 * - With stored closures: the $ is the current closure, $() invokes it
 * - With inline blocks: $ is the accumulated value directly
 */
export interface ClosureChainNode extends BaseNode {
  readonly type: 'ClosureChain';
  readonly target: ExpressionNode; // The closure(s) to chain
}

// ============================================================
// EXTRACTION OPERATORS
// ============================================================

/**
 * Destructure operator: *<...>
 * Extracts elements from tuples/dicts into variables.
 *
 * Tuple: [1, 2, 3] -> *<$a, $b, $c>
 * Dict:  [name: "x"] -> *<name: $n>
 * Nested: [[1, 2], 3] -> *<*<$a, $b>, $c>
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
  readonly typeName: RillTypeName | null;
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

/**
 * Spread operator: *expr or -> *
 * Converts tuple or dict to args type for unpacking at closure invocation.
 *
 * Prefix form: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
 * Pipe target form: [1, 2, 3] -> *
 *
 * Creates an args value that unpacks into separate arguments when passed to a closure.
 */
export interface SpreadNode extends BaseNode {
  readonly type: 'Spread';
  /** The expression to spread (null when used as pipe target: -> *) */
  readonly operand: ExpressionNode | null;
}

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
  /** The expected type */
  readonly typeName: RillTypeName;
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
  /** The type to check for */
  readonly typeName: RillTypeName;
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
  | HostCallNode
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
  | TupleNode
  | ListSpreadNode
  | DictNode
  | DictEntryNode
  | BinaryExprNode
  | UnaryExprNode
  | GroupedExprNode
  | ClosureChainNode
  | DestructureNode
  | DestructPatternNode
  | SliceNode
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode
  | AnnotatedStatementNode
  | NamedArgNode
  | SpreadArgNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | RecoveryErrorNode
  | ErrorNode;
