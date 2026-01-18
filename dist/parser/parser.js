/**
 * Parser Class
 * Consolidates all parsing logic to eliminate circular dependencies.
 *
 * Previous architecture used setter injection to resolve circular dependencies
 * between modules (expressions.ts ↔ literals.ts ↔ variables.ts ↔ extraction.ts).
 * This class-based approach makes all parse methods available via `this`,
 * providing type-safe, initialization-order-independent access.
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { tokenize } from '../lexer/index.js';
import { createParserState, check, advance, expect, current, isAtEnd, skipNewlines, makeSpan, peek, } from './state.js';
import { isHostCall, isClosureCall, canStartPipeInvoke, isMethodCall, isTypedCaptureWithArrow, isInlineCaptureWithArrow, isClosureChainTarget, isNegativeNumber, isLiteralStart, isClosureStart, isDictStart, isMethodCallWithArgs, canStartExpression, makeBoolLiteralBlock, VALID_TYPE_NAMES, FUNC_PARAM_TYPES, parseTypeName, } from './helpers.js';
/**
 * Parser class that consolidates all parsing logic.
 *
 * Usage:
 * ```typescript
 * const parser = new Parser(tokens, options);
 * const ast = parser.parse();
 * ```
 */
export class Parser {
    state;
    constructor(tokens, options) {
        this.state = createParserState(tokens, {
            recoveryMode: options?.recoveryMode ?? false,
            source: options?.source ?? '',
        });
    }
    /**
     * Parse tokens into a complete AST.
     */
    parse() {
        return this.parseScript();
    }
    /**
     * Get collected errors (for recovery mode).
     */
    get errors() {
        return this.state.errors;
    }
    // ============================================================
    // SCRIPT PARSING
    // ============================================================
    parseScript() {
        const start = current(this.state).span.start;
        skipNewlines(this.state);
        // Optional frontmatter
        let frontmatter = null;
        if (check(this.state, TOKEN_TYPES.FRONTMATTER_DELIM)) {
            frontmatter = this.parseFrontmatter();
        }
        skipNewlines(this.state);
        // Statements
        const statements = [];
        while (!isAtEnd(this.state)) {
            skipNewlines(this.state);
            if (isAtEnd(this.state))
                break;
            if (this.state.recoveryMode) {
                // Recovery mode: catch errors and create ErrorNode
                const stmtStart = current(this.state).span.start;
                try {
                    statements.push(this.parseStatement());
                }
                catch (err) {
                    if (err instanceof ParseError) {
                        this.state.errors.push(err);
                        // Create ErrorNode and skip to next statement boundary
                        const errorNode = this.recoverToNextStatement(stmtStart, err.message);
                        statements.push(errorNode);
                    }
                    else {
                        throw err; // Re-throw non-parse errors
                    }
                }
            }
            else {
                // Normal mode: let errors propagate
                statements.push(this.parseStatement());
            }
            skipNewlines(this.state);
        }
        return {
            type: 'Script',
            frontmatter,
            statements,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Recovery helper: skip tokens until we find a likely statement boundary.
     * Returns an ErrorNode containing the skipped content.
     */
    recoverToNextStatement(startLocation, message) {
        const startOffset = startLocation.offset;
        let endOffset = startOffset;
        // Skip tokens until we hit a newline or EOF (statement boundary)
        while (!isAtEnd(this.state) && !check(this.state, TOKEN_TYPES.NEWLINE)) {
            endOffset = current(this.state).span.end.offset;
            advance(this.state);
        }
        // Extract the skipped text from source
        const text = this.state.source.slice(startOffset, endOffset);
        return {
            type: 'Error',
            message,
            text,
            span: makeSpan(startLocation, current(this.state).span.start),
        };
    }
    // ============================================================
    // FRONTMATTER PARSING
    // ============================================================
    parseFrontmatter() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.FRONTMATTER_DELIM, 'Expected ---');
        skipNewlines(this.state);
        // Collect all content until next ---
        let content = '';
        while (!check(this.state, TOKEN_TYPES.FRONTMATTER_DELIM) &&
            !isAtEnd(this.state)) {
            const token = advance(this.state);
            content += token.value;
        }
        expect(this.state, TOKEN_TYPES.FRONTMATTER_DELIM, 'Expected closing ---');
        return {
            type: 'Frontmatter',
            content: content.trim(),
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // STATEMENT PARSING
    // ============================================================
    /**
     * Parse a statement: optionally annotated pipe chain expression.
     * Annotations prefix statements with ^(key: value, ...) syntax.
     * Termination (capture/break/return) is now part of PipeChainNode.
     */
    parseStatement() {
        const start = current(this.state).span.start;
        // Check for annotation prefix: ^(...)
        if (check(this.state, TOKEN_TYPES.CARET)) {
            return this.parseAnnotatedStatement();
        }
        const expression = this.parseExpression();
        return {
            type: 'Statement',
            expression,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // ANNOTATION PARSING
    // ============================================================
    /**
     * Parse an annotated statement: ^(key: value, ...) statement
     * Annotations modify operational parameters for statements.
     */
    parseAnnotatedStatement() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.CARET, 'Expected ^');
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const annotations = this.parseAnnotationArgs();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        // Parse the inner statement (which could also be annotated)
        const statement = this.parseStatement();
        // If inner is annotated, wrap it; otherwise use directly
        const innerStatement = statement.type === 'AnnotatedStatement'
            ? {
                type: 'Statement',
                expression: statement.statement.expression,
                span: statement.span,
            }
            : statement;
        return {
            type: 'AnnotatedStatement',
            annotations,
            statement: innerStatement,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse annotation arguments: key: value, *spread, ...
     */
    parseAnnotationArgs() {
        const args = [];
        if (check(this.state, TOKEN_TYPES.RPAREN)) {
            return args; // Empty annotation list
        }
        args.push(this.parseAnnotationArg());
        while (check(this.state, TOKEN_TYPES.COMMA)) {
            advance(this.state); // consume comma
            if (check(this.state, TOKEN_TYPES.RPAREN))
                break; // trailing comma
            args.push(this.parseAnnotationArg());
        }
        return args;
    }
    /**
     * Parse a single annotation argument: named (key: value) or spread (*expr)
     */
    parseAnnotationArg() {
        const start = current(this.state).span.start;
        // Spread argument: *expr
        if (check(this.state, TOKEN_TYPES.STAR)) {
            advance(this.state); // consume *
            const expression = this.parseExpression();
            return {
                type: 'SpreadArg',
                expression,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Named argument: key: value
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected annotation name');
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        const value = this.parseExpression();
        return {
            type: 'NamedArg',
            name: nameToken.value,
            value,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // COMMON CONSTRUCT PARSER
    // ============================================================
    /**
     * Parse constructs common to both primary expressions and pipe targets.
     * Returns null if no common construct matches.
     */
    parseCommonConstruct() {
        // Boolean negation: !expr (for filter predicates like !.empty in pipes)
        // Can be: !expr ? then ! else  OR  standalone !expr (returns true/false)
        if (check(this.state, TOKEN_TYPES.BANG)) {
            const start = current(this.state).span.start;
            advance(this.state); // consume !
            // Use parsePostfixExprBase to avoid consuming `?` - we handle it ourselves
            const operand = this.parsePostfixExprBase();
            const span = makeSpan(start, operand.span.end);
            // Build the negation condition as unified expression
            const unaryExpr = {
                type: 'UnaryExpr',
                op: '!',
                operand,
                span,
            };
            const negationCondition = {
                type: 'GroupedExpr',
                expression: {
                    type: 'PipeChain',
                    head: unaryExpr,
                    pipes: [],
                    terminator: null,
                    span,
                },
                span,
            };
            // Check for conditional: !expr ? then ! else
            if (check(this.state, TOKEN_TYPES.QUESTION)) {
                advance(this.state); // consume ?
                return this.parseConditionalRest(negationCondition, start);
            }
            // Standalone negation: evaluates to true/false
            return {
                type: 'Conditional',
                input: null,
                condition: negationCondition,
                thenBranch: makeBoolLiteralBlock(true, operand.span),
                elseBranch: makeBoolLiteralBlock(false, operand.span),
                span,
            };
        }
        // Piped conditional: bare `?` uses $ as condition
        if (check(this.state, TOKEN_TYPES.QUESTION)) {
            return this.parsePipedConditional();
        }
        // Loop: @ body [? cond]
        if (check(this.state, TOKEN_TYPES.AT)) {
            return this.parseLoop(null);
        }
        // Block (may be followed by @ for loop with input, or ? for conditional)
        if (check(this.state, TOKEN_TYPES.LBRACE)) {
            const block = this.parseBlock();
            // Check for loop: { input } @ body
            if (check(this.state, TOKEN_TYPES.AT)) {
                return this.parseLoopWithInput(block);
            }
            // Check for conditional: { expr } ? then ! else
            if (check(this.state, TOKEN_TYPES.QUESTION)) {
                return this.parseConditionalWithCondition(block);
            }
            return block;
        }
        // Grouped expression: ( inner-expr )
        // Allows arithmetic, pipes, and compound expressions
        // May be followed by: @ for loop, ? for conditional
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            const grouped = this.parseGrouped();
            // Check for loop: (expr) @ body
            if (check(this.state, TOKEN_TYPES.AT)) {
                return this.parseLoopWithInput(grouped);
            }
            // Check for conditional: (expr) ? then ! else
            if (check(this.state, TOKEN_TYPES.QUESTION)) {
                return this.parseConditionalWithCondition(grouped);
            }
            return grouped;
        }
        return null;
    }
    // ============================================================
    // EXPRESSION PARSING
    // ============================================================
    parseExpression() {
        return this.parsePipeChain();
    }
    /**
     * Helper to create implicit pipe variable ($) for bare break/return
     */
    implicitPipeVar(span) {
        const varNode = {
            type: 'Variable',
            name: null,
            isPipeVar: true,
            accessChain: [],
            defaultValue: null,
            existenceCheck: null,
            span,
        };
        return {
            type: 'PostfixExpr',
            primary: varNode,
            methods: [],
            span,
        };
    }
    parsePipeChain() {
        const start = current(this.state).span.start;
        // Handle bare break: "break" ≡ "$ -> break"
        if (check(this.state, TOKEN_TYPES.BREAK)) {
            const token = advance(this.state);
            return {
                type: 'PipeChain',
                head: this.implicitPipeVar(token.span),
                pipes: [],
                terminator: { type: 'Break', span: token.span },
                span: token.span,
            };
        }
        // Handle bare return: "return" ≡ "$ -> return"
        if (check(this.state, TOKEN_TYPES.RETURN)) {
            const token = advance(this.state);
            return {
                type: 'PipeChain',
                head: this.implicitPipeVar(token.span),
                pipes: [],
                terminator: { type: 'Return', span: token.span },
                span: token.span,
            };
        }
        // Parse expression head with full precedence chain:
        // logical-or -> logical-and -> comparison -> additive -> multiplicative -> unary -> postfix
        let head = this.parseLogicalOr();
        // Check for loop: expr @ body
        // This allows: $status.pending @ { ... }, ($x < 10) @ { ... }
        if (check(this.state, TOKEN_TYPES.AT)) {
            const headAsPipeChain = {
                type: 'PipeChain',
                head,
                pipes: [],
                terminator: null,
                span: head.span,
            };
            const loop = this.parseLoopWithInput(headAsPipeChain);
            const span = makeSpan(head.span.start, current(this.state).span.end);
            head = this.wrapLoopInPostfixExpr(loop, span);
        }
        // Check for conditional: expr ? then ! else
        // This allows: 5 + 3 ? "big" ! "small", $ready ? "go" ! "wait"
        if (check(this.state, TOKEN_TYPES.QUESTION)) {
            const headAsPipeChain = {
                type: 'PipeChain',
                head,
                pipes: [],
                terminator: null,
                span: head.span,
            };
            const conditional = this.parseConditionalWithCondition(headAsPipeChain);
            const span = makeSpan(head.span.start, current(this.state).span.end);
            head = this.wrapConditionalInPostfixExpr(conditional, span);
        }
        const pipes = [];
        let terminator = null;
        while (check(this.state, TOKEN_TYPES.ARROW)) {
            advance(this.state);
            // Check for break terminator: -> break
            if (check(this.state, TOKEN_TYPES.BREAK)) {
                const token = advance(this.state);
                terminator = { type: 'Break', span: token.span };
                break;
            }
            // Check for return terminator: -> return
            if (check(this.state, TOKEN_TYPES.RETURN)) {
                const token = advance(this.state);
                terminator = { type: 'Return', span: token.span };
                break;
            }
            // Check for capture vs ClosureCall: $identifier
            if (check(this.state, TOKEN_TYPES.DOLLAR)) {
                // ClosureCall: $name( - pass to parsePipeTarget
                if (isClosureCall(this.state)) {
                    pipes.push(this.parsePipeTarget());
                    continue;
                }
                // Inline capture: $name -> (followed by arrow)
                if (isInlineCaptureWithArrow(this.state)) {
                    pipes.push(this.parseCapture());
                    continue;
                }
                // Inline capture with type: $name:type -> (followed by arrow)
                if (isTypedCaptureWithArrow(this.state)) {
                    pipes.push(this.parseCapture());
                    continue;
                }
                // Terminal capture: $name or $name:type (end of chain)
                terminator = this.parseCapture();
                break;
            }
            pipes.push(this.parsePipeTarget());
        }
        // Check for conditional after pipe chain: $val -> :?string ? then ! else
        if (check(this.state, TOKEN_TYPES.QUESTION) && pipes.length > 0) {
            const span = makeSpan(start, current(this.state).span.end);
            const chainAsCondition = {
                type: 'PipeChain',
                head,
                pipes,
                terminator: null,
                span,
            };
            const conditional = this.parseConditionalWithCondition(chainAsCondition);
            const resultSpan = makeSpan(start, current(this.state).span.end);
            return {
                type: 'PipeChain',
                head: this.wrapConditionalInPostfixExpr(conditional, resultSpan),
                pipes: [],
                terminator: null,
                span: resultSpan,
            };
        }
        return {
            type: 'PipeChain',
            head,
            pipes,
            terminator,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    parsePostfixExpr() {
        const postfixExpr = this.parsePostfixExprBase();
        // Check if this postfix-expr is a condition for a conditional: expr ? then ! else
        // This allows: $ready ? "go" ! "wait", $data.valid ? process() ! skip()
        if (check(this.state, TOKEN_TYPES.QUESTION)) {
            const conditional = this.parseConditionalWithCondition(postfixExpr);
            const span = makeSpan(postfixExpr.span.start, current(this.state).span.end);
            return this.wrapConditionalInPostfixExpr(conditional, span);
        }
        return postfixExpr;
    }
    /**
     * Parse postfix expression without checking for trailing `?` conditional.
     * Used when the caller needs to handle the `?` themselves (e.g., for negation).
     */
    parsePostfixExprBase() {
        const start = current(this.state).span.start;
        let primary = this.parsePrimary();
        // Check for postfix type assertion: expr:type or expr:?type
        // This binds tighter than method calls: 42:number.str means (42:number).str
        if (check(this.state, TOKEN_TYPES.COLON)) {
            primary = this.parsePostfixTypeOperation(primary, start);
        }
        const methods = [];
        // Parse method calls and invocations
        // Method call: .name(args) or .name
        // Invocation: (args) - calls the result as a closure
        while (isMethodCall(this.state) || check(this.state, TOKEN_TYPES.LPAREN)) {
            if (isMethodCall(this.state)) {
                methods.push(this.parseMethodCall());
            }
            else {
                // Postfix invocation: expr(args)
                methods.push(this.parseInvoke());
            }
        }
        return {
            type: 'PostfixExpr',
            primary,
            methods,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse postfix invocation: (args)
     * This allows calling the result of any expression as a closure.
     * Examples: $handlers[0](), $dict.method()(), ($closure)()
     */
    parseInvoke() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const args = [];
        if (!check(this.state, TOKEN_TYPES.RPAREN)) {
            args.push(this.parsePipeChain());
            while (check(this.state, TOKEN_TYPES.COMMA)) {
                advance(this.state); // consume ,
                args.push(this.parsePipeChain());
            }
        }
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        return {
            type: 'Invoke',
            args,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse postfix type operation: primary:type or primary:?type
     * Creates TypeAssertion or TypeCheck node with the primary as operand.
     */
    parsePostfixTypeOperation(primary, start) {
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        // Check for type check (question mark)
        const isCheck = check(this.state, TOKEN_TYPES.QUESTION);
        if (isCheck) {
            advance(this.state); // consume ?
        }
        // Parse type name
        const typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
        // Wrap primary in PostfixExprNode for the operand
        const operand = {
            type: 'PostfixExpr',
            primary,
            methods: [],
            span: makeSpan(start, current(this.state).span.end),
        };
        const span = makeSpan(start, current(this.state).span.end);
        if (isCheck) {
            return {
                type: 'TypeCheck',
                operand,
                typeName,
                span,
            };
        }
        return {
            type: 'TypeAssertion',
            operand,
            typeName,
            span,
        };
    }
    // ============================================================
    // PRIMARY PARSING
    // ============================================================
    parsePrimary() {
        // Spread operator: *expr - convert tuple/dict to args
        if (check(this.state, TOKEN_TYPES.STAR)) {
            return this.parseSpread();
        }
        // Unary minus for negative numbers: -42
        if (isNegativeNumber(this.state)) {
            const start = current(this.state).span.start;
            advance(this.state); // consume -
            const numToken = advance(this.state); // consume number
            return {
                type: 'NumberLiteral',
                value: -parseFloat(numToken.value),
                span: makeSpan(start, numToken.span.end),
            };
        }
        // Closure: |params| body or || body
        if (isClosureStart(this.state)) {
            return this.parseClosure();
        }
        // Literal (strings, numbers, booleans, tuples/dicts)
        if (isLiteralStart(this.state)) {
            return this.parseLiteral();
        }
        // Closure call: $fn(args) - closure invocation
        if (isClosureCall(this.state)) {
            return this.parseClosureCall();
        }
        // Variable
        if (check(this.state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
            return this.parseVariable();
        }
        // Bare method call: .method ≡ $ -> .method (implicit pipe var receiver)
        if (isMethodCall(this.state)) {
            return this.parseMethodCall();
        }
        // Function call (identifier followed by paren)
        if (isHostCall(this.state)) {
            return this.parseHostCall();
        }
        // Common constructs: conditionals, loops, blocks, grouped expressions
        const common = this.parseCommonConstruct();
        if (common)
            return common;
        throw new ParseError(`Unexpected token: ${current(this.state).value}`, current(this.state).span.start);
    }
    // ============================================================
    // PIPE TARGET PARSING
    // ============================================================
    parsePipeTarget() {
        // Type operations: -> :type or -> :?type
        if (check(this.state, TOKEN_TYPES.COLON)) {
            return this.parseTypeOperation();
        }
        // Spread as pipe target: -> * (convert pipe value to args)
        if (check(this.state, TOKEN_TYPES.STAR)) {
            return this.parseSpreadTarget();
        }
        // Extraction operators
        if (check(this.state, TOKEN_TYPES.STAR_LT)) {
            return this.parseDestructure();
        }
        if (check(this.state, TOKEN_TYPES.SLASH_LT)) {
            return this.parseSlice();
        }
        // Collection operators: -> each, -> map, -> fold, -> filter
        if (check(this.state, TOKEN_TYPES.EACH)) {
            return this.parseEachExpr();
        }
        if (check(this.state, TOKEN_TYPES.MAP)) {
            return this.parseMapExpr();
        }
        if (check(this.state, TOKEN_TYPES.FOLD)) {
            return this.parseFoldExpr();
        }
        if (check(this.state, TOKEN_TYPES.FILTER)) {
            return this.parseFilterExpr();
        }
        // Method call (starts with .) - may be condition for conditional
        if (check(this.state, TOKEN_TYPES.DOT)) {
            const methodCall = this.parseMethodCall();
            // Check if this is a condition for a conditional: .valid ? then ! else
            if (check(this.state, TOKEN_TYPES.QUESTION)) {
                // Wrap in PostfixExpr with implicit $ receiver for the condition
                const postfixExpr = {
                    type: 'PostfixExpr',
                    primary: {
                        type: 'Variable',
                        name: null,
                        isPipeVar: true,
                        accessChain: [],
                        defaultValue: null,
                        existenceCheck: null,
                        span: methodCall.span,
                    },
                    methods: [methodCall],
                    span: methodCall.span,
                };
                return this.parseConditionalWithCondition(postfixExpr);
            }
            return methodCall;
        }
        // Closure call: $fn(args) - closure invocation as pipe target
        if (isClosureCall(this.state)) {
            return this.parseClosureCall();
        }
        // Sequential spread: -> @$var or -> @[closures] (not @{ } which is for-loop, not @( which is while)
        if (isClosureChainTarget(this.state)) {
            return this.parseClosureChain();
        }
        // Pipe invoke: -> $() or -> $(args) - invoke pipe value as closure
        // The $ prefix distinguishes from grouped expressions: -> (expr)
        if (canStartPipeInvoke(this.state)) {
            return this.parsePipeInvoke();
        }
        // String literal (template with {$} interpolation)
        if (check(this.state, TOKEN_TYPES.STRING)) {
            return this.parseString();
        }
        // Function call with parens
        if (isHostCall(this.state)) {
            return this.parseHostCall();
        }
        // Bare function name: "-> greet" ≡ "-> greet()" with $ as implicit arg
        if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
            const start = current(this.state).span.start;
            const nameToken = advance(this.state);
            return {
                type: 'HostCall',
                name: nameToken.value,
                args: [],
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Common constructs: conditionals, loops, blocks, arithmetic
        const common = this.parseCommonConstruct();
        if (common) {
            // Check for postfix type assertion on the common construct: (expr):type
            if (check(this.state, TOKEN_TYPES.COLON)) {
                return this.parsePostfixTypeOperation(common, common.span.start);
            }
            return common;
        }
        throw new ParseError(`Expected pipe target, got: ${current(this.state).value}`, current(this.state).span.start);
    }
    // ============================================================
    // CAPTURE PARSING
    // ============================================================
    parseCapture() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        // Optional type annotation: $name:type
        let typeName = null;
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
        }
        return {
            type: 'Capture',
            name: nameToken.value,
            typeName,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // GROUPED EXPRESSION & ARITHMETIC PARSING
    // ============================================================
    /**
     * Grouped expression: ( expression )
     * Single-expression block with () delimiters.
     * Provides scoping — captures inside are local.
     *
     * Note: Boolean operators (&&, ||, !) are only supported in while loop
     * conditions @(condition), not in general grouped expressions.
     */
    parseGrouped() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const expression = this.parsePipeChain();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        return {
            type: 'GroupedExpr',
            expression,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Check if current token is a comparison operator.
     */
    isComparisonOp() {
        return check(this.state, TOKEN_TYPES.EQ, TOKEN_TYPES.NE, TOKEN_TYPES.LT, TOKEN_TYPES.GT, TOKEN_TYPES.LE, TOKEN_TYPES.GE);
    }
    /** Map token type to comparison operator string */
    tokenToComparisonOp(tokenType) {
        switch (tokenType) {
            case TOKEN_TYPES.EQ:
                return '==';
            case TOKEN_TYPES.NE:
                return '!=';
            case TOKEN_TYPES.LT:
                return '<';
            case TOKEN_TYPES.GT:
                return '>';
            case TOKEN_TYPES.LE:
                return '<=';
            default:
                return '>=';
        }
    }
    /** Wrap a conditional node in a PostfixExpr */
    wrapConditionalInPostfixExpr(conditional, span) {
        return {
            type: 'PostfixExpr',
            primary: conditional,
            methods: [],
            span,
        };
    }
    /** Wrap a loop node in a PostfixExpr */
    wrapLoopInPostfixExpr(loop, span) {
        return {
            type: 'PostfixExpr',
            primary: loop,
            methods: [],
            span,
        };
    }
    // ============================================================
    // EXPRESSION PRECEDENCE CHAIN
    // ============================================================
    // Precedence (lowest to highest):
    // logical-or (||) -> logical-and (&&) -> comparison -> additive -> multiplicative -> unary -> postfix
    /**
     * Parse logical OR expression: logical-and ('||' logical-and)*
     */
    parseLogicalOr() {
        const start = current(this.state).span.start;
        let left = this.parseLogicalAnd();
        while (check(this.state, TOKEN_TYPES.OR)) {
            advance(this.state);
            const right = this.parseLogicalAnd();
            left = {
                type: 'BinaryExpr',
                op: '||',
                left,
                right,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        return left;
    }
    /**
     * Parse logical AND expression: comparison ('&&' comparison)*
     */
    parseLogicalAnd() {
        const start = current(this.state).span.start;
        let left = this.parseComparison();
        while (check(this.state, TOKEN_TYPES.AND)) {
            advance(this.state);
            const right = this.parseComparison();
            left = {
                type: 'BinaryExpr',
                op: '&&',
                left,
                right,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        return left;
    }
    /**
     * Parse comparison expression: additive (comp-op additive)?
     */
    parseComparison() {
        const start = current(this.state).span.start;
        let left = this.parseAdditive();
        if (this.isComparisonOp()) {
            const opToken = advance(this.state);
            const op = this.tokenToComparisonOp(opToken.type);
            const right = this.parseAdditive();
            left = {
                type: 'BinaryExpr',
                op,
                left,
                right,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        return left;
    }
    /**
     * Parse additive expression: multiplicative (('+' | '-') multiplicative)*
     */
    parseAdditive() {
        const start = current(this.state).span.start;
        let left = this.parseMultiplicative();
        while (check(this.state, TOKEN_TYPES.PLUS, TOKEN_TYPES.MINUS)) {
            const opToken = advance(this.state);
            const op = opToken.type === TOKEN_TYPES.PLUS ? '+' : '-';
            const right = this.parseMultiplicative();
            left = {
                type: 'BinaryExpr',
                op,
                left,
                right,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        return left;
    }
    /**
     * Parse multiplicative expression: unary (('*' | '/' | '%') unary)*
     */
    parseMultiplicative() {
        const start = current(this.state).span.start;
        let left = this.parseUnary();
        while (check(this.state, TOKEN_TYPES.STAR, TOKEN_TYPES.SLASH, TOKEN_TYPES.PERCENT)) {
            const opToken = advance(this.state);
            const op = opToken.type === TOKEN_TYPES.STAR
                ? '*'
                : opToken.type === TOKEN_TYPES.SLASH
                    ? '/'
                    : '%';
            const right = this.parseUnary();
            left = {
                type: 'BinaryExpr',
                op,
                left,
                right,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        return left;
    }
    /**
     * Parse unary expression: ('-' | '!') unary | postfix-expr
     */
    parseUnary() {
        if (check(this.state, TOKEN_TYPES.MINUS)) {
            const start = current(this.state).span.start;
            advance(this.state);
            const operand = this.parseUnary();
            return {
                type: 'UnaryExpr',
                op: '-',
                operand,
                span: makeSpan(start, operand.span.end),
            };
        }
        if (check(this.state, TOKEN_TYPES.BANG)) {
            const start = current(this.state).span.start;
            advance(this.state);
            const operand = this.parseUnary();
            return {
                type: 'UnaryExpr',
                op: '!',
                operand,
                span: makeSpan(start, operand.span.end),
            };
        }
        return this.parsePostfixExpr();
    }
    // ============================================================
    // TYPE OPERATIONS
    // ============================================================
    /**
     * Parse type operation as pipe target: :type or :?type
     * These are shorthand for $:type and $:?type (type assertion/check on pipe value).
     */
    parseTypeOperation() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        // Check for type check (question mark)
        const isCheck = check(this.state, TOKEN_TYPES.QUESTION);
        if (isCheck) {
            advance(this.state); // consume ?
        }
        // Parse type name
        const typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
        const span = makeSpan(start, current(this.state).span.end);
        if (isCheck) {
            return {
                type: 'TypeCheck',
                operand: null, // null means use pipe value ($)
                typeName,
                span,
            };
        }
        return {
            type: 'TypeAssertion',
            operand: null, // null means use pipe value ($)
            typeName,
            span,
        };
    }
    // ============================================================
    // COLLECTION OPERATORS (each, map, fold, filter)
    // ============================================================
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
    parseIteratorBody() {
        // Inline closure: |x| body or |x, acc = init| body
        if (isClosureStart(this.state)) {
            return this.parseClosure();
        }
        // Block: { body }
        if (check(this.state, TOKEN_TYPES.LBRACE)) {
            return this.parseBlock();
        }
        // Grouped: (expr)
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            return this.parseGrouped();
        }
        // Variable closure: $fn or identity $
        if (check(this.state, TOKEN_TYPES.DOLLAR) ||
            check(this.state, TOKEN_TYPES.PIPE_VAR)) {
            return this.parseVariable();
        }
        // Spread: * (converts element to tuple)
        if (check(this.state, TOKEN_TYPES.STAR)) {
            return this.parseSpread();
        }
        throw new ParseError(`Expected collection body (closure, block, grouped, variable, or spread), got: ${current(this.state).value}`, current(this.state).span.start);
    }
    /**
     * Check if the next token sequence indicates an accumulator followed by a body.
     * Disambiguation rule from spec:
     *   - (expr) at end of statement or before -> → grouped expression (body)
     *   - (expr) { block } → accumulator, block body
     *   - (expr) |x| body → accumulator, closure body
     *   - (expr1) (expr2) → accumulator, grouped body
     */
    hasAccumulatorPrefix() {
        if (!check(this.state, TOKEN_TYPES.LPAREN)) {
            return false;
        }
        // Find matching close paren
        let depth = 1;
        let i = 1;
        while (depth > 0) {
            const token = peek(this.state, i);
            if (!token)
                return false;
            if (token.type === TOKEN_TYPES.LPAREN)
                depth++;
            else if (token.type === TOKEN_TYPES.RPAREN)
                depth--;
            i++;
        }
        // Look at what follows the closing paren
        const afterParen = peek(this.state, i);
        if (!afterParen)
            return false;
        // If followed by body starters, this paren is accumulator
        return (afterParen.type === TOKEN_TYPES.LBRACE || // (init) { body }
            afterParen.type === TOKEN_TYPES.PIPE_BAR || // (init) |x| body
            afterParen.type === TOKEN_TYPES.OR || // (init) || body
            afterParen.type === TOKEN_TYPES.LPAREN // (init) (expr)
        );
    }
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
    parseEachExpr() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.EACH, 'Expected each');
        let accumulator = null;
        // Check for accumulator prefix: (init) followed by body
        if (this.hasAccumulatorPrefix()) {
            accumulator = this.parseGrouped().expression;
        }
        const body = this.parseIteratorBody();
        return {
            type: 'EachExpr',
            body,
            accumulator,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
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
    parseMapExpr() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.MAP, 'Expected map');
        const body = this.parseIteratorBody();
        return {
            type: 'MapExpr',
            body,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
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
    parseFoldExpr() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.FOLD, 'Expected fold');
        let accumulator = null;
        // Check for accumulator prefix: (init) followed by body
        if (this.hasAccumulatorPrefix()) {
            accumulator = this.parseGrouped().expression;
        }
        const body = this.parseIteratorBody();
        return {
            type: 'FoldExpr',
            body,
            accumulator,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
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
    parseFilterExpr() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.FILTER, 'Expected filter');
        const body = this.parseIteratorBody();
        return {
            type: 'FilterExpr',
            body,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // CONDITIONALS
    // ============================================================
    /**
     * Parse piped conditional: ? then_body [! else_body]
     * Called when bare `?` is seen (condition is implicit $).
     */
    parsePipedConditional() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');
        return this.parseConditionalRest(null, start);
    }
    /**
     * Parse conditional after condition is already parsed: ? then_body [! else_body]
     * Called when we've parsed an expression and see `?` following it.
     */
    parseConditionalWithCondition(conditionBody) {
        const start = conditionBody.span.start;
        expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');
        return this.parseConditionalRest(conditionBody, start);
    }
    /**
     * Parse the rest of a conditional after `?` is consumed.
     * Grammar: then_body [! (conditional | else_body)]
     */
    parseConditionalRest(condition, start) {
        // Parse then branch - can be block, grouped, or postfix-expr
        const thenBranch = this.parseBody();
        // Optional else clause with `!` (not `:`)
        let elseBranch = null;
        if (check(this.state, TOKEN_TYPES.BANG)) {
            advance(this.state);
            // Check if this is else-if (another condition followed by ?)
            // We need to parse a simple-body first, then check for ?
            const elseBody = this.parseBody();
            // If followed by ?, this is else-if chaining
            if (check(this.state, TOKEN_TYPES.QUESTION)) {
                elseBranch = this.parseConditionalWithCondition(elseBody);
            }
            else {
                elseBranch = elseBody;
            }
        }
        return {
            type: 'Conditional',
            input: null,
            condition,
            thenBranch,
            elseBranch,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // LOOPS
    // ============================================================
    /**
     * Parse loop starting with @: @ body [? cond]
     *
     * New syntax:
     *   @ body           - for-each over $
     *   @ body ? cond    - do-while (body first, then check)
     *
     * Called when bare `@` is seen (no input expression).
     */
    parseLoop(input) {
        const start = input ? input.span.start : current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.AT, 'Expected @');
        // Parse body - can be block, grouped, or postfix-expr
        const body = this.parseBody();
        // Check for do-while post-condition: @ body ? cond
        if (check(this.state, TOKEN_TYPES.QUESTION)) {
            advance(this.state); // consume ?
            const condition = this.parseBody();
            return {
                type: 'DoWhileLoop',
                input,
                body,
                condition,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Regular loop (for-each or while, determined at runtime)
        return {
            type: 'ForLoop',
            input,
            body,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse loop with input: input @ body
     *
     * New syntax:
     *   input @ body     - while (if input is bool) or for-each (if input is list)
     *
     * Called when we've parsed an expression and see `@` following it.
     */
    parseLoopWithInput(input) {
        // Convert BodyNode to ExpressionNode (wrap if needed)
        let inputExpr;
        if (input.type === 'PipeChain') {
            inputExpr = input;
        }
        else {
            // Wrap in PipeChain
            inputExpr = {
                type: 'PipeChain',
                head: input.type === 'PostfixExpr'
                    ? input
                    : {
                        type: 'PostfixExpr',
                        primary: input,
                        methods: [],
                        span: input.span,
                    },
                pipes: [],
                terminator: null,
                span: input.span,
            };
        }
        return this.parseLoop(inputExpr);
    }
    // ============================================================
    // BLOCKS
    // ============================================================
    parseBlock() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.LBRACE, 'Expected {');
        skipNewlines(this.state);
        const statements = [];
        while (!check(this.state, TOKEN_TYPES.RBRACE) && !isAtEnd(this.state)) {
            statements.push(this.parseStatement());
            skipNewlines(this.state);
        }
        // Empty blocks are not allowed - blocks must contain at least one statement
        if (statements.length === 0) {
            throw new ParseError('Empty blocks are not allowed', start);
        }
        expect(this.state, TOKEN_TYPES.RBRACE, 'Expected }');
        return {
            type: 'Block',
            statements,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // LITERAL PARSING
    // ============================================================
    parseLiteral() {
        if (check(this.state, TOKEN_TYPES.STRING)) {
            return this.parseString();
        }
        if (check(this.state, TOKEN_TYPES.NUMBER)) {
            const token = advance(this.state);
            return {
                type: 'NumberLiteral',
                value: parseFloat(token.value),
                span: token.span,
            };
        }
        if (check(this.state, TOKEN_TYPES.TRUE)) {
            const token = advance(this.state);
            return { type: 'BoolLiteral', value: true, span: token.span };
        }
        if (check(this.state, TOKEN_TYPES.FALSE)) {
            const token = advance(this.state);
            return { type: 'BoolLiteral', value: false, span: token.span };
        }
        if (check(this.state, TOKEN_TYPES.LBRACKET)) {
            return this.parseTupleOrDict();
        }
        // Note: LPAREN no longer starts closures
        // Closures use |params| body syntax (handled by parseClosure)
        // LPAREN now starts grouped expressions (handled by parseGrouped in expressions.ts)
        const token = current(this.state);
        let hint = '';
        if (token.type === TOKEN_TYPES.ASSIGN) {
            hint = ". Hint: Use '->' for assignment, not '='";
        }
        else if (token.type === TOKEN_TYPES.EOF) {
            hint = '. Hint: Unexpected end of input';
        }
        throw new ParseError(`Expected literal, got: ${token.value}${hint}`, token.span.start);
    }
    // ============================================================
    // STRING PARSING
    // ============================================================
    /**
     * Parse a string literal, handling interpolation expressions.
     * Interpolation uses {expr} syntax where expr is any valid expression.
     * Escaped braces \{ and \} produce literal braces.
     */
    parseString() {
        const token = advance(this.state);
        const raw = token.value;
        // Parse interpolation expressions from the string content
        const parts = this.parseStringParts(raw, token.span.start);
        return {
            type: 'StringLiteral',
            parts,
            isHeredoc: raw.includes('\n'),
            span: token.span,
        };
    }
    /**
     * Split string content into literal segments and interpolation expressions.
     * Escape syntax: {{ → literal {, }} → literal }
     * Interpolation: {expr} where expr is any valid expression
     */
    parseStringParts(raw, baseLocation) {
        const parts = [];
        let i = 0;
        let literalStart = 0;
        while (i < raw.length) {
            if (raw[i] === '{') {
                // Check for escaped brace {{ - skip and let unescapeBraces handle it
                if (raw[i + 1] === '{') {
                    i += 2;
                    continue;
                }
                // Found interpolation start - save preceding literal
                if (i > literalStart) {
                    const literal = this.unescapeBraces(raw.slice(literalStart, i));
                    if (literal)
                        parts.push(literal);
                }
                // Find matching closing brace (respecting nesting and escapes)
                const exprStart = i + 1;
                let depth = 1;
                i++;
                while (i < raw.length && depth > 0) {
                    // Skip escaped braces inside interpolation
                    if (raw[i] === '{' && raw[i + 1] === '{') {
                        i += 2;
                        continue;
                    }
                    if (raw[i] === '}' && raw[i + 1] === '}') {
                        i += 2;
                        continue;
                    }
                    if (raw[i] === '{')
                        depth++;
                    else if (raw[i] === '}')
                        depth--;
                    i++;
                }
                if (depth !== 0) {
                    throw new ParseError("Unterminated string interpolation. Hint: Check for missing '}' in interpolation", baseLocation);
                }
                // Extract and parse the expression
                const exprSource = raw.slice(exprStart, i - 1);
                if (!exprSource.trim()) {
                    throw new ParseError('Empty string interpolation', baseLocation);
                }
                const interpolation = this.parseInterpolationExpr(exprSource, baseLocation);
                parts.push(interpolation);
                literalStart = i;
            }
            else if (raw[i] === '}' && raw[i + 1] === '}') {
                // Skip escaped closing brace - let unescapeBraces handle it
                i += 2;
            }
            else {
                i++;
            }
        }
        // Add remaining literal segment
        if (literalStart < raw.length) {
            const literal = this.unescapeBraces(raw.slice(literalStart));
            if (literal)
                parts.push(literal);
        }
        // If no parts, return empty string
        if (parts.length === 0) {
            parts.push('');
        }
        return parts;
    }
    /**
     * Replace escaped brace sequences with actual braces.
     * {{ → { and }} → }
     */
    unescapeBraces(s) {
        return s.replaceAll('{{', '{').replaceAll('}}', '}');
    }
    /**
     * Parse an interpolation expression using sub-lexer/parser.
     */
    parseInterpolationExpr(source, baseLocation) {
        // Tokenize the expression
        const tokens = tokenize(source);
        // Filter out newlines and comments for expression parsing
        const filtered = tokens.filter((t) => t.type !== TOKEN_TYPES.NEWLINE && t.type !== TOKEN_TYPES.COMMENT);
        if (filtered.length === 0 || filtered[0]?.type === TOKEN_TYPES.EOF) {
            throw new ParseError('Empty string interpolation', baseLocation);
        }
        // Parse as expression using a sub-parser
        const subParser = new Parser(filtered);
        const expression = subParser.parseExpression();
        // Verify all tokens consumed (except EOF)
        if (subParser.state.tokens[subParser.state.pos]?.type !== TOKEN_TYPES.EOF) {
            throw new ParseError(`Unexpected token in interpolation: ${subParser.state.tokens[subParser.state.pos]?.value}`, baseLocation);
        }
        return {
            type: 'Interpolation',
            expression,
            span: expression.span,
        };
    }
    // ============================================================
    // TUPLE & DICT PARSING
    // ============================================================
    parseTupleOrDict() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.LBRACKET, 'Expected [');
        skipNewlines(this.state);
        // Empty tuple
        if (check(this.state, TOKEN_TYPES.RBRACKET)) {
            advance(this.state);
            return {
                type: 'Tuple',
                elements: [],
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Empty dict [:]
        if (check(this.state, TOKEN_TYPES.COLON) &&
            this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.RBRACKET) {
            advance(this.state); // :
            advance(this.state); // ]
            return {
                type: 'Dict',
                entries: [],
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Check if dict (identifier followed by :)
        if (isDictStart(this.state)) {
            return this.parseDict(start);
        }
        // Tuple
        return this.parseTuple(start);
    }
    parseTuple(start) {
        const elements = [];
        elements.push(this.parseExpression());
        skipNewlines(this.state);
        while (check(this.state, TOKEN_TYPES.COMMA)) {
            advance(this.state);
            skipNewlines(this.state);
            if (check(this.state, TOKEN_TYPES.RBRACKET))
                break;
            elements.push(this.parseExpression());
            skipNewlines(this.state);
        }
        expect(this.state, TOKEN_TYPES.RBRACKET, 'Expected ]');
        return {
            type: 'Tuple',
            elements,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    parseDict(start) {
        const entries = [];
        entries.push(this.parseDictEntry());
        skipNewlines(this.state);
        while (check(this.state, TOKEN_TYPES.COMMA)) {
            advance(this.state);
            skipNewlines(this.state);
            if (check(this.state, TOKEN_TYPES.RBRACKET))
                break;
            entries.push(this.parseDictEntry());
            skipNewlines(this.state);
        }
        expect(this.state, TOKEN_TYPES.RBRACKET, 'Expected ]');
        return {
            type: 'Dict',
            entries,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    parseDictEntry() {
        const start = current(this.state).span.start;
        const keyToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected key');
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        const value = this.parseExpression();
        return {
            type: 'DictEntry',
            key: keyToken.value,
            value,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // FUNCTION LITERAL PARSING
    // ============================================================
    /**
     * Parse closure: |params| body or || body
     * Params can be: |x|, |x: string|, |x: string = "default"|
     *
     * Body can be:
     * - Simple: |x| $x (postfix-expr)
     * - Grouped: |x| ($x * 2) (compound expression)
     * - Block: |x| { $a ↵ $b } (multiple statements)
     */
    parseClosure() {
        const start = current(this.state).span.start;
        // Handle || as no-param closure
        if (check(this.state, TOKEN_TYPES.OR)) {
            advance(this.state); // consume ||
            const body = this.parseBody();
            return {
                type: 'Closure',
                params: [],
                body,
                span: makeSpan(start, body.span.end),
            };
        }
        // Handle |params| body
        expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
        const params = [];
        if (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
            params.push(this.parseClosureParam());
            while (check(this.state, TOKEN_TYPES.COMMA)) {
                advance(this.state); // consume comma
                params.push(this.parseClosureParam());
            }
        }
        expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
        // Parse simple-body: block, grouped, or postfix-expr
        const body = this.parseBody();
        return {
            type: 'Closure',
            params,
            body,
            span: makeSpan(start, body.span.end),
        };
    }
    /**
     * Parse simple-body: block, grouped, or postfix-expr
     * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
     *
     * Used by: closures, conditionals, loops
     */
    parseBody() {
        // Block: { ... }
        if (check(this.state, TOKEN_TYPES.LBRACE)) {
            return this.parseBlock();
        }
        // Grouped: ( ... ) - compound expressions go here
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            return this.parseGrouped();
        }
        // Bare break/return: these become pipe chains with implicit $ head
        // Examples: break, return
        if (check(this.state, TOKEN_TYPES.BREAK) ||
            check(this.state, TOKEN_TYPES.RETURN)) {
            return this.parsePipeChain();
        }
        // Parse postfix-expr (compound expressions like pipes must be grouped)
        return this.parsePostfixExpr();
    }
    /**
     * Parse function parameter: name, name: type, name = default, or name: type = default
     * Type can be inferred from default value when not explicitly specified.
     */
    parseClosureParam() {
        const start = current(this.state).span.start;
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected parameter name');
        let typeName = null;
        let defaultValue = null;
        // Optional type annotation
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            typeName = parseTypeName(this.state, FUNC_PARAM_TYPES);
        }
        // Optional default value (with or without type annotation)
        if (check(this.state, TOKEN_TYPES.ASSIGN)) {
            advance(this.state);
            defaultValue = this.parseLiteral();
        }
        return {
            type: 'ClosureParam',
            name: nameToken.value,
            typeName,
            defaultValue,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // VARIABLE PARSING
    // ============================================================
    parseVariable() {
        const start = this.state.tokens[this.state.pos].span.start;
        if (check(this.state, TOKEN_TYPES.PIPE_VAR)) {
            advance(this.state);
            return this.makeVariableWithAccess(null, true, start);
        }
        const dollarToken = expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
        // Special case: $@ is the accumulator variable (used in each/fold with block form)
        if (dollarToken.value === '$@') {
            return this.makeVariableWithAccess('@', false, start);
        }
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        return this.makeVariableWithAccess(nameToken.value, false, start);
    }
    /**
     * Parse variable with field access, bracket access, existence checks, and defaults.
     */
    makeVariableWithAccess(name, isPipeVar, start) {
        // Parse mixed dot and bracket access chain (unified, ordered)
        const { accessChain, existenceCheck } = this.parseAccessChain();
        // Parse optional default value: ?? default
        let defaultValue = null;
        if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE) && !existenceCheck) {
            advance(this.state); // consume ??
            defaultValue = this.parseDefaultValue();
        }
        return {
            type: 'Variable',
            name,
            isPipeVar,
            accessChain,
            defaultValue,
            existenceCheck,
            span: makeSpan(start, start), // Updated later
        };
    }
    /**
     * Parse mixed access chain: dot-based field access and bracket-based index access.
     * Returns unified accessChain maintaining the order of accesses.
     * Also detects existence checks (.?).
     */
    parseAccessChain() {
        const accessChain = [];
        let existenceCheck = null;
        while (check(this.state, TOKEN_TYPES.DOT, TOKEN_TYPES.DOT_QUESTION, TOKEN_TYPES.LBRACKET)) {
            // Check if this is a method call (has parens after identifier)
            if (check(this.state, TOKEN_TYPES.DOT) &&
                isMethodCallWithArgs(this.state)) {
                break;
            }
            // Bracket access: [expr]
            if (check(this.state, TOKEN_TYPES.LBRACKET)) {
                advance(this.state); // consume [
                const expression = this.parsePipeChain();
                expect(this.state, TOKEN_TYPES.RBRACKET, 'Expected ] after index expression');
                accessChain.push({ accessKind: 'bracket', expression });
                continue;
            }
            // Check for existence check: .?
            if (check(this.state, TOKEN_TYPES.DOT_QUESTION)) {
                advance(this.state); // consume .?
                const finalAccess = this.parseFieldAccessElement();
                if (!finalAccess) {
                    break; // Invalid, stop parsing
                }
                // Check for type constraint: &type
                let typeName = null;
                if (check(this.state, TOKEN_TYPES.AMPERSAND)) {
                    advance(this.state); // consume &
                    typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
                }
                existenceCheck = { finalAccess, typeName };
                break; // Existence check must be at end
            }
            // Dot access: .field
            advance(this.state); // consume .
            const access = this.parseFieldAccessElement();
            if (!access) {
                break;
            }
            accessChain.push(access);
        }
        return { accessChain, existenceCheck };
    }
    /**
     * Parse a single field access element (dot-based, no numeric indices).
     * Returns null if no valid element found.
     * Note: Numeric indices use bracket syntax [0], [-1] instead of dot.
     */
    parseFieldAccessElement() {
        // Variable as key: $identifier
        if (check(this.state, TOKEN_TYPES.DOLLAR)) {
            advance(this.state); // consume $
            const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name after .$');
            return { kind: 'variable', variableName: nameToken.value };
        }
        // Computed expression or alternatives: (expr) or (a || b)
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            return this.parseComputedOrAlternatives();
        }
        // Block returning key: {block}
        if (check(this.state, TOKEN_TYPES.LBRACE)) {
            const block = this.parseBlock();
            return { kind: 'block', block };
        }
        // Identifier (literal field)
        if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
            return { kind: 'literal', field: advance(this.state).value };
        }
        return null;
    }
    /**
     * Parse computed expression .(expr) or alternatives .(a || b).
     */
    parseComputedOrAlternatives() {
        advance(this.state); // consume (
        // Look ahead to detect alternatives pattern: identifier || identifier
        // Alternatives are a sequence of identifiers separated by ||
        const alternatives = this.tryParseAlternatives();
        if (alternatives) {
            expect(this.state, TOKEN_TYPES.RPAREN, 'Expected ) after alternatives');
            return { kind: 'alternatives', alternatives };
        }
        // Otherwise, parse as computed expression
        const expression = this.parsePipeChain();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected ) after expression');
        return { kind: 'computed', expression };
    }
    /**
     * Try to parse alternatives: a || b || c
     * Returns array of identifiers if successful, null otherwise.
     */
    tryParseAlternatives() {
        // Save position for backtracking
        const savedPos = this.state.pos;
        const alternatives = [];
        // First identifier
        if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
            return null;
        }
        alternatives.push(advance(this.state).value);
        // Must have at least one ||
        if (!check(this.state, TOKEN_TYPES.OR)) {
            // Not alternatives pattern, backtrack
            this.state.pos = savedPos;
            return null;
        }
        // Parse remaining: || identifier
        while (check(this.state, TOKEN_TYPES.OR)) {
            advance(this.state); // consume ||
            if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
                // Invalid alternatives pattern, backtrack
                this.state.pos = savedPos;
                return null;
            }
            alternatives.push(advance(this.state).value);
        }
        // Must end with )
        if (!check(this.state, TOKEN_TYPES.RPAREN)) {
            // Not a valid alternatives pattern, backtrack
            this.state.pos = savedPos;
            return null;
        }
        return alternatives;
    }
    /**
     * Parse default value after ??.
     * Can be: block, grouped expression, or simple expression.
     */
    parseDefaultValue() {
        if (check(this.state, TOKEN_TYPES.LBRACE)) {
            return this.parseBlock();
        }
        // Parse a simple expression (not a full pipe chain to avoid ambiguity)
        return this.parsePipeChain();
    }
    // ============================================================
    // FUNCTION AND METHOD PARSING
    // ============================================================
    /**
     * Parse a comma-separated list of arguments.
     * Assumes the opening paren has already been consumed.
     * Does NOT consume the closing paren.
     */
    parseArgumentList() {
        const args = [];
        if (!check(this.state, TOKEN_TYPES.RPAREN)) {
            args.push(this.parseExpression());
            while (check(this.state, TOKEN_TYPES.COMMA)) {
                advance(this.state);
                args.push(this.parseExpression());
            }
        }
        return args;
    }
    parseHostCall() {
        const start = current(this.state).span.start;
        const nameToken = advance(this.state);
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const args = this.parseArgumentList();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        return {
            type: 'HostCall',
            name: nameToken.value,
            args,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /** Parse closure call: $fn(args) - invokes closure stored in variable */
    parseClosureCall() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const args = this.parseArgumentList();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        return {
            type: 'ClosureCall',
            name: nameToken.value,
            args,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /** Parse invoke expression: $() or $(args) - invokes pipe value as closure */
    parsePipeInvoke() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.PIPE_VAR, 'Expected $');
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
        const args = this.parseArgumentList();
        expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        return {
            type: 'PipeInvoke',
            args,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    parseMethodCall() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.DOT, 'Expected .');
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected method name');
        // Parens optional for 0-arg methods: .empty ≡ .empty()
        let args = [];
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            advance(this.state);
            args = this.parseArgumentList();
            expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
        }
        return {
            type: 'MethodCall',
            name: nameToken.value,
            args,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // EXTRACTION OPERATOR PARSING
    // ============================================================
    /**
     * Parse sequential spread: @expr (when followed by variable or tuple, not block)
     * Examples: @$closures, @[$f, $g, $h]
     *
     * The spread target is a postfix expression (not a full pipe chain),
     * so `@$fn -> .method` parses as two separate pipe targets.
     */
    parseClosureChain() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.AT, 'Expected @');
        // Parse the target as a postfix expression (not full pipe chain)
        const postfix = this.parsePostfixExpr();
        const target = {
            type: 'PipeChain',
            head: postfix,
            pipes: [],
            terminator: null,
            span: postfix.span,
        };
        return {
            type: 'ClosureChain',
            target,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // DESTRUCTURE
    // ============================================================
    /**
     * Parse destructure: *<elem, elem, ...>
     * Examples:
     *   *<$a, $b, $c>           -- tuple positional
     *   *<name: $n, count: $c>  -- dict key-value
     *   *<$a, _, $c>            -- skip element
     *   *<*<$a, $b>, $c>        -- nested
     */
    parseDestructure() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.STAR_LT, 'Expected *<');
        const elements = [];
        if (!check(this.state, TOKEN_TYPES.GT)) {
            elements.push(this.parseDestructPattern());
            while (check(this.state, TOKEN_TYPES.COMMA)) {
                advance(this.state);
                if (check(this.state, TOKEN_TYPES.GT))
                    break;
                elements.push(this.parseDestructPattern());
            }
        }
        expect(this.state, TOKEN_TYPES.GT, 'Expected >');
        return {
            type: 'Destructure',
            elements,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse a single destructure element:
     *   $var or $var:type     -- variable (positional)
     *   key: $var             -- key-value (dict)
     *   _                     -- skip
     *   *<...>                -- nested destructure
     */
    parseDestructPattern() {
        const start = current(this.state).span.start;
        // Nested destructure: *<...>
        if (check(this.state, TOKEN_TYPES.STAR_LT)) {
            const nested = this.parseDestructure();
            return {
                type: 'DestructPattern',
                kind: 'nested',
                name: null,
                key: null,
                typeName: null,
                nested,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Skip placeholder: _
        if (check(this.state, TOKEN_TYPES.IDENTIFIER) &&
            current(this.state).value === '_') {
            advance(this.state);
            return {
                type: 'DestructPattern',
                kind: 'skip',
                name: null,
                key: null,
                typeName: null,
                nested: null,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Key-value: identifier : $var
        if (isDictStart(this.state)) {
            const keyToken = advance(this.state);
            advance(this.state); // consume :
            expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
            const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
            let typeName = null;
            if (check(this.state, TOKEN_TYPES.COLON)) {
                advance(this.state);
                typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
            }
            return {
                type: 'DestructPattern',
                kind: 'keyValue',
                name: nameToken.value,
                key: keyToken.value,
                typeName,
                nested: null,
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Variable: $var or $var:type
        expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $, identifier:, or _');
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        let typeName = null;
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
        }
        return {
            type: 'DestructPattern',
            kind: 'variable',
            name: nameToken.value,
            key: null,
            typeName,
            nested: null,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    // ============================================================
    // SLICE
    // ============================================================
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
    parseSlice() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.SLASH_LT, 'Expected /<');
        // Parse start:stop:step
        let sliceStart = null;
        let sliceStop = null;
        let sliceStep = null;
        // Start bound (optional)
        if (!check(this.state, TOKEN_TYPES.COLON)) {
            sliceStart = this.parseSliceBound();
        }
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        // Stop bound (optional)
        if (!check(this.state, TOKEN_TYPES.COLON) &&
            !check(this.state, TOKEN_TYPES.GT)) {
            sliceStop = this.parseSliceBound();
        }
        // Step (optional, requires second colon)
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            if (!check(this.state, TOKEN_TYPES.GT)) {
                sliceStep = this.parseSliceBound();
            }
        }
        expect(this.state, TOKEN_TYPES.GT, 'Expected >');
        return {
            type: 'Slice',
            start: sliceStart,
            stop: sliceStop,
            step: sliceStep,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse a slice bound: number, variable, or arithmetic expression
     */
    parseSliceBound() {
        // Negative number
        if (isNegativeNumber(this.state)) {
            const start = current(this.state).span.start;
            advance(this.state); // consume -
            const numToken = advance(this.state);
            return {
                type: 'NumberLiteral',
                value: -parseFloat(numToken.value),
                span: makeSpan(start, numToken.span.end),
            };
        }
        // Positive number
        if (check(this.state, TOKEN_TYPES.NUMBER)) {
            const token = advance(this.state);
            return {
                type: 'NumberLiteral',
                value: parseFloat(token.value),
                span: token.span,
            };
        }
        // Variable
        if (check(this.state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
            return this.parseVariable();
        }
        // Grouped expression: ( expr )
        if (check(this.state, TOKEN_TYPES.LPAREN)) {
            return this.parseGrouped();
        }
        throw new ParseError(`Expected slice bound (number, variable, or grouped expression), got: ${current(this.state).value}`, current(this.state).span.start);
    }
    // ============================================================
    // SPREAD
    // ============================================================
    /**
     * Parse spread: *expr
     * Converts tuple/dict to args for unpacking at closure invocation.
     * Examples: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
     */
    parseSpread() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.STAR, 'Expected *');
        // Bare * (no operand) means $ -> * (implied pipe value spread)
        // This allows: @ { * } as shorthand for @ { $ -> * }
        if (!canStartExpression(this.state)) {
            return {
                type: 'Spread',
                operand: null, // null indicates use $ implicitly
                span: makeSpan(start, current(this.state).span.end),
            };
        }
        // Parse the operand (postfix expression)
        const operand = this.parsePostfixExpr();
        // Wrap the postfix expr in a pipe chain for the expression node
        const operandExpr = {
            type: 'PipeChain',
            head: operand,
            pipes: [],
            terminator: null,
            span: operand.span,
        };
        return {
            type: 'Spread',
            operand: operandExpr,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    /**
     * Parse spread as pipe target: -> *
     * Converts piped value to args.
     */
    parseSpreadTarget() {
        const start = current(this.state).span.start;
        expect(this.state, TOKEN_TYPES.STAR, 'Expected *');
        return {
            type: 'Spread',
            operand: null, // null indicates pipe target form (uses $ implicitly)
            span: makeSpan(start, current(this.state).span.end),
        };
    }
}
//# sourceMappingURL=parser.js.map