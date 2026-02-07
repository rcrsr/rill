import type { TokenType } from './types.js';

// ============================================================
// HIGHLIGHT CATEGORIES
// ============================================================

export type HighlightCategory =
  | 'keyword'
  | 'operator'
  | 'string'
  | 'number'
  | 'bool'
  | 'comment'
  | 'variableName'
  | 'punctuation'
  | 'bracket'
  | 'meta';

// ============================================================
// TOKEN HIGHLIGHT MAP
// ============================================================

export const TOKEN_HIGHLIGHT_MAP: ReadonlyMap<TokenType, HighlightCategory> =
  new Map<TokenType, HighlightCategory>([
    // Literals
    ['STRING', 'string'],
    ['NUMBER', 'number'],
    ['TRUE', 'bool'],
    ['FALSE', 'bool'],

    // Comments
    ['COMMENT', 'comment'],

    // Keywords
    ['EACH', 'keyword'],
    ['MAP', 'keyword'],
    ['FOLD', 'keyword'],
    ['FILTER', 'keyword'],
    ['BREAK', 'keyword'],
    ['RETURN', 'keyword'],
    ['PASS', 'keyword'],
    ['ASSERT', 'keyword'],
    ['ERROR', 'keyword'],

    // Variables
    ['DOLLAR', 'variableName'],
    ['PIPE_VAR', 'variableName'],
    ['IDENTIFIER', 'variableName'],
    ['UNDERSCORE', 'variableName'],

    // Operators
    ['ARROW', 'operator'],
    ['CAPTURE_ARROW', 'operator'],
    ['ASSIGN', 'operator'],
    ['PLUS', 'operator'],
    ['MINUS', 'operator'],
    ['STAR', 'operator'],
    ['SLASH', 'operator'],
    ['PERCENT', 'operator'],
    ['PIPE_BAR', 'operator'],
    ['EQ', 'operator'],
    ['NE', 'operator'],
    ['LT', 'operator'],
    ['GT', 'operator'],
    ['LE', 'operator'],
    ['GE', 'operator'],
    ['AND', 'operator'],
    ['OR', 'operator'],
    ['BANG', 'operator'],
    ['NULLISH_COALESCE', 'operator'],
    ['DOT_QUESTION', 'operator'],
    ['STAR_LT', 'operator'],
    ['SLASH_LT', 'operator'],
    ['ELLIPSIS', 'operator'],
    ['AT', 'operator'],
    ['CARET', 'operator'],
    ['AMPERSAND', 'operator'],

    // Punctuation
    ['DOT', 'punctuation'],
    ['DOUBLE_COLON', 'punctuation'],
    ['COMMA', 'punctuation'],
    ['QUESTION', 'punctuation'],
    ['COLON', 'punctuation'],

    // Brackets
    ['LPAREN', 'bracket'],
    ['RPAREN', 'bracket'],
    ['LBRACE', 'bracket'],
    ['RBRACE', 'bracket'],
    ['LBRACKET', 'bracket'],
    ['RBRACKET', 'bracket'],

    // Meta
    ['FRONTMATTER_DELIM', 'meta'],

    // Intentionally unmapped: NEWLINE, EOF
  ]);
