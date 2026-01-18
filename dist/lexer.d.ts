/**
 * Rill Lexer
 * Converts source text into tokens
 */
import type { SourceLocation, Token } from './types.js';
export interface LexerState {
    readonly source: string;
    pos: number;
    line: number;
    column: number;
}
export declare function createLexerState(source: string): LexerState;
export declare class LexerError extends Error {
    readonly location: SourceLocation;
    constructor(message: string, location: SourceLocation);
}
export declare function nextToken(state: LexerState): Token;
export declare function tokenize(source: string): Token[];
//# sourceMappingURL=lexer.d.ts.map