/**
 * Token Readers
 * Functions to read specific token types from source
 */
import { TOKEN_TYPES } from '../types.js';
import { LexerError } from './errors.js';
import { isDigit, isIdentifierChar, isIdentifierStart, isWhitespace, makeToken, } from './helpers.js';
import { advance, currentLocation, isAtEnd, peek, peekString, } from './state.js';
/** Process escape sequence and return the unescaped character */
function processEscape(state) {
    const escaped = advance(state);
    switch (escaped) {
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        case '\\':
            return '\\';
        case '"':
            return '"';
        default:
            throw new LexerError(`Invalid escape sequence: \\${escaped}`, currentLocation(state));
    }
}
export function readString(state) {
    const start = currentLocation(state);
    advance(state); // consume opening "
    let value = '';
    while (!isAtEnd(state) && peek(state) !== '"') {
        if (peek(state) === '\\') {
            advance(state); // consume backslash
            value += processEscape(state);
        }
        else if (peek(state) === '{') {
            // Interpolation: include {expr} literally, parser handles expression parsing
            value += advance(state); // consume {
            let braceDepth = 1;
            while (!isAtEnd(state) && braceDepth > 0) {
                if (peek(state) === '\\') {
                    advance(state); // consume backslash
                    value += processEscape(state);
                }
                else {
                    const ch = advance(state);
                    value += ch;
                    if (ch === '{')
                        braceDepth++;
                    if (ch === '}')
                        braceDepth--;
                }
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
export function readHeredoc(state) {
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
                for (let i = 0; i < delimiter.length; i++)
                    advance(state);
                break;
            }
        }
        body += advance(state);
    }
    return makeToken(TOKEN_TYPES.STRING, body, start, currentLocation(state));
}
export function readNumber(state) {
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
export function readIdentifier(state) {
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
        case 'each':
            type = TOKEN_TYPES.EACH;
            break;
        case 'map':
            type = TOKEN_TYPES.MAP;
            break;
        case 'fold':
            type = TOKEN_TYPES.FOLD;
            break;
        case 'filter':
            type = TOKEN_TYPES.FILTER;
            break;
    }
    return makeToken(type, value, start, currentLocation(state));
}
export function readVariable(state) {
    const start = currentLocation(state);
    advance(state); // consume $
    // Check for accumulator variable: $@
    if (peek(state) === '@') {
        advance(state); // consume @
        return makeToken(TOKEN_TYPES.DOLLAR, '$@', start, currentLocation(state));
    }
    // Check if followed by identifier (named variable like $foo)
    if (isIdentifierStart(peek(state))) {
        return makeToken(TOKEN_TYPES.DOLLAR, '$', start, currentLocation(state));
    }
    // Lone $ is the pipe variable (current item in iteration)
    return makeToken(TOKEN_TYPES.PIPE_VAR, '$', start, currentLocation(state));
}
//# sourceMappingURL=readers.js.map