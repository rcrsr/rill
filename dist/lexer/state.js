/**
 * Lexer State
 * Tracks position in source text during tokenization
 */
export function createLexerState(source) {
    return {
        source,
        pos: 0,
        line: 1,
        column: 1,
    };
}
export function currentLocation(state) {
    return { line: state.line, column: state.column, offset: state.pos };
}
export function peek(state, offset = 0) {
    return state.source[state.pos + offset] ?? '';
}
export function peekString(state, length) {
    return state.source.slice(state.pos, state.pos + length);
}
export function advance(state) {
    const ch = state.source[state.pos] ?? '';
    state.pos++;
    if (ch === '\n') {
        state.line++;
        state.column = 1;
    }
    else {
        state.column++;
    }
    return ch;
}
export function isAtEnd(state) {
    return state.pos >= state.source.length;
}
//# sourceMappingURL=state.js.map