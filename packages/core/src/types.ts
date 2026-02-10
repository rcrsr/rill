/**
 * Rill AST Types
 * Based on docs/grammar.ebnf
 */

// Re-export all public symbols from sub-modules
export * from './source-location.js';
export * from './error-registry.js';
export * from './value-types.js';
export * from './token-types.js';
export * from './ast-nodes.js';
export * from './ast-unions.js';
export * from './error-classes.js';

// Cross-boundary definitions (reference both ast-nodes and error-classes types)
import type { ScriptNode } from './ast-nodes.js';
import type { ParseError } from './error-classes.js';

/**
 * Options for the parser.
 */
export interface ParseOptions {
  /**
   * Enable recovery mode for IDE/tooling scenarios.
   * When true, the parser attempts to recover from errors and
   * returns a partial AST with RecoveryErrorNode entries instead of throwing.
   * Default: false (throws on first error).
   */
  readonly recoveryMode?: boolean;
}

/**
 * Result of parsing with recovery mode enabled.
 * Contains the AST (which may include RecoveryErrorNode entries) and collected errors.
 */
export interface ParseResult {
  /** The parsed AST (may contain RecoveryErrorNode entries in statements) */
  readonly ast: ScriptNode;
  /** Parse errors collected during recovery (empty if no errors) */
  readonly errors: ParseError[];
  /** True if parsing completed without errors */
  readonly success: boolean;
}
