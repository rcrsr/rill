/**
 * Rill Lexer
 * Converts source text into tokens
 */
import { TOKEN_TYPES } from './types.js';
export function createLexerState(source) {
    return {
        source,
        pos: 0,
        line: 1,
        column: 1,
    };
}
// ============================================================
// LEXER ERRORS
// ============================================================
export class LexerError extends Error {
    location;
    constructor(message, location) {
        super(`${message} at line ${location.line}, column ${location.column}`);
        this.location = location;
        this.name = 'LexerError';
    }
}
// ============================================================
// HELPER FUNCTIONS
// ============================================================
function currentLocation(state) {
    return { line: state.line, column: state.column, offset: state.pos };
}
function peek(state, offset = 0) {
    return state.source[state.pos + offset] ?? '';
}
function peekString(state, length) {
    return state.source.slice(state.pos, state.pos + length);
}
function advance(state) {
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
function isAtEnd(state) {
    return state.pos >= state.source.length;
}
function isDigit(ch) {
    return ch >= '0' && ch <= '9';
}
function isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}
function isIdentifierStart(ch) {
    return isLetter(ch) || ch === '_';
}
function isIdentifierChar(ch) {
    return isIdentifierStart(ch) || isDigit(ch);
}
function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r';
}
function makeToken(type, value, start, end) {
    return { type, value, span: { start, end } };
}
/** Advance n times and return a token */
function advanceAndMakeToken(state, n, type, value, start) {
    for (let i = 0; i < n; i++)
        advance(state);
    return makeToken(type, value, start, currentLocation(state));
}
/** Two-character operator lookup table */
const TWO_CHAR_OPERATORS = {
    '->': TOKEN_TYPES.ARROW,
    ':<': TOKEN_TYPES.COLON_LT,
    '/<': TOKEN_TYPES.SLASH_LT,
    '&&': TOKEN_TYPES.AND,
    '||': TOKEN_TYPES.OR,
    '==': TOKEN_TYPES.EQ,
    '!=': TOKEN_TYPES.NE,
    '<=': TOKEN_TYPES.LE,
    '>=': TOKEN_TYPES.GE,
    '@(': TOKEN_TYPES.AT_PAREN,
};
/** Single-character operator lookup table */
const SINGLE_CHAR_OPERATORS = {
    '.': TOKEN_TYPES.DOT,
    '?': TOKEN_TYPES.QUESTION,
    '@': TOKEN_TYPES.AT,
    ':': TOKEN_TYPES.COLON,
    ',': TOKEN_TYPES.COMMA,
    '!': TOKEN_TYPES.BANG,
    '=': TOKEN_TYPES.ASSIGN,
    '<': TOKEN_TYPES.LT,
    '>': TOKEN_TYPES.GT,
    '(': TOKEN_TYPES.LPAREN,
    ')': TOKEN_TYPES.RPAREN,
    '{': TOKEN_TYPES.LBRACE,
    '}': TOKEN_TYPES.RBRACE,
    '[': TOKEN_TYPES.LBRACKET,
    ']': TOKEN_TYPES.RBRACKET,
    '|': TOKEN_TYPES.PIPE_BAR,
    '+': TOKEN_TYPES.PLUS,
    '-': TOKEN_TYPES.MINUS,
    '*': TOKEN_TYPES.STAR,
    '/': TOKEN_TYPES.SLASH,
    '%': TOKEN_TYPES.PERCENT,
    '~': TOKEN_TYPES.TILDE,
};
// ============================================================
// TOKENIZATION
// ============================================================
function skipWhitespace(state) {
    while (!isAtEnd(state) && isWhitespace(peek(state))) {
        advance(state);
    }
}
function skipComment(state) {
    if (peek(state) === '#') {
        while (!isAtEnd(state) && peek(state) !== '\n') {
            advance(state);
        }
    }
}
function readString(state) {
    const start = currentLocation(state);
    advance(state); // consume opening "
    let value = '';
    while (!isAtEnd(state) && peek(state) !== '"') {
        if (peek(state) === '\\') {
            advance(state);
            const escaped = advance(state);
            switch (escaped) {
                case 'n':
                    value += '\n';
                    break;
                case 'r':
                    value += '\r';
                    break;
                case 't':
                    value += '\t';
                    break;
                case '\\':
                    value += '\\';
                    break;
                case '{':
                    value += '{';
                    break;
                case '"':
                    value += '"';
                    break;
                default:
                    throw new LexerError(`Invalid escape sequence: \\${escaped}`, currentLocation(state));
            }
        }
        else if (peek(state) === '{') {
            // Interpolation: include {expr} literally, runtime handles substitution
            value += advance(state); // consume {
            let braceDepth = 1;
            while (!isAtEnd(state) && braceDepth > 0) {
                const ch = advance(state);
                value += ch;
                if (ch === '{')
                    braceDepth++;
                if (ch === '}')
                    braceDepth--;
            }
        }
        else if (peek(state) === '\n') {
            throw new LexerError('Unterminated string literal', start);
        }
        else {
            value += advance(state);
        }
    }
    if (peek(state) === '"') {
        advance(state); // consume closing "
    }
    return makeToken(TOKEN_TYPES.STRING, value, start, currentLocation(state));
}
function readHeredoc(state) {
    const start = currentLocation(state);
    advance(state); // consume first <
    advance(state); // consume second <
    // Read delimiter
    let delimiter = '';
    while (!isAtEnd(state) && isIdentifierChar(peek(state))) {
        delimiter += advance(state);
    }
    if (!delimiter) {
        throw new LexerError('Expected heredoc delimiter', currentLocation(state));
    }
    // Skip to newline
    while (!isAtEnd(state) && peek(state) !== '\n') {
        if (!isWhitespace(peek(state))) {
            throw new LexerError('Unexpected characters after heredoc delimiter', currentLocation(state));
        }
        advance(state);
    }
    if (peek(state) === '\n')
        advance(state);
    // Read body until delimiter appears alone on a line
    let body = '';
    while (!isAtEnd(state)) {
        // Check if current line starts with delimiter
        if (peekString(state, delimiter.length) === delimiter) {
            const afterDelim = peek(state, delimiter.length);
            if (afterDelim === '\n' || afterDelim === '' || afterDelim === '\r') {
                // Found end delimiter - advance past it
                Array.from({ length: delimiter.length }).forEach(() => advance(state));
                break;
            }
        }
        body += advance(state);
    }
    return makeToken(TOKEN_TYPES.STRING, body, start, currentLocation(state));
}
function readNumber(state) {
    const start = currentLocation(state);
    let value = '';
    while (!isAtEnd(state) && isDigit(peek(state))) {
        value += advance(state);
    }
    if (peek(state) === '.' && isDigit(peek(state, 1))) {
        value += advance(state); // consume .
        while (!isAtEnd(state) && isDigit(peek(state))) {
            value += advance(state);
        }
    }
    return makeToken(TOKEN_TYPES.NUMBER, value, start, currentLocation(state));
}
function readIdentifier(state) {
    const start = currentLocation(state);
    let value = '';
    while (!isAtEnd(state) && isIdentifierChar(peek(state))) {
        value += advance(state);
    }
    // Check for keywords
    let type = TOKEN_TYPES.IDENTIFIER;
    switch (value) {
        case 'true':
            type = TOKEN_TYPES.TRUE;
            break;
        case 'false':
            type = TOKEN_TYPES.FALSE;
            break;
        case 'break':
            type = TOKEN_TYPES.BREAK;
            break;
        case 'return':
            type = TOKEN_TYPES.RETURN;
            break;
    }
    // Check for max: (loop option)
    if (value === 'max' && peek(state) === ':') {
        advance(state);
        return makeToken(TOKEN_TYPES.MAX, 'max:', start, currentLocation(state));
    }
    return makeToken(type, value, start, currentLocation(state));
}
function readVariable(state) {
    const start = currentLocation(state);
    advance(state); // consume $
    // Check if followed by identifier (named variable like $foo)
    if (isIdentifierStart(peek(state))) {
        return makeToken(TOKEN_TYPES.DOLLAR, '$', start, currentLocation(state));
    }
    // Lone $ is the pipe variable (current item in iteration)
    return makeToken(TOKEN_TYPES.PIPE_VAR, '$', start, currentLocation(state));
}
export function nextToken(state) {
    skipWhitespace(state);
    skipComment(state);
    skipWhitespace(state);
    if (isAtEnd(state)) {
        const loc = currentLocation(state);
        return makeToken(TOKEN_TYPES.EOF, '', loc, loc);
    }
    const start = currentLocation(state);
    const ch = peek(state);
    // Newline
    if (ch === '\n') {
        advance(state);
        return makeToken(TOKEN_TYPES.NEWLINE, '\n', start, currentLocation(state));
    }
    // String
    if (ch === '"') {
        return readString(state);
    }
    // Heredoc
    if (ch === '<' && peek(state, 1) === '<') {
        return readHeredoc(state);
    }
    // Number (positive only - unary minus handled by parser)
    if (isDigit(ch)) {
        return readNumber(state);
    }
    // Identifier or keyword
    if (isIdentifierStart(ch)) {
        return readIdentifier(state);
    }
    // Variable
    if (ch === '$') {
        return readVariable(state);
    }
    // Three-character operators
    const threeChar = peekString(state, 3);
    if (threeChar === '@<>') {
        return advanceAndMakeToken(state, 3, TOKEN_TYPES.AT_LT_GT, '@<>', start);
    }
    if (threeChar === '---') {
        return advanceAndMakeToken(state, 3, TOKEN_TYPES.FRONTMATTER_DELIM, '---', start);
    }
    // Two-character operators (lookup table)
    const twoChar = peekString(state, 2);
    const twoCharType = TWO_CHAR_OPERATORS[twoChar];
    if (twoCharType) {
        return advanceAndMakeToken(state, 2, twoCharType, twoChar, start);
    }
    // Single-character operators (lookup table)
    const singleCharType = SINGLE_CHAR_OPERATORS[ch];
    if (singleCharType) {
        return advanceAndMakeToken(state, 1, singleCharType, ch, start);
    }
    throw new LexerError(`Unexpected character: ${ch}`, start);
}
// ============================================================
// TOKENIZE ALL
// ============================================================
export function tokenize(source) {
    const state = createLexerState(source);
    const tokens = [];
    let token;
    do {
        token = nextToken(state);
        tokens.push(token);
    } while (token.type !== TOKEN_TYPES.EOF);
    return tokens;
}
//# sourceMappingURL=lexer.js.map