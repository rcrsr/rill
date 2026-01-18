/**
 * Parser Class
 * Consolidates all parsing logic to eliminate circular dependencies.
 *
 * Previous architecture used setter injection to resolve circular dependencies
 * between modules (expressions.ts ↔ literals.ts ↔ variables.ts ↔ extraction.ts).
 * This class-based approach makes all parse methods available via `this`,
 * providing type-safe, initialization-order-independent access.
 */
import type { ScriptNode, Token } from '../types.js';
import { ParseError } from '../types.js';
/**
 * Parser class that consolidates all parsing logic.
 *
 * Usage:
 * ```typescript
 * const parser = new Parser(tokens, options);
 * const ast = parser.parse();
 * ```
 */
export declare class Parser {
    private state;
    constructor(tokens: Token[], options?: {
        recoveryMode?: boolean;
        source?: string;
    });
    /**
     * Parse tokens into a complete AST.
     */
    parse(): ScriptNode;
    /**
     * Get collected errors (for recovery mode).
     */
    get errors(): ParseError[];
    private parseScript;
    /**
     * Recovery helper: skip tokens until we find a likely statement boundary.
     * Returns an ErrorNode containing the skipped content.
     */
    private recoverToNextStatement;
    private parseFrontmatter;
    /**
     * Parse a statement: optionally annotated pipe chain expression.
     * Annotations prefix statements with ^(key: value, ...) syntax.
     * Termination (capture/break/return) is now part of PipeChainNode.
     */
    private parseStatement;
    /**
     * Parse an annotated statement: ^(key: value, ...) statement
     * Annotations modify operational parameters for statements.
     */
    private parseAnnotatedStatement;
    /**
     * Parse annotation arguments: key: value, *spread, ...
     */
    private parseAnnotationArgs;
    /**
     * Parse a single annotation argument: named (key: value) or spread (*expr)
     */
    private parseAnnotationArg;
    /**
     * Parse constructs common to both primary expressions and pipe targets.
     * Returns null if no common construct matches.
     */
    private parseCommonConstruct;
    private parseExpression;
    /**
     * Helper to create implicit pipe variable ($) for bare break/return
     */
    private implicitPipeVar;
    private parsePipeChain;
    private parsePostfixExpr;
    /**
     * Parse postfix expression without checking for trailing `?` conditional.
     * Used when the caller needs to handle the `?` themselves (e.g., for negation).
     */
    private parsePostfixExprBase;
    /**
     * Parse postfix invocation: (args)
     * This allows calling the result of any expression as a closure.
     * Examples: $handlers[0](), $dict.method()(), ($closure)()
     */
    private parseInvoke;
    /**
     * Parse postfix type operation: primary:type or primary:?type
     * Creates TypeAssertion or TypeCheck node with the primary as operand.
     */
    private parsePostfixTypeOperation;
    private parsePrimary;
    private parsePipeTarget;
    private parseCapture;
    /**
     * Grouped expression: ( expression )
     * Single-expression block with () delimiters.
     * Provides scoping — captures inside are local.
     *
     * Note: Boolean operators (&&, ||, !) are only supported in while loop
     * conditions @(condition), not in general grouped expressions.
     */
    private parseGrouped;
    /**
     * Check if current token is a comparison operator.
     */
    private isComparisonOp;
    /** Map token type to comparison operator string */
    private tokenToComparisonOp;
    /** Wrap a conditional node in a PostfixExpr */
    private wrapConditionalInPostfixExpr;
    /** Wrap a loop node in a PostfixExpr */
    private wrapLoopInPostfixExpr;
    /**
     * Parse logical OR expression: logical-and ('||' logical-and)*
     */
    private parseLogicalOr;
    /**
     * Parse logical AND expression: comparison ('&&' comparison)*
     */
    private parseLogicalAnd;
    /**
     * Parse comparison expression: additive (comp-op additive)?
     */
    private parseComparison;
    /**
     * Parse additive expression: multiplicative (('+' | '-') multiplicative)*
     */
    private parseAdditive;
    /**
     * Parse multiplicative expression: unary (('*' | '/' | '%') unary)*
     */
    private parseMultiplicative;
    /**
     * Parse unary expression: ('-' | '!') unary | postfix-expr
     */
    private parseUnary;
    /**
     * Parse type operation as pipe target: :type or :?type
     * These are shorthand for $:type and $:?type (type assertion/check on pipe value).
     */
    private parseTypeOperation;
    /**
     * Parse collection body: the body for each/map/fold operators.
     * Valid forms:
     *   - |x| body        -- inline closure
     *   - { body }        -- block expression
     *   - (expr)          -- grouped expression
     *   - $fn             -- variable closure
     *   - $               -- identity (returns element)
     *   - *               -- spread (converts element to tuple)
     */
    private parseIteratorBody;
    /**
     * Check if the next token sequence indicates an accumulator followed by a body.
     * Disambiguation rule from spec:
     *   - (expr) at end of statement or before -> → grouped expression (body)
     *   - (expr) { block } → accumulator, block body
     *   - (expr) |x| body → accumulator, closure body
     *   - (expr1) (expr2) → accumulator, grouped body
     */
    private hasAccumulatorPrefix;
    /**
     * Parse each expression: -> each [accumulator] body
     *
     * Syntax:
     *   -> each |x| body
     *   -> each { body }
     *   -> each (expr)
     *   -> each $fn
     *   -> each $
     *   -> each(init) { body }      -- with accumulator ($@ in body)
     *   -> each |x, acc = init| body -- with accumulator (closure param)
     */
    private parseEachExpr;
    /**
     * Parse map expression: -> map body
     *
     * Syntax:
     *   -> map |x| body
     *   -> map { body }
     *   -> map (expr)
     *   -> map $fn
     *   -> map $
     *
     * No accumulator (parallel execution has no "previous").
     */
    private parseMapExpr;
    /**
     * Parse fold expression: -> fold body
     *
     * Syntax:
     *   -> fold |x, acc = init| body   -- accumulator in closure params
     *   -> fold(init) { body }         -- accumulator via $@
     *   -> fold $fn                    -- fn must have accumulator param
     *
     * Accumulator is required.
     */
    private parseFoldExpr;
    /**
     * Parse filter expression: -> filter body
     *
     * Syntax:
     *   -> filter |x| body
     *   -> filter { body }
     *   -> filter (expr)
     *   -> filter $fn
     *
     * Predicate returns truthy/falsy. Elements where predicate is truthy are kept.
     */
    private parseFilterExpr;
    /**
     * Parse piped conditional: ? then_body [! else_body]
     * Called when bare `?` is seen (condition is implicit $).
     */
    private parsePipedConditional;
    /**
     * Parse conditional after condition is already parsed: ? then_body [! else_body]
     * Called when we've parsed an expression and see `?` following it.
     */
    private parseConditionalWithCondition;
    /**
     * Parse the rest of a conditional after `?` is consumed.
     * Grammar: then_body [! (conditional | else_body)]
     */
    private parseConditionalRest;
    /**
     * Parse loop starting with @: @ body [? cond]
     *
     * New syntax:
     *   @ body           - for-each over $
     *   @ body ? cond    - do-while (body first, then check)
     *
     * Called when bare `@` is seen (no input expression).
     */
    private parseLoop;
    /**
     * Parse loop with input: input @ body
     *
     * New syntax:
     *   input @ body     - while (if input is bool) or for-each (if input is list)
     *
     * Called when we've parsed an expression and see `@` following it.
     */
    private parseLoopWithInput;
    private parseBlock;
    private parseLiteral;
    /**
     * Parse a string literal, handling interpolation expressions.
     * Interpolation uses {expr} syntax where expr is any valid expression.
     * Escaped braces \{ and \} produce literal braces.
     */
    private parseString;
    /**
     * Split string content into literal segments and interpolation expressions.
     * Escape syntax: {{ → literal {, }} → literal }
     * Interpolation: {expr} where expr is any valid expression
     */
    private parseStringParts;
    /**
     * Replace escaped brace sequences with actual braces.
     * {{ → { and }} → }
     */
    private unescapeBraces;
    /**
     * Parse an interpolation expression using sub-lexer/parser.
     */
    private parseInterpolationExpr;
    private parseTupleOrDict;
    private parseTuple;
    private parseDict;
    private parseDictEntry;
    /**
     * Parse closure: |params| body or || body
     * Params can be: |x|, |x: string|, |x: string = "default"|
     *
     * Body can be:
     * - Simple: |x| $x (postfix-expr)
     * - Grouped: |x| ($x * 2) (compound expression)
     * - Block: |x| { $a ↵ $b } (multiple statements)
     */
    private parseClosure;
    /**
     * Parse simple-body: block, grouped, or postfix-expr
     * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
     *
     * Used by: closures, conditionals, loops
     */
    private parseBody;
    /**
     * Parse function parameter: name, name: type, name = default, or name: type = default
     * Type can be inferred from default value when not explicitly specified.
     */
    private parseClosureParam;
    private parseVariable;
    /**
     * Parse variable with field access, bracket access, existence checks, and defaults.
     */
    private makeVariableWithAccess;
    /**
     * Parse mixed access chain: dot-based field access and bracket-based index access.
     * Returns unified accessChain maintaining the order of accesses.
     * Also detects existence checks (.?).
     */
    private parseAccessChain;
    /**
     * Parse a single field access element (dot-based, no numeric indices).
     * Returns null if no valid element found.
     * Note: Numeric indices use bracket syntax [0], [-1] instead of dot.
     */
    private parseFieldAccessElement;
    /**
     * Parse computed expression .(expr) or alternatives .(a || b).
     */
    private parseComputedOrAlternatives;
    /**
     * Try to parse alternatives: a || b || c
     * Returns array of identifiers if successful, null otherwise.
     */
    private tryParseAlternatives;
    /**
     * Parse default value after ??.
     * Can be: block, grouped expression, or simple expression.
     */
    private parseDefaultValue;
    /**
     * Parse a comma-separated list of arguments.
     * Assumes the opening paren has already been consumed.
     * Does NOT consume the closing paren.
     */
    private parseArgumentList;
    private parseHostCall;
    /** Parse closure call: $fn(args) - invokes closure stored in variable */
    private parseClosureCall;
    /** Parse invoke expression: $() or $(args) - invokes pipe value as closure */
    private parsePipeInvoke;
    private parseMethodCall;
    /**
     * Parse sequential spread: @expr (when followed by variable or tuple, not block)
     * Examples: @$closures, @[$f, $g, $h]
     *
     * The spread target is a postfix expression (not a full pipe chain),
     * so `@$fn -> .method` parses as two separate pipe targets.
     */
    private parseClosureChain;
    /**
     * Parse destructure: *<elem, elem, ...>
     * Examples:
     *   *<$a, $b, $c>           -- tuple positional
     *   *<name: $n, count: $c>  -- dict key-value
     *   *<$a, _, $c>            -- skip element
     *   *<*<$a, $b>, $c>        -- nested
     */
    private parseDestructure;
    /**
     * Parse a single destructure element:
     *   $var or $var:type     -- variable (positional)
     *   key: $var             -- key-value (dict)
     *   _                     -- skip
     *   *<...>                -- nested destructure
     */
    private parseDestructPattern;
    /**
     * Parse slice: /<start:stop:step>
     * All bounds are optional. Supports negative indices.
     * Examples:
     *   /<0:3>      -- elements 0, 1, 2
     *   /<:3>       -- first 3 elements
     *   /<2:>       -- from index 2 to end
     *   /<::2>      -- every 2nd element
     *   /<::-1>     -- reversed
     */
    private parseSlice;
    /**
     * Parse a slice bound: number, variable, or arithmetic expression
     */
    private parseSliceBound;
    /**
     * Parse spread: *expr
     * Converts tuple/dict to args for unpacking at closure invocation.
     * Examples: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
     */
    private parseSpread;
    /**
     * Parse spread as pipe target: -> *
     * Converts piped value to args.
     */
    private parseSpreadTarget;
}
//# sourceMappingURL=parser.d.ts.map