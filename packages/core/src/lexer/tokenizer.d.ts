/**
 * Tokenizer
 * Main tokenization logic
 */
import type { Token, SourceLocation } from '../types.js';
import { type LexerState } from './state.js';
export declare function nextToken(state: LexerState): Token;
export declare function tokenize(source: string, baseLocation?: SourceLocation): Token[];
//# sourceMappingURL=tokenizer.d.ts.map