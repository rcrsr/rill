/**
 * AST Structural Equality
 *
 * Compares AST nodes for structural equality, ignoring source locations.
 * Used for closure equality: two closures with identical structure are equal.
 */
import type { ASTNode } from '../types.js';
/**
 * Compare two AST nodes for structural equality.
 * Ignores source locations (span) - only compares structure and values.
 */
export declare function astEquals(a: ASTNode, b: ASTNode): boolean;
//# sourceMappingURL=ast-equals.d.ts.map