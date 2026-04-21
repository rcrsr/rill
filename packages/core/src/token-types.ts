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
  METHOD_NAME: 'METHOD_NAME', // foo in $x.foo

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
  DOT_BANG: 'DOT_BANG', // .! (status probe)
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

  // Compound keywords (keyword + bracket fused into one token)
  LIST_LBRACKET: 'LIST_LBRACKET', // list[
  DICT_LBRACKET: 'DICT_LBRACKET', // dict[
  TUPLE_LBRACKET: 'TUPLE_LBRACKET', // tuple[
  ORDERED_LBRACKET: 'ORDERED_LBRACKET', // ordered[
  DESTRUCT_LANGLE: 'DESTRUCT_LANGLE', // destruct<
  SLICE_LANGLE: 'SLICE_LANGLE', // slice<
  USE_LANGLE: 'USE_LANGLE', // use<
  GUARD_LBRACE: 'GUARD_LBRACE', // guard{
  RETRY_LANGLE: 'RETRY_LANGLE', // retry<

  // Keywords
  BREAK: 'BREAK',
  RETURN: 'RETURN',
  YIELD: 'YIELD',
  PASS: 'PASS',
  ASSERT: 'ASSERT',
  ERROR: 'ERROR',
  EACH: 'EACH',
  MAP: 'MAP',
  FOLD: 'FOLD',
  FILTER: 'FILTER',
  GUARD: 'GUARD',
  RETRY: 'RETRY',

  // Atom literal: #NAME
  ATOM: 'ATOM',

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
