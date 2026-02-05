/**
 * Rill Parser
 * Main entry point and re-exports
 */
import { tokenize } from '../lexer/index.js';
import { ParseError } from '../types.js';
import { Parser } from './parser.js';
// Import extension modules to register prototype methods on Parser.
// These must be imported AFTER parser.js to ensure the class is defined.
import './parser-script.js';
import './parser-expr.js';
import './parser-literals.js';
import './parser-variables.js';
import './parser-control.js';
import './parser-functions.js';
import './parser-collect.js';
import './parser-extract.js';
// ============================================================
// MAIN ENTRY POINT
// ============================================================
/**
 * Parse rill source code into an AST.
 *
 * Throws ParseError on first syntax error.
 *
 * @param source - The source code to parse
 * @returns The parsed AST (ScriptNode)
 *
 * @example
 * ```typescript
 * const ast = parse(source);
 * ```
 */
export function parse(source) {
    const tokens = tokenize(source);
    const parser = new Parser(tokens, { recoveryMode: false, source });
    return parser.parse();
}
/**
 * Parse rill source code with error recovery for IDE/tooling scenarios.
 *
 * Instead of throwing on first error, collects errors and returns
 * a partial AST with ErrorNode entries where parsing failed.
 *
 * @param source - The source code to parse
 * @returns ParseResult with AST, errors array, and success flag
 *
 * @example
 * ```typescript
 * const result = parseWithRecovery(source);
 * if (!result.success) {
 *   console.log('Errors:', result.errors);
 * }
 * // AST may contain ErrorNode entries in statements
 * ```
 */
export function parseWithRecovery(source) {
    // Try tokenization, converting LexerError to ParseError if needed
    let tokens;
    try {
        tokens = tokenize(source);
    }
    catch (err) {
        // Handle lexer errors by converting to ParseError and returning empty AST
        if (err instanceof Error && err.name === 'LexerError') {
            const lexerErr = err;
            const location = lexerErr.location ?? {
                line: 1,
                column: 1,
                offset: 0,
            };
            const parseError = new ParseError('RILL-P001', err.message.replace(/ at line \d+, column \d+$/, ''), location);
            // Return minimal AST with single error
            const emptyScript = {
                type: 'Script',
                frontmatter: null,
                statements: [],
                span: {
                    start: { line: 1, column: 1, offset: 0 },
                    end: { line: 1, column: 1, offset: 0 },
                },
            };
            return {
                ast: emptyScript,
                errors: [parseError],
                success: false,
            };
        }
        throw err; // Re-throw unexpected errors
    }
    const parser = new Parser(tokens, { recoveryMode: true, source });
    const ast = parser.parse();
    return {
        ast,
        errors: parser.errors,
        success: parser.errors.length === 0,
    };
}
// ============================================================
// RE-EXPORTS
// ============================================================
// State (for advanced usage)
export { createParserState } from './state.js';
// Parser class (for advanced usage)
export { Parser } from './parser.js';
//# sourceMappingURL=index.js.map