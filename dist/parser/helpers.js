/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, peek, expect } from './state.js';
// ============================================================
// VALID TYPE NAMES
// ============================================================
/** @internal */
export const VALID_TYPE_NAMES = [
    'string',
    'number',
    'bool',
    'closure',
    'list',
    'dict',
    'tuple',
];
/** @internal */
export const FUNC_PARAM_TYPES = ['string', 'number', 'bool'];
// ============================================================
// LOOKAHEAD PREDICATES
// ============================================================
/**
 * Check for function call: identifier(
 * @internal
 */
export function isHostCall(state) {
    return (check(state, TOKEN_TYPES.IDENTIFIER) &&
        peek(state, 1).type === TOKEN_TYPES.LPAREN);
}
/**
 * Check for closure call: $name(
 * @internal
 */
export function isClosureCall(state) {
    return (check(state, TOKEN_TYPES.DOLLAR) &&
        peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
        peek(state, 2).type === TOKEN_TYPES.LPAREN);
}
/**
 * Check for pipe invoke: $( (invoke pipe value as closure)
 * @internal
 */
export function canStartPipeInvoke(state) {
    return (check(state, TOKEN_TYPES.PIPE_VAR) &&
        peek(state, 1).type === TOKEN_TYPES.LPAREN);
}
/**
 * Check for method call: .identifier
 * @internal
 */
export function isMethodCall(state) {
    return (check(state, TOKEN_TYPES.DOT) &&
        peek(state, 1).type === TOKEN_TYPES.IDENTIFIER);
}
/**
 * Check for typed capture with arrow: $name:type ->
 * @internal
 */
export function isTypedCaptureWithArrow(state) {
    return (peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
        peek(state, 2).type === TOKEN_TYPES.COLON &&
        peek(state, 3).type === TOKEN_TYPES.IDENTIFIER &&
        peek(state, 4).type === TOKEN_TYPES.ARROW);
}
/**
 * Check for inline capture: $name ->
 * @internal
 */
export function isInlineCaptureWithArrow(state) {
    return (peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
        peek(state, 2).type === TOKEN_TYPES.ARROW);
}
/**
 * Check for sequential spread target: @$ or @[ (not @{ which is for-loop)
 * @internal
 */
export function isClosureChainTarget(state) {
    return (check(state, TOKEN_TYPES.AT) &&
        (peek(state, 1).type === TOKEN_TYPES.DOLLAR ||
            peek(state, 1).type === TOKEN_TYPES.LBRACKET));
}
/**
 * Check for negative number: -42
 * @internal
 */
export function isNegativeNumber(state) {
    return (check(state, TOKEN_TYPES.MINUS) &&
        peek(state, 1).type === TOKEN_TYPES.NUMBER);
}
/**
 * Check for dict start: identifier followed by colon
 * @internal
 */
export function isDictStart(state) {
    return (check(state, TOKEN_TYPES.IDENTIFIER) &&
        peek(state, 1).type === TOKEN_TYPES.COLON);
}
/**
 * Check for method call with args (for field access termination): .identifier(
 * @internal
 */
export function isMethodCallWithArgs(state) {
    return (peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
        peek(state, 2).type === TOKEN_TYPES.LPAREN);
}
/**
 * Check for literal start (not LPAREN - that's now grouping)
 * @internal
 */
export function isLiteralStart(state) {
    return check(state, TOKEN_TYPES.STRING, TOKEN_TYPES.NUMBER, TOKEN_TYPES.TRUE, TOKEN_TYPES.FALSE, TOKEN_TYPES.LBRACKET);
}
/**
 * Check if current token can start an expression (for bare spread detection)
 * @internal
 */
export function canStartExpression(state) {
    return (isLiteralStart(state) ||
        isClosureStart(state) ||
        check(state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR, TOKEN_TYPES.IDENTIFIER, TOKEN_TYPES.DOT, TOKEN_TYPES.LPAREN, TOKEN_TYPES.LBRACE, TOKEN_TYPES.AT, TOKEN_TYPES.QUESTION, TOKEN_TYPES.BANG, TOKEN_TYPES.STAR, TOKEN_TYPES.MINUS));
}
/**
 * Check for closure start: | or ||
 * - |params| body
 * - || body (no-param closure)
 * @internal
 */
export function isClosureStart(state) {
    return check(state, TOKEN_TYPES.PIPE_BAR, TOKEN_TYPES.OR);
}
// ============================================================
// UTILITY PARSING FUNCTIONS
// ============================================================
/**
 * Parse and validate a type name from an identifier token.
 * Throws ParseError if the type is not in the allowed list.
 * @internal
 */
export function parseTypeName(state, validTypes) {
    const typeToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected type name');
    if (!validTypes.includes(typeToken.value)) {
        throw new ParseError(`Invalid type: ${typeToken.value} (expected: ${validTypes.join(', ')})`, typeToken.span.start);
    }
    return typeToken.value;
}
/**
 * Create a block containing a single boolean literal statement
 * @internal
 */
export function makeBoolLiteralBlock(value, span) {
    return {
        type: 'Block',
        statements: [
            {
                type: 'Statement',
                expression: {
                    type: 'PipeChain',
                    head: {
                        type: 'PostfixExpr',
                        primary: { type: 'BoolLiteral', value, span },
                        methods: [],
                        span,
                    },
                    pipes: [],
                    terminator: null,
                    span,
                },
                span,
            },
        ],
        span,
    };
}
/**
 * Wrap a PostfixExprNode in a block for use in conditionals
 * @internal
 */
export function wrapExprInBlock(expr) {
    return {
        type: 'Block',
        statements: [
            {
                type: 'Statement',
                expression: {
                    type: 'PipeChain',
                    head: expr,
                    pipes: [],
                    terminator: null,
                    span: expr.span,
                },
                span: expr.span,
            },
        ],
        span: expr.span,
    };
}
// Note: parseArgumentList is defined in expressions.ts to avoid circular dependencies
// since it depends on parseExpression
//# sourceMappingURL=helpers.js.map