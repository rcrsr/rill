/**
 * Expression Parsing
 * Primary expressions, postfix expressions, pipe chains, and pipe targets
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan, peek, } from './state.js';
import { isHostCall, isClosureCall, canStartPipeInvoke, isMethodCall, isTypedCaptureWithArrow, isInlineCaptureWithArrow, isClosureChainTarget, isNegativeNumber, isLiteralStart, isClosureStart, makeBoolLiteralBlock, VALID_TYPE_NAMES, parseTypeName, } from './helpers.js';
import { parseVariable, setParseBlock as setVariablesParseBlock, setParsePipeChain as setVariablesParsePipeChain, } from './variables.js';
import { parseLiteral, parseString, parseClosure, setParseExpression as setLiteralsParseExpression, setParseBlock as setLiteralsParseBlock, setParseGrouped as setLiteralsParseGrouped, setParsePostfixExpr as setLiteralsParsePostfixExpr, setLiteralsParsePipeChain, } from './literals.js';
import { parseHostCall, parseClosureCall, parsePipeInvoke, parseMethodCall, setParseExpression as setFunctionsParseExpression, } from './functions.js';
import { parsePipedConditional, parseConditionalWithCondition, parseConditionalRest, parseLoop, parseLoopWithInput, parseBlock, } from './control-flow.js';
import { parseClosureChain, parseDestructure, parseSlice, parseSpread, parseSpreadTarget, setParsePostfixExpr as setExtractionParsePostfixExpr, setParseGrouped as setExtractionParseGrouped, } from './extraction.js';
/**
 * Parse constructs common to both primary expressions and pipe targets.
 * Returns null if no common construct matches.
 */
function parseCommonConstruct(state) {
    // Boolean negation: !expr (for filter predicates like !.empty in pipes)
    // Can be: !expr ? then ! else  OR  standalone !expr (returns true/false)
    if (check(state, TOKEN_TYPES.BANG)) {
        const start = current(state).span.start;
        advance(state); // consume !
        // Use parsePostfixExprBase to avoid consuming `?` - we handle it ourselves
        const operand = parsePostfixExprBase(state);
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
        if (check(state, TOKEN_TYPES.QUESTION)) {
            advance(state); // consume ?
            return parseConditionalRest(state, negationCondition, start);
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
    if (check(state, TOKEN_TYPES.QUESTION)) {
        return parsePipedConditional(state);
    }
    // Loop: @ body [? cond]
    if (check(state, TOKEN_TYPES.AT)) {
        return parseLoop(state, null);
    }
    // Block (may be followed by @ for loop with input, or ? for conditional)
    if (check(state, TOKEN_TYPES.LBRACE)) {
        const block = parseBlock(state);
        // Check for loop: { input } @ body
        if (check(state, TOKEN_TYPES.AT)) {
            return parseLoopWithInput(state, block);
        }
        // Check for conditional: { expr } ? then ! else
        if (check(state, TOKEN_TYPES.QUESTION)) {
            return parseConditionalWithCondition(state, block);
        }
        return block;
    }
    // Grouped expression: ( inner-expr )
    // Allows arithmetic, pipes, and compound expressions
    // May be followed by: @ for loop, ? for conditional
    if (check(state, TOKEN_TYPES.LPAREN)) {
        const grouped = parseGrouped(state);
        // Check for loop: (expr) @ body
        if (check(state, TOKEN_TYPES.AT)) {
            return parseLoopWithInput(state, grouped);
        }
        // Check for conditional: (expr) ? then ! else
        if (check(state, TOKEN_TYPES.QUESTION)) {
            return parseConditionalWithCondition(state, grouped);
        }
        return grouped;
    }
    return null;
}
// ============================================================
// EXPRESSION PARSING
// ============================================================
export function parseExpression(state) {
    return parsePipeChain(state);
}
/**
 * Helper to create implicit pipe variable ($) for bare break/return
 */
function implicitPipeVar(span) {
    const varNode = {
        type: 'Variable',
        name: null,
        isPipeVar: true,
        accessChain: [],
        fieldAccess: [],
        bracketAccess: [],
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
export function parsePipeChain(state) {
    const start = current(state).span.start;
    // Handle bare break: "break" ≡ "$ -> break"
    if (check(state, TOKEN_TYPES.BREAK)) {
        const token = advance(state);
        return {
            type: 'PipeChain',
            head: implicitPipeVar(token.span),
            pipes: [],
            terminator: { type: 'Break', span: token.span },
            span: token.span,
        };
    }
    // Handle bare return: "return" ≡ "$ -> return"
    if (check(state, TOKEN_TYPES.RETURN)) {
        const token = advance(state);
        return {
            type: 'PipeChain',
            head: implicitPipeVar(token.span),
            pipes: [],
            terminator: { type: 'Return', span: token.span },
            span: token.span,
        };
    }
    // Parse expression head with full precedence chain:
    // logical-or -> logical-and -> comparison -> additive -> multiplicative -> unary -> postfix
    let head = parseLogicalOr(state);
    // Check for loop: expr @ body
    // This allows: $status.pending @ { ... }, ($x < 10) @ { ... }
    if (check(state, TOKEN_TYPES.AT)) {
        const headAsPipeChain = {
            type: 'PipeChain',
            head,
            pipes: [],
            terminator: null,
            span: head.span,
        };
        const loop = parseLoopWithInput(state, headAsPipeChain);
        const span = makeSpan(head.span.start, current(state).span.end);
        head = wrapLoopInPostfixExpr(loop, span);
    }
    // Check for conditional: expr ? then ! else
    // This allows: 5 + 3 ? "big" ! "small", $ready ? "go" ! "wait"
    if (check(state, TOKEN_TYPES.QUESTION)) {
        const headAsPipeChain = {
            type: 'PipeChain',
            head,
            pipes: [],
            terminator: null,
            span: head.span,
        };
        const conditional = parseConditionalWithCondition(state, headAsPipeChain);
        const span = makeSpan(head.span.start, current(state).span.end);
        head = wrapConditionalInPostfixExpr(conditional, span);
    }
    const pipes = [];
    let terminator = null;
    while (check(state, TOKEN_TYPES.ARROW)) {
        advance(state);
        // Check for break terminator: -> break
        if (check(state, TOKEN_TYPES.BREAK)) {
            const token = advance(state);
            terminator = { type: 'Break', span: token.span };
            break;
        }
        // Check for return terminator: -> return
        if (check(state, TOKEN_TYPES.RETURN)) {
            const token = advance(state);
            terminator = { type: 'Return', span: token.span };
            break;
        }
        // Check for capture vs ClosureCall: $identifier
        if (check(state, TOKEN_TYPES.DOLLAR)) {
            // ClosureCall: $name( - pass to parsePipeTarget
            if (isClosureCall(state)) {
                pipes.push(parsePipeTarget(state));
                continue;
            }
            // Inline capture: $name -> (followed by arrow)
            if (isInlineCaptureWithArrow(state)) {
                pipes.push(parseCapture(state));
                continue;
            }
            // Inline capture with type: $name:type -> (followed by arrow)
            if (isTypedCaptureWithArrow(state)) {
                pipes.push(parseCapture(state));
                continue;
            }
            // Terminal capture: $name or $name:type (end of chain)
            terminator = parseCapture(state);
            break;
        }
        pipes.push(parsePipeTarget(state));
    }
    // Check for conditional after pipe chain: $val -> :?string ? then ! else
    if (check(state, TOKEN_TYPES.QUESTION) && pipes.length > 0) {
        const span = makeSpan(start, current(state).span.end);
        const chainAsCondition = {
            type: 'PipeChain',
            head,
            pipes,
            terminator: null,
            span,
        };
        const conditional = parseConditionalWithCondition(state, chainAsCondition);
        const resultSpan = makeSpan(start, current(state).span.end);
        return {
            type: 'PipeChain',
            head: wrapConditionalInPostfixExpr(conditional, resultSpan),
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
        span: makeSpan(start, current(state).span.end),
    };
}
export function parsePostfixExpr(state) {
    const postfixExpr = parsePostfixExprBase(state);
    // Check if this postfix-expr is a condition for a conditional: expr ? then ! else
    // This allows: $ready ? "go" ! "wait", $data.valid ? process() ! skip()
    if (check(state, TOKEN_TYPES.QUESTION)) {
        const conditional = parseConditionalWithCondition(state, postfixExpr);
        const span = makeSpan(postfixExpr.span.start, current(state).span.end);
        return wrapConditionalInPostfixExpr(conditional, span);
    }
    return postfixExpr;
}
/**
 * Parse postfix expression without checking for trailing `?` conditional.
 * Used when the caller needs to handle the `?` themselves (e.g., for negation).
 */
function parsePostfixExprBase(state) {
    const start = current(state).span.start;
    let primary = parsePrimary(state);
    // Check for postfix type assertion: expr:type or expr:?type
    // This binds tighter than method calls: 42:number.str means (42:number).str
    if (check(state, TOKEN_TYPES.COLON)) {
        primary = parsePostfixTypeOperation(state, primary, start);
    }
    const methods = [];
    // Parse method calls and invocations
    // Method call: .name(args) or .name
    // Invocation: (args) - calls the result as a closure
    while (isMethodCall(state) || check(state, TOKEN_TYPES.LPAREN)) {
        if (isMethodCall(state)) {
            methods.push(parseMethodCall(state));
        }
        else {
            // Postfix invocation: expr(args)
            methods.push(parseInvoke(state));
        }
    }
    return {
        type: 'PostfixExpr',
        primary,
        methods,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse postfix invocation: (args)
 * This allows calling the result of any expression as a closure.
 * Examples: $handlers[0](), $dict.method()(), ($closure)()
 */
function parseInvoke(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const args = [];
    if (!check(state, TOKEN_TYPES.RPAREN)) {
        args.push(parsePipeChain(state));
        while (check(state, TOKEN_TYPES.COMMA)) {
            advance(state); // consume ,
            args.push(parsePipeChain(state));
        }
    }
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    return {
        type: 'Invoke',
        args,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse postfix type operation: primary:type or primary:?type
 * Creates TypeAssertion or TypeCheck node with the primary as operand.
 */
function parsePostfixTypeOperation(state, primary, start) {
    expect(state, TOKEN_TYPES.COLON, 'Expected :');
    // Check for type check (question mark)
    const isCheck = check(state, TOKEN_TYPES.QUESTION);
    if (isCheck) {
        advance(state); // consume ?
    }
    // Parse type name
    const typeName = parseTypeName(state, VALID_TYPE_NAMES);
    // Wrap primary in PostfixExprNode for the operand
    const operand = {
        type: 'PostfixExpr',
        primary,
        methods: [],
        span: makeSpan(start, current(state).span.end),
    };
    const span = makeSpan(start, current(state).span.end);
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
export function parsePrimary(state) {
    // Spread operator: *expr - convert tuple/dict to args
    if (check(state, TOKEN_TYPES.STAR)) {
        return parseSpread(state);
    }
    // Unary minus for negative numbers: -42
    if (isNegativeNumber(state)) {
        const start = current(state).span.start;
        advance(state); // consume -
        const numToken = advance(state); // consume number
        return {
            type: 'NumberLiteral',
            value: -parseFloat(numToken.value),
            span: makeSpan(start, numToken.span.end),
        };
    }
    // Closure: |params| body or || body
    if (isClosureStart(state)) {
        return parseClosure(state);
    }
    // Literal (strings, numbers, booleans, tuples/dicts)
    if (isLiteralStart(state)) {
        return parseLiteral(state);
    }
    // Closure call: $fn(args) - closure invocation
    if (isClosureCall(state)) {
        return parseClosureCall(state);
    }
    // Variable
    if (check(state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
        return parseVariable(state);
    }
    // Bare method call: .method ≡ $ -> .method (implicit pipe var receiver)
    if (isMethodCall(state)) {
        return parseMethodCall(state);
    }
    // Function call (identifier followed by paren)
    if (isHostCall(state)) {
        return parseHostCall(state);
    }
    // Common constructs: conditionals, loops, blocks, grouped expressions
    const common = parseCommonConstruct(state);
    if (common)
        return common;
    throw new ParseError(`Unexpected token: ${current(state).value}`, current(state).span.start);
}
// ============================================================
// PIPE TARGET PARSING
// ============================================================
export function parsePipeTarget(state) {
    // Type operations: -> :type or -> :?type
    if (check(state, TOKEN_TYPES.COLON)) {
        return parseTypeOperation(state);
    }
    // Spread as pipe target: -> * (convert pipe value to args)
    if (check(state, TOKEN_TYPES.STAR)) {
        return parseSpreadTarget(state);
    }
    // Extraction operators
    if (check(state, TOKEN_TYPES.STAR_LT)) {
        return parseDestructure(state);
    }
    if (check(state, TOKEN_TYPES.SLASH_LT)) {
        return parseSlice(state);
    }
    // Collection operators: -> each, -> map, -> fold, -> filter
    if (check(state, TOKEN_TYPES.EACH)) {
        return parseEachExpr(state);
    }
    if (check(state, TOKEN_TYPES.MAP)) {
        return parseMapExpr(state);
    }
    if (check(state, TOKEN_TYPES.FOLD)) {
        return parseFoldExpr(state);
    }
    if (check(state, TOKEN_TYPES.FILTER)) {
        return parseFilterExpr(state);
    }
    // Method call (starts with .) - may be condition for conditional
    if (check(state, TOKEN_TYPES.DOT)) {
        const methodCall = parseMethodCall(state);
        // Check if this is a condition for a conditional: .valid ? then ! else
        if (check(state, TOKEN_TYPES.QUESTION)) {
            // Wrap in PostfixExpr with implicit $ receiver for the condition
            const postfixExpr = {
                type: 'PostfixExpr',
                primary: {
                    type: 'Variable',
                    name: null,
                    isPipeVar: true,
                    accessChain: [],
                    fieldAccess: [],
                    bracketAccess: [],
                    defaultValue: null,
                    existenceCheck: null,
                    span: methodCall.span,
                },
                methods: [methodCall],
                span: methodCall.span,
            };
            return parseConditionalWithCondition(state, postfixExpr);
        }
        return methodCall;
    }
    // Closure call: $fn(args) - closure invocation as pipe target
    if (isClosureCall(state)) {
        return parseClosureCall(state);
    }
    // Sequential spread: -> @$var or -> @[closures] (not @{ } which is for-loop, not @( which is while)
    if (isClosureChainTarget(state)) {
        return parseClosureChain(state);
    }
    // Pipe invoke: -> $() or -> $(args) - invoke pipe value as closure
    // The $ prefix distinguishes from grouped expressions: -> (expr)
    if (canStartPipeInvoke(state)) {
        return parsePipeInvoke(state);
    }
    // String literal (template with {$} interpolation)
    if (check(state, TOKEN_TYPES.STRING)) {
        return parseString(state);
    }
    // Function call with parens
    if (isHostCall(state)) {
        return parseHostCall(state);
    }
    // Bare function name: "-> greet" ≡ "-> greet()" with $ as implicit arg
    if (check(state, TOKEN_TYPES.IDENTIFIER)) {
        const start = current(state).span.start;
        const nameToken = advance(state);
        return {
            type: 'HostCall',
            name: nameToken.value,
            args: [],
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Common constructs: conditionals, loops, blocks, arithmetic
    const common = parseCommonConstruct(state);
    if (common) {
        // Check for postfix type assertion on the common construct: (expr):type
        if (check(state, TOKEN_TYPES.COLON)) {
            return parsePostfixTypeOperation(state, common, common.span.start);
        }
        return common;
    }
    throw new ParseError(`Expected pipe target, got: ${current(state).value}`, current(state).span.start);
}
// ============================================================
// CAPTURE PARSING
// ============================================================
export function parseCapture(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.DOLLAR, 'Expected $');
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
    // Optional type annotation: $name:type
    let typeName = null;
    if (check(state, TOKEN_TYPES.COLON)) {
        advance(state);
        typeName = parseTypeName(state, VALID_TYPE_NAMES);
    }
    return {
        type: 'Capture',
        name: nameToken.value,
        typeName,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// HELPER: Create pipe chain from single primary
// ============================================================
export function makePipeChain(primary, start) {
    return {
        type: 'PipeChain',
        head: {
            type: 'PostfixExpr',
            primary,
            methods: [],
            span: makeSpan(start, start),
        },
        pipes: [],
        terminator: null,
        span: makeSpan(start, start),
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
export function parseGrouped(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const expression = parsePipeChain(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    return {
        type: 'GroupedExpr',
        expression,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Check if current token is a comparison operator.
 */
function isComparisonOp(state) {
    return check(state, TOKEN_TYPES.EQ, TOKEN_TYPES.NE, TOKEN_TYPES.LT, TOKEN_TYPES.GT, TOKEN_TYPES.LE, TOKEN_TYPES.GE);
}
/** Map token type to comparison operator string */
function tokenToComparisonOp(tokenType) {
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
function wrapConditionalInPostfixExpr(conditional, span) {
    return {
        type: 'PostfixExpr',
        primary: conditional,
        methods: [],
        span,
    };
}
/** Wrap a loop node in a PostfixExpr */
function wrapLoopInPostfixExpr(loop, span) {
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
function parseLogicalOr(state) {
    const start = current(state).span.start;
    let left = parseLogicalAnd(state);
    while (check(state, TOKEN_TYPES.OR)) {
        advance(state);
        const right = parseLogicalAnd(state);
        left = {
            type: 'BinaryExpr',
            op: '||',
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
/**
 * Parse logical AND expression: comparison ('&&' comparison)*
 */
function parseLogicalAnd(state) {
    const start = current(state).span.start;
    let left = parseComparison(state);
    while (check(state, TOKEN_TYPES.AND)) {
        advance(state);
        const right = parseComparison(state);
        left = {
            type: 'BinaryExpr',
            op: '&&',
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
/**
 * Parse comparison expression: additive (comp-op additive)?
 */
function parseComparison(state) {
    const start = current(state).span.start;
    let left = parseAdditive(state);
    if (isComparisonOp(state)) {
        const opToken = advance(state);
        const op = tokenToComparisonOp(opToken.type);
        const right = parseAdditive(state);
        left = {
            type: 'BinaryExpr',
            op,
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
/**
 * Parse additive expression: multiplicative (('+' | '-') multiplicative)*
 */
function parseAdditive(state) {
    const start = current(state).span.start;
    let left = parseMultiplicative(state);
    while (check(state, TOKEN_TYPES.PLUS, TOKEN_TYPES.MINUS)) {
        const opToken = advance(state);
        const op = opToken.type === TOKEN_TYPES.PLUS ? '+' : '-';
        const right = parseMultiplicative(state);
        left = {
            type: 'BinaryExpr',
            op,
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
/**
 * Parse multiplicative expression: unary (('*' | '/' | '%') unary)*
 */
function parseMultiplicative(state) {
    const start = current(state).span.start;
    let left = parseUnary(state);
    while (check(state, TOKEN_TYPES.STAR, TOKEN_TYPES.SLASH, TOKEN_TYPES.PERCENT)) {
        const opToken = advance(state);
        const op = opToken.type === TOKEN_TYPES.STAR
            ? '*'
            : opToken.type === TOKEN_TYPES.SLASH
                ? '/'
                : '%';
        const right = parseUnary(state);
        left = {
            type: 'BinaryExpr',
            op,
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
/**
 * Parse unary expression: ('-' | '!') unary | postfix-expr
 */
function parseUnary(state) {
    if (check(state, TOKEN_TYPES.MINUS)) {
        const start = current(state).span.start;
        advance(state);
        const operand = parseUnary(state);
        return {
            type: 'UnaryExpr',
            op: '-',
            operand,
            span: makeSpan(start, operand.span.end),
        };
    }
    if (check(state, TOKEN_TYPES.BANG)) {
        const start = current(state).span.start;
        advance(state);
        const operand = parseUnary(state);
        return {
            type: 'UnaryExpr',
            op: '!',
            operand,
            span: makeSpan(start, operand.span.end),
        };
    }
    return parsePostfixExpr(state);
}
// ============================================================
// TYPE OPERATIONS
// ============================================================
/**
 * Parse type operation as pipe target: :type or :?type
 * These are shorthand for $:type and $:?type (type assertion/check on pipe value).
 */
function parseTypeOperation(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.COLON, 'Expected :');
    // Check for type check (question mark)
    const isCheck = check(state, TOKEN_TYPES.QUESTION);
    if (isCheck) {
        advance(state); // consume ?
    }
    // Parse type name
    const typeName = parseTypeName(state, VALID_TYPE_NAMES);
    const span = makeSpan(start, current(state).span.end);
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
// COLLECTION OPERATORS (each, map, fold)
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
function parseIteratorBody(state) {
    // Inline closure: |x| body or |x, acc = init| body
    if (isClosureStart(state)) {
        return parseClosure(state);
    }
    // Block: { body }
    if (check(state, TOKEN_TYPES.LBRACE)) {
        return parseBlock(state);
    }
    // Grouped: (expr)
    if (check(state, TOKEN_TYPES.LPAREN)) {
        return parseGrouped(state);
    }
    // Variable closure: $fn or identity $
    if (check(state, TOKEN_TYPES.DOLLAR) || check(state, TOKEN_TYPES.PIPE_VAR)) {
        return parseVariable(state);
    }
    // Spread: * (converts element to tuple)
    if (check(state, TOKEN_TYPES.STAR)) {
        return parseSpread(state);
    }
    throw new ParseError(`Expected collection body (closure, block, grouped, variable, or spread), got: ${current(state).value}`, current(state).span.start);
}
/**
 * Check if the next token sequence indicates an accumulator followed by a body.
 * Disambiguation rule from spec:
 *   - (expr) at end of statement or before -> → grouped expression (body)
 *   - (expr) { block } → accumulator, block body
 *   - (expr) |x| body → accumulator, closure body
 *   - (expr1) (expr2) → accumulator, grouped body
 */
function hasAccumulatorPrefix(state) {
    if (!check(state, TOKEN_TYPES.LPAREN)) {
        return false;
    }
    // Find matching close paren
    let depth = 1;
    let i = 1;
    while (depth > 0) {
        const token = peek(state, i);
        if (!token)
            return false;
        if (token.type === TOKEN_TYPES.LPAREN)
            depth++;
        else if (token.type === TOKEN_TYPES.RPAREN)
            depth--;
        i++;
    }
    // Look at what follows the closing paren
    const afterParen = peek(state, i);
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
function parseEachExpr(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.EACH, 'Expected each');
    let accumulator = null;
    // Check for accumulator prefix: (init) followed by body
    if (hasAccumulatorPrefix(state)) {
        accumulator = parseGrouped(state).expression;
    }
    const body = parseIteratorBody(state);
    return {
        type: 'EachExpr',
        body,
        accumulator,
        span: makeSpan(start, current(state).span.end),
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
function parseMapExpr(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.MAP, 'Expected map');
    const body = parseIteratorBody(state);
    return {
        type: 'MapExpr',
        body,
        span: makeSpan(start, current(state).span.end),
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
function parseFoldExpr(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.FOLD, 'Expected fold');
    let accumulator = null;
    // Check for accumulator prefix: (init) followed by body
    if (hasAccumulatorPrefix(state)) {
        accumulator = parseGrouped(state).expression;
    }
    const body = parseIteratorBody(state);
    return {
        type: 'FoldExpr',
        body,
        accumulator,
        span: makeSpan(start, current(state).span.end),
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
function parseFilterExpr(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.FILTER, 'Expected filter');
    const body = parseIteratorBody(state);
    return {
        type: 'FilterExpr',
        body,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// WIRE UP CIRCULAR DEPENDENCIES
// ============================================================
// Set up all circular dependency injections
setLiteralsParseExpression(parseExpression);
setLiteralsParseBlock(parseBlock);
setLiteralsParseGrouped(parseGrouped);
setLiteralsParsePostfixExpr(parsePostfixExpr);
setLiteralsParsePipeChain(parsePipeChain);
setFunctionsParseExpression(parseExpression);
setExtractionParsePostfixExpr(parsePostfixExpr);
setExtractionParseGrouped(parseGrouped);
setVariablesParseBlock(parseBlock);
setVariablesParsePipeChain(parsePipeChain);
//# sourceMappingURL=expressions.js.map