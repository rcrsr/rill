/**
 * Token Readers
 * Functions to read specific token types from source
 */
import type { Token } from '../types.js';
import { type LexerState } from './state.js';
export declare function readString(state: LexerState): Token;
export declare function readHeredoc(state: LexerState): Token;
export declare function readNumber(state: LexerState): Token;
export declare function readIdentifier(state: LexerState): Token;
export declare function readVariable(state: LexerState): Token;
//# sourceMappingURL=readers.d.ts.map