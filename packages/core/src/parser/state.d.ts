/**
 * Parser State
 * Core state management and token navigation utilities
 */
import type { SourceLocation, SourceSpan, Token } from '../types.js';
import { ParseError } from '../types.js';
export interface ParserState {
    readonly tokens: Token[];
    pos: number;
    /** Recovery mode: collect errors instead of throwing */
    readonly recoveryMode: boolean;
    /** Errors collected during recovery mode parsing */
    readonly errors: ParseError[];
    /** Original source text (for error recovery) */
    readonly source: string;
}
export interface ParserStateOptions {
    /** Enable recovery mode for IDE/tooling scenarios */
    recoveryMode?: boolean;
    /** Original source text (required for recovery mode) */
    source?: string;
}
export declare function createParserState(tokens: Token[], options?: ParserStateOptions): ParserState;
/** @internal */
export declare function current(state: ParserState): Token;
/** @internal */
export declare function peek(state: ParserState, offset?: number): Token;
/** @internal */
export declare function isAtEnd(state: ParserState): boolean;
/** @internal */
export declare function check(state: ParserState, ...types: string[]): boolean;
/** @internal */
export declare function advance(state: ParserState): Token;
/** @internal */
export declare function expect(state: ParserState, type: string, message: string): Token;
/** @internal */
export declare function skipNewlines(state: ParserState): void;
/** @internal */
export declare function makeSpan(start: SourceLocation, end: SourceLocation): SourceSpan;
//# sourceMappingURL=state.d.ts.map