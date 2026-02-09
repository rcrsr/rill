/**
 * Lexer Module
 * Converts source text into tokens
 */

export { LexerError } from './errors.js';
export { createLexerState, type LexerState } from './state.js';
export { nextToken, tokenize, type TokenizeOptions } from './tokenizer.js';
