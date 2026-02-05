/**
 * Lexer Helper Functions
 * Character classification and token construction
 */
import type { SourceLocation, Token, TokenType } from '../types.js';
import { type LexerState } from './state.js';
export declare function isDigit(ch: string): boolean;
export declare function isIdentifierStart(ch: string): boolean;
export declare function isIdentifierChar(ch: string): boolean;
export declare function isWhitespace(ch: string): boolean;
export declare function makeToken(type: TokenType, value: string, start: SourceLocation, end: SourceLocation): Token;
/** Advance n times and return a token */
export declare function advanceAndMakeToken(state: LexerState, n: number, type: TokenType, value: string, start: SourceLocation): Token;
//# sourceMappingURL=helpers.d.ts.map