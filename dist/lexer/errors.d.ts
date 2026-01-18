/**
 * Lexer Errors
 */
import type { SourceLocation } from '../types.js';
export declare class LexerError extends Error {
    readonly location: SourceLocation;
    constructor(message: string, location: SourceLocation);
}
//# sourceMappingURL=errors.d.ts.map