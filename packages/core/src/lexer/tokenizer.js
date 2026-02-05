/**
 * Tokenizer
 * Main tokenization logic
 */
import { TOKEN_TYPES } from '../types.js';
import { LexerError } from './errors.js';
import { advanceAndMakeToken, isDigit, isIdentifierStart, isWhitespace, makeToken, } from './helpers.js';
import { SINGLE_CHAR_OPERATORS, TWO_CHAR_OPERATORS } from './operators.js';
import { readIdentifier, readNumber, readString, readTripleQuoteString, readVariable, } from './readers.js';
import { advance, createLexerState, currentLocation, isAtEnd, peek, peekString, } from './state.js';
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
    // Frontmatter content: scan raw lines until closing ---
    if (state.inFrontmatter) {
        if (ch === '\n') {
            advance(state);
            // Check if next line starts with ---
            if (peekString(state, 3) === '---') {
                state.inFrontmatter = false;
            }
            return makeToken(TOKEN_TYPES.NEWLINE, '\n', start, currentLocation(state));
        }
        // Consume entire line as an identifier token
        let value = '';
        while (!isAtEnd(state) && peek(state) !== '\n') {
            value += peek(state);
            advance(state);
        }
        return makeToken(TOKEN_TYPES.IDENTIFIER, value, start, currentLocation(state));
    }
    // Newline
    if (ch === '\n') {
        advance(state);
        return makeToken(TOKEN_TYPES.NEWLINE, '\n', start, currentLocation(state));
    }
    // String (triple-quote checked before single-quote)
    if (ch === '"') {
        if (peekString(state, 3) === '"""') {
            return readTripleQuoteString(state);
        }
        return readString(state);
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
    if (threeChar === '...') {
        return advanceAndMakeToken(state, 3, TOKEN_TYPES.ELLIPSIS, '...', start);
    }
    if (threeChar === '---') {
        const token = advanceAndMakeToken(state, 3, TOKEN_TYPES.FRONTMATTER_DELIM, '---', start);
        // Only set frontmatter mode if at actual file start (not in sub-parse)
        if (state.pos === 3 && state.baseOffset === 0) {
            state.inFrontmatter = true;
        }
        return token;
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
    throw new LexerError('RILL-L002', `Unexpected character: ${ch}`, start);
}
export function tokenize(source, baseLocation) {
    const state = createLexerState(source, baseLocation);
    const tokens = [];
    let token;
    do {
        token = nextToken(state);
        tokens.push(token);
    } while (token.type !== TOKEN_TYPES.EOF);
    return tokens;
}
//# sourceMappingURL=tokenizer.js.map