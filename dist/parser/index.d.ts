/**
 * Rill Parser
 * Main entry point and re-exports
 */
import type { ParseResult, ScriptNode } from '../types.js';
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
export declare function parse(source: string): ScriptNode;
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
export declare function parseWithRecovery(source: string): ParseResult;
export { createParserState, type ParserState } from './state.js';
export { Parser } from './parser.js';
//# sourceMappingURL=index.d.ts.map