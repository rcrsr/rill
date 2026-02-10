import type { SourceSpan } from './source-location.js';

// ============================================================
// TOKEN TYPES
// ============================================================

export const TOKEN_TYPES = {
  // Literals
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  TRUE: 'TRUE',
  FALSE: 'FALSE',

  // Identifiers
  IDENTIFIER: 'IDENTIFIER',

  // Variables
  DOLLAR: 'DOLLAR', // $
  PIPE_VAR: 'PIPE_VAR', // $ (lone dollar sign)

  // Operators
  ARROW: 'ARROW', // ->
  CAPTURE_ARROW: 'CAPTURE_ARROW', // =>
  DOT: 'DOT', // .
  QUESTION: 'QUESTION', // ?
  AT: 'AT', // @
  CARET: 'CARET', // ^ (annotation prefix)
  COLON: 'COLON', // :
  DOUBLE_COLON: 'DOUBLE_COLON', // :: (namespace separator)
  COMMA: 'COMMA', // ,

  // Boolean operators
  BANG: 'BANG', // !
  AND: 'AND', // &&
  OR: 'OR', // ||

  // Null-coalescing and existence
  NULLISH_COALESCE: 'NULLISH_COALESCE', // ??
  DOT_QUESTION: 'DOT_QUESTION', // .?
  AMPERSAND: 'AMPERSAND', // &

  // Assignment
  ASSIGN: 'ASSIGN', // =

  // Comparison operators
  EQ: 'EQ', // ==
  NE: 'NE', // !=
  LT: 'LT', // <
  GT: 'GT', // >
  LE: 'LE', // <=
  GE: 'GE', // >=

  // Extraction operators
  STAR_LT: 'STAR_LT', // *< (destructure)
  SLASH_LT: 'SLASH_LT', // /< (slice)
  UNDERSCORE: 'UNDERSCORE', // _ (skip in destructure)

  // Spread operator
  ELLIPSIS: 'ELLIPSIS', // ... (list spread)

  // Arithmetic operators
  PIPE_BAR: 'PIPE_BAR', // |
  PLUS: 'PLUS', // +
  MINUS: 'MINUS', // -
  STAR: 'STAR', // *
  SLASH: 'SLASH', // /
  PERCENT: 'PERCENT', // %

  // Delimiters
  LPAREN: 'LPAREN', // (
  RPAREN: 'RPAREN', // )
  LBRACE: 'LBRACE', // {
  RBRACE: 'RBRACE', // }
  LBRACKET: 'LBRACKET', // [
  RBRACKET: 'RBRACKET', // ]

  // Keywords
  BREAK: 'BREAK',
  RETURN: 'RETURN',
  PASS: 'PASS',
  ASSERT: 'ASSERT',
  ERROR: 'ERROR',
  EACH: 'EACH',
  MAP: 'MAP',
  FOLD: 'FOLD',
  FILTER: 'FILTER',

  // Frontmatter
  FRONTMATTER_DELIM: 'FRONTMATTER_DELIM', // ---

  // Special
  NEWLINE: 'NEWLINE',
  COMMENT: 'COMMENT',
  EOF: 'EOF',
} as const;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly span: SourceSpan;
}
