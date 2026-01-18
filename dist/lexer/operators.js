/**
 * Operator Lookup Tables
 */
import { TOKEN_TYPES } from '../types.js';
/** Two-character operator lookup table */
export const TWO_CHAR_OPERATORS = {
    '->': TOKEN_TYPES.ARROW,
    '*<': TOKEN_TYPES.STAR_LT,
    '/<': TOKEN_TYPES.SLASH_LT,
    '&&': TOKEN_TYPES.AND,
    '||': TOKEN_TYPES.OR,
    '==': TOKEN_TYPES.EQ,
    '!=': TOKEN_TYPES.NE,
    '<=': TOKEN_TYPES.LE,
    '>=': TOKEN_TYPES.GE,
    '??': TOKEN_TYPES.NULLISH_COALESCE,
    '.?': TOKEN_TYPES.DOT_QUESTION,
};
/** Single-character operator lookup table */
export const SINGLE_CHAR_OPERATORS = {
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
    '&': TOKEN_TYPES.AMPERSAND,
    '^': TOKEN_TYPES.CARET,
};
//# sourceMappingURL=operators.js.map