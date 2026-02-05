/**
 * Lexer Errors
 */
import { RillError, ERROR_REGISTRY } from '../types.js';
export class LexerError extends RillError {
    // Override to make location required (lexer errors always have location)
    location;
    constructor(errorId, message, location, context) {
        // Look up error definition from registry
        const definition = ERROR_REGISTRY.get(errorId);
        // EC-5: Unknown errorId throws TypeError
        if (!definition) {
            throw new TypeError(`Unknown error ID: ${errorId}`);
        }
        // EC-6: Wrong category throws TypeError
        if (definition.category !== 'lexer') {
            throw new TypeError(`Expected lexer error ID, got: ${errorId}`);
        }
        // Call RillError constructor with structured data
        super({
            errorId,
            message,
            location,
            context,
        });
        this.name = 'LexerError';
        this.location = location;
    }
}
//# sourceMappingURL=errors.js.map