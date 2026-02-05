/**
 * Lexer Helper Functions
 * Character classification and token construction
 */
import { advance, currentLocation } from './state.js';
export function isDigit(ch) {
    return ch >= '0' && ch <= '9';
}
function isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}
export function isIdentifierStart(ch) {
    return isLetter(ch) || ch === '_';
}
export function isIdentifierChar(ch) {
    return isIdentifierStart(ch) || isDigit(ch);
}
export function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r';
}
export function makeToken(type, value, start, end) {
    return { type, value, span: { start, end } };
}
/** Advance n times and return a token */
export function advanceAndMakeToken(state, n, type, value, start) {
    for (let i = 0; i < n; i++)
        advance(state);
    return makeToken(type, value, start, currentLocation(state));
}
//# sourceMappingURL=helpers.js.map