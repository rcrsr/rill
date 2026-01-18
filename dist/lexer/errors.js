/**
 * Lexer Errors
 */
export class LexerError extends Error {
    location;
    constructor(message, location) {
        super(`${message} at line ${location.line}, column ${location.column}`);
        this.location = location;
        this.name = 'LexerError';
    }
}
//# sourceMappingURL=errors.js.map