/**
 * Function and Method Parsing
 * Function calls, method calls, closure calls, and invoke expressions
 */
import { TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan, } from './state.js';
// Forward declaration - will be set by expressions.ts to break circular dependency
let parseExpressionFn;
export function setParseExpression(fn) {
    parseExpressionFn = fn;
}
// ============================================================
// ARGUMENT LIST PARSING
// ============================================================
/**
 * Parse a comma-separated list of arguments.
 * Assumes the opening paren has already been consumed.
 * Does NOT consume the closing paren.
 */
export function parseArgumentList(state) {
    const args = [];
    if (!check(state, TOKEN_TYPES.RPAREN)) {
        args.push(parseExpressionFn(state));
        while (check(state, TOKEN_TYPES.COMMA)) {
            advance(state);
            args.push(parseExpressionFn(state));
        }
    }
    return args;
}
// ============================================================
// FUNCTION CALLS
// ============================================================
export function parseHostCall(state) {
    const start = current(state).span.start;
    const nameToken = advance(state);
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const args = parseArgumentList(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    return {
        type: 'HostCall',
        name: nameToken.value,
        args,
        span: makeSpan(start, current(state).span.end),
    };
}
/** Parse closure call: $fn(args) - invokes closure stored in variable */
export function parseClosureCall(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.DOLLAR, 'Expected $');
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const args = parseArgumentList(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    return {
        type: 'ClosureCall',
        name: nameToken.value,
        args,
        span: makeSpan(start, current(state).span.end),
    };
}
/** Parse invoke expression: $() or $(args) - invokes pipe value as closure */
export function parsePipeInvoke(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.PIPE_VAR, 'Expected $');
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const args = parseArgumentList(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    return {
        type: 'PipeInvoke',
        args,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// METHOD CALLS
// ============================================================
export function parseMethodCall(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.DOT, 'Expected .');
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected method name');
    // Parens optional for 0-arg methods: .empty ≡ .empty()
    let args = [];
    if (check(state, TOKEN_TYPES.LPAREN)) {
        advance(state);
        args = parseArgumentList(state);
        expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    }
    return {
        type: 'MethodCall',
        name: nameToken.value,
        args,
        span: makeSpan(start, current(state).span.end),
    };
}
//# sourceMappingURL=functions.js.map