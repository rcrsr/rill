/**
 * Lexer State
 * Tracks position in source text during tokenization
 */
import type { SourceLocation } from '../types.js';
export interface LexerState {
    readonly source: string;
    pos: number;
    line: number;
    column: number;
    baseOffset: number;
    inFrontmatter: boolean;
}
export declare function createLexerState(source: string, baseLocation?: SourceLocation): LexerState;
export declare function currentLocation(state: LexerState): SourceLocation;
export declare function peek(state: LexerState, offset?: number): string;
export declare function peekString(state: LexerState, length: number): string;
export declare function advance(state: LexerState): string;
export declare function isAtEnd(state: LexerState): boolean;
//# sourceMappingURL=state.d.ts.map