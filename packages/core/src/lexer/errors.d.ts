/**
 * Lexer Errors
 */
import { RillError } from '../types.js';
import type { SourceLocation } from '../types.js';
export declare class LexerError extends RillError {
    readonly location: SourceLocation;
    constructor(errorId: string, message: string, location: SourceLocation, context?: Record<string, unknown>);
}
//# sourceMappingURL=errors.d.ts.map