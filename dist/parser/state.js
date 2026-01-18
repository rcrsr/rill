/**
 * Parser State
 * Core state management and token navigation utilities
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
export function createParserState(tokens, options = {}) {
    return {
        tokens,
        pos: 0,
        recoveryMode: options.recoveryMode ?? false,
        errors: [],
        source: options.source ?? '',
    };
}
// ============================================================
// TOKEN NAVIGATION
// ============================================================
/** @internal */
export function current(state) {
    const token = state.tokens[state.pos];
    if (token)
        return token;
    const last = state.tokens[state.tokens.length - 1];
    if (last)
        return last;
    throw new Error('No tokens available');
}
/** @internal */
export function peek(state, offset = 0) {
    const idx = state.pos + offset;
    const token = state.tokens[idx];
    if (token)
        return token;
    const last = state.tokens[state.tokens.length - 1];
    if (last)
        return last;
    throw new Error('No tokens available');
}
/** @internal */
export function isAtEnd(state) {
    return current(state).type === TOKEN_TYPES.EOF;
}
/** @internal */
export function check(state, ...types) {
    return types.includes(current(state).type);
}
/** @internal */
export function advance(state) {
    const token = current(state);
    if (!isAtEnd(state))
        state.pos++;
    return token;
}
/** @internal */
export function expect(state, type, message) {
    if (check(state, type))
        return advance(state);
    const token = current(state);
    const hint = generateHint(type, token);
    const fullMessage = hint ? `${message}. ${hint}` : message;
    throw new ParseError(fullMessage, token.span.start);
}
/** @internal */
export function skipNewlines(state) {
    while (check(state, TOKEN_TYPES.NEWLINE))
        advance(state);
}
// ============================================================
// ERROR HINTS
// ============================================================
/**
 * Generate contextual hints for common parse errors.
 * @internal
 */
function generateHint(expectedType, actualToken) {
    const actual = actualToken.type;
    const value = actualToken.value;
    // Hint for unclosed brackets/braces/parens
    if (expectedType === TOKEN_TYPES.RPAREN && actual === TOKEN_TYPES.EOF) {
        return 'Hint: Check for unclosed parenthesis';
    }
    if (expectedType === TOKEN_TYPES.RBRACE && actual === TOKEN_TYPES.EOF) {
        return 'Hint: Check for unclosed brace';
    }
    if (expectedType === TOKEN_TYPES.RBRACKET && actual === TOKEN_TYPES.EOF) {
        return 'Hint: Check for unclosed bracket';
    }
    // Hint for keyword typos
    if (actual === TOKEN_TYPES.IDENTIFIER) {
        const typoHints = {
            tru: 'true',
            fals: 'false',
            flase: 'false',
            ture: 'true',
            retrn: 'return',
            retrun: 'return',
            brek: 'break',
            braek: 'break',
            eahc: 'each',
            ech: 'each',
            fitler: 'filter',
            fliter: 'filter',
            fild: 'fold',
            mp: 'map',
        };
        const suggestion = typoHints[value.toLowerCase()];
        if (suggestion) {
            return `Hint: Did you mean '${suggestion}'?`;
        }
    }
    // Hint for missing arrow
    if (expectedType === TOKEN_TYPES.ARROW &&
        (actual === TOKEN_TYPES.IDENTIFIER || actual === TOKEN_TYPES.DOLLAR)) {
        return "Hint: Missing '->' before pipe target";
    }
    // Hint for using = instead of ->
    if (expectedType === TOKEN_TYPES.ARROW && actual === TOKEN_TYPES.ASSIGN) {
        return "Hint: Use '->' for assignment, not '='";
    }
    return null;
}
// ============================================================
// SPAN UTILITIES
// ============================================================
/** @internal */
export function makeSpan(start, end) {
    return { start, end };
}
//# sourceMappingURL=state.js.map