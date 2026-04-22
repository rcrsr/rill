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
  | 'functionName'
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

    // Compound keywords
    ['LIST_LBRACKET', 'keyword'],
    ['DICT_LBRACKET', 'keyword'],
    ['TUPLE_LBRACKET', 'keyword'],
    ['ORDERED_LBRACKET', 'keyword'],
    ['DESTRUCT_LANGLE', 'keyword'],
    ['SLICE_LANGLE', 'keyword'],
    ['USE_LANGLE', 'keyword'],
    ['GUARD_LBRACE', 'keyword'],
    ['RETRY_LANGLE', 'keyword'],
    ['DO_LANGLE', 'keyword'],

    // Keywords
    ['BREAK', 'keyword'],
    ['RETURN', 'keyword'],
    ['YIELD', 'keyword'],
    ['PASS', 'keyword'],
    ['ASSERT', 'keyword'],
    ['ERROR', 'keyword'],
    ['GUARD', 'keyword'],
    ['RETRY', 'keyword'],
    ['WHILE', 'keyword'],
    ['DO', 'keyword'],

    // Atom literal: #NAME
    ['ATOM', 'meta'],

    // Variables
    ['DOLLAR', 'variableName'],
    ['PIPE_VAR', 'variableName'],
    ['IDENTIFIER', 'variableName'],
    ['UNDERSCORE', 'variableName'],

    // Method names (identifiers after dot)
    ['METHOD_NAME', 'functionName'],

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
    ['DOT_BANG', 'operator'],
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
