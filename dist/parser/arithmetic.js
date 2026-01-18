/**
 * Arithmetic Expression Parsing
 * Handles | expr | arithmetic expressions
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan } from './state.js';
import { parseVariable } from './variables.js';
// ============================================================
// ARITHMETIC EXPRESSIONS
// ============================================================
/**
 * Parse arithmetic expression: | expr |
 * Grammar:
 *   arith-expr = "|" additive "|"
 *   additive   = multiplicative { ("+" | "-") multiplicative }
 *   multiplicative = factor { ("*" | "/" | "%") factor }
 *   factor     = number | variable | "(" additive ")" | "-" factor
 */
export function parseArithmetic(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
    const expr = parseArithAdditive(state);
    expect(state, TOKEN_TYPES.PIPE_BAR, 'Expected closing |');
    return {
        ...expr,
        span: makeSpan(start, current(state).span.end),
    };
}
function parseArithAdditive(state) {
    const start = current(state).span.start;
    let left = parseArithMultiplicative(state);
    while (check(state, TOKEN_TYPES.PLUS, TOKEN_TYPES.MINUS)) {
        const opToken = advance(state);
        const op = opToken.type === TOKEN_TYPES.PLUS ? '+' : '-';
        const right = parseArithMultiplicative(state);
        left = {
            type: 'Arithmetic',
            op,
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
function parseArithMultiplicative(state) {
    const start = current(state).span.start;
    let left = parseArithFactor(state);
    while (check(state, TOKEN_TYPES.STAR, TOKEN_TYPES.SLASH, TOKEN_TYPES.PERCENT)) {
        const opToken = advance(state);
        let op;
        switch (opToken.type) {
            case TOKEN_TYPES.STAR:
                op = '*';
                break;
            case TOKEN_TYPES.SLASH:
                op = '/';
                break;
            default:
                op = '%';
        }
        const right = parseArithFactor(state);
        left = {
            type: 'Arithmetic',
            op,
            left,
            right,
            span: makeSpan(start, current(state).span.end),
        };
    }
    return left;
}
function parseArithFactor(state) {
    const start = current(state).span.start;
    // Unary minus
    if (check(state, TOKEN_TYPES.MINUS)) {
        advance(state);
        const operand = parseArithFactor(state);
        // Represent -x as (0 - x)
        const zero = {
            type: 'NumberLiteral',
            value: 0,
            span: makeSpan(start, start),
        };
        return {
            type: 'Arithmetic',
            op: '-',
            left: zero,
            right: operand,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Grouped expression
    if (check(state, TOKEN_TYPES.LPAREN)) {
        advance(state);
        const expr = parseArithAdditive(state);
        expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
        return expr;
    }
    // Number literal
    if (check(state, TOKEN_TYPES.NUMBER)) {
        const token = advance(state);
        return {
            type: 'Arithmetic',
            op: null,
            left: {
                type: 'NumberLiteral',
                value: parseFloat(token.value),
                span: token.span,
            },
            right: null,
            span: token.span,
        };
    }
    // Variable ($ or $name)
    if (check(state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
        const variable = parseVariable(state);
        return {
            type: 'Arithmetic',
            op: null,
            left: variable,
            right: null,
            span: variable.span,
        };
    }
    throw new ParseError(`Expected number or variable in arithmetic, got: ${current(state).value}`, current(state).span.start);
}
//# sourceMappingURL=arithmetic.js.map