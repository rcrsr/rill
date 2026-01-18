/**
 * Parser Class - Core
 *
 * Defines the Parser class structure. Methods are added via prototype
 * extension from separate modules, using TypeScript declaration merging
 * for type safety.
 *
 * This architecture eliminates circular dependencies while keeping
 * the codebase modular and organized by concern.
 */

import type { ScriptNode, Token } from '../types.js';
import { ParseError } from '../types.js';
import { type ParserState, createParserState } from './state.js';

/**
 * Parser class that converts tokens into an AST.
 *
 * Methods are organized across multiple files:
 * - parser-script.ts: Script, statement, annotation parsing
 * - parser-expr.ts: Expressions, precedence chain, pipe targets
 * - parser-literals.ts: Literals, strings, tuples, dicts, closures
 * - parser-variables.ts: Variables, access chains
 * - parser-control.ts: Conditionals, loops, blocks
 * - parser-functions.ts: Function calls, methods, type operations
 * - parser-collect.ts: Collection operators (each, map, fold, filter)
 * - parser-extract.ts: Extraction operators (destructure, slice, spread)
 *
 * @example
 * ```typescript
 * const parser = new Parser(tokens, { recoveryMode: false });
 * const ast = parser.parse();
 * ```
 */
export class Parser {
  /** Parser state including tokens, position, and error collection */
  state: ParserState;

  constructor(
    tokens: Token[],
    options?: { recoveryMode?: boolean; source?: string }
  ) {
    this.state = createParserState(tokens, {
      recoveryMode: options?.recoveryMode ?? false,
      source: options?.source ?? '',
    });
  }

  /**
   * Parse tokens into a complete AST.
   */
  parse(): ScriptNode {
    return this.parseScript();
  }

  /**
   * Get collected errors (for recovery mode).
   */
  get errors(): ParseError[] {
    return this.state.errors;
  }
}
