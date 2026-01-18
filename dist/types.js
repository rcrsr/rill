/**
 * Rill AST Types
 * Based on docs/grammar.ebnf
 */
// ============================================================
// ERROR HIERARCHY
// ============================================================
/** Error codes for programmatic handling */
export const RILL_ERROR_CODES = {
    // Parse errors
    PARSE_UNEXPECTED_TOKEN: 'PARSE_UNEXPECTED_TOKEN',
    PARSE_INVALID_SYNTAX: 'PARSE_INVALID_SYNTAX',
    PARSE_INVALID_TYPE: 'PARSE_INVALID_TYPE',
    // Runtime errors
    RUNTIME_UNDEFINED_VARIABLE: 'RUNTIME_UNDEFINED_VARIABLE',
    RUNTIME_UNDEFINED_FUNCTION: 'RUNTIME_UNDEFINED_FUNCTION',
    RUNTIME_UNDEFINED_METHOD: 'RUNTIME_UNDEFINED_METHOD',
    RUNTIME_TYPE_ERROR: 'RUNTIME_TYPE_ERROR',
    RUNTIME_TIMEOUT: 'RUNTIME_TIMEOUT',
    RUNTIME_INVALID_PATTERN: 'RUNTIME_INVALID_PATTERN',
    RUNTIME_AUTO_EXCEPTION: 'RUNTIME_AUTO_EXCEPTION',
    RUNTIME_ABORTED: 'RUNTIME_ABORTED',
    RUNTIME_PROPERTY_NOT_FOUND: 'RUNTIME_PROPERTY_NOT_FOUND',
    RUNTIME_LIMIT_EXCEEDED: 'RUNTIME_LIMIT_EXCEEDED',
};
/**
 * Base error class for all Rill errors.
 * Provides structured data for host applications to format as needed.
 */
export class RillError extends Error {
    code;
    location;
    context;
    constructor(data) {
        const locationStr = data.location
            ? ` at ${data.location.line}:${data.location.column}`
            : '';
        super(`${data.message}${locationStr}`);
        this.name = 'RillError';
        this.code = data.code;
        this.location = data.location;
        this.context = data.context;
    }
    /** Get structured error data for custom formatting */
    toData() {
        return {
            code: this.code,
            message: this.message.replace(/ at \d+:\d+$/, ''), // Strip location suffix
            location: this.location,
            context: this.context,
        };
    }
    /** Format error for display (can be overridden by host) */
    format(formatter) {
        if (formatter)
            return formatter(this.toData());
        return this.message;
    }
}
/** Parse-time errors */
export class ParseError extends RillError {
    constructor(message, location, context) {
        super({
            code: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
            message,
            location,
            context,
        });
        this.name = 'ParseError';
    }
}
/** Runtime execution errors */
export class RuntimeError extends RillError {
    constructor(code, message, location, context) {
        super({ code, message, location, context });
        this.name = 'RuntimeError';
    }
    /** Create from an AST node */
    static fromNode(code, message, node, context) {
        return new RuntimeError(code, message, node?.span.start, context);
    }
}
/** Timeout errors */
export class TimeoutError extends RuntimeError {
    functionName;
    timeoutMs;
    constructor(functionName, timeoutMs, location) {
        super(RILL_ERROR_CODES.RUNTIME_TIMEOUT, `Function '${functionName}' timed out after ${timeoutMs}ms`, location, { functionName, timeoutMs });
        this.name = 'TimeoutError';
        this.functionName = functionName;
        this.timeoutMs = timeoutMs;
    }
}
/** Auto-exception errors (when $_ matches a pattern) */
export class AutoExceptionError extends RuntimeError {
    pattern;
    matchedValue;
    constructor(pattern, matchedValue, location) {
        super(RILL_ERROR_CODES.RUNTIME_AUTO_EXCEPTION, `Auto-exception triggered: pattern '${pattern}' matched`, location, { pattern, matchedValue });
        this.name = 'AutoExceptionError';
        this.pattern = pattern;
        this.matchedValue = matchedValue;
    }
}
/** Abort errors (when execution is cancelled via AbortSignal) */
export class AbortError extends RuntimeError {
    constructor(location) {
        super(RILL_ERROR_CODES.RUNTIME_ABORTED, 'Execution aborted', location, {});
        this.name = 'AbortError';
    }
}
// ============================================================
// TOKEN TYPES
// ============================================================
export const TOKEN_TYPES = {
    // Literals
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    TRUE: 'TRUE',
    FALSE: 'FALSE',
    // Identifiers
    IDENTIFIER: 'IDENTIFIER',
    // Variables
    DOLLAR: 'DOLLAR', // $
    PIPE_VAR: 'PIPE_VAR', // $ (lone dollar sign)
    // Operators
    ARROW: 'ARROW', // ->
    DOT: 'DOT', // .
    QUESTION: 'QUESTION', // ?
    AT: 'AT', // @
    CARET: 'CARET', // ^ (annotation prefix)
    COLON: 'COLON', // :
    COMMA: 'COMMA', // ,
    // Boolean operators
    BANG: 'BANG', // !
    AND: 'AND', // &&
    OR: 'OR', // ||
    // Null-coalescing and existence
    NULLISH_COALESCE: 'NULLISH_COALESCE', // ??
    DOT_QUESTION: 'DOT_QUESTION', // .?
    AMPERSAND: 'AMPERSAND', // &
    // Assignment
    ASSIGN: 'ASSIGN', // =
    // Comparison operators
    EQ: 'EQ', // ==
    NE: 'NE', // !=
    LT: 'LT', // <
    GT: 'GT', // >
    LE: 'LE', // <=
    GE: 'GE', // >=
    // Extraction operators
    STAR_LT: 'STAR_LT', // *< (destructure)
    SLASH_LT: 'SLASH_LT', // /< (slice)
    UNDERSCORE: 'UNDERSCORE', // _ (skip in destructure)
    // Arithmetic operators
    PIPE_BAR: 'PIPE_BAR', // |
    PLUS: 'PLUS', // +
    MINUS: 'MINUS', // -
    STAR: 'STAR', // *
    SLASH: 'SLASH', // /
    PERCENT: 'PERCENT', // %
    // Delimiters
    LPAREN: 'LPAREN', // (
    RPAREN: 'RPAREN', // )
    LBRACE: 'LBRACE', // {
    RBRACE: 'RBRACE', // }
    LBRACKET: 'LBRACKET', // [
    RBRACKET: 'RBRACKET', // ]
    // Keywords
    BREAK: 'BREAK',
    RETURN: 'RETURN',
    EACH: 'EACH',
    MAP: 'MAP',
    FOLD: 'FOLD',
    FILTER: 'FILTER',
    // Frontmatter
    FRONTMATTER_DELIM: 'FRONTMATTER_DELIM', // ---
    // Heredoc
    HEREDOC_START: 'HEREDOC_START', // <<DELIMITER
    HEREDOC_BODY: 'HEREDOC_BODY',
    HEREDOC_END: 'HEREDOC_END',
    // Special
    NEWLINE: 'NEWLINE',
    COMMENT: 'COMMENT',
    EOF: 'EOF',
};
//# sourceMappingURL=types.js.map