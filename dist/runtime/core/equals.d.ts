/**
 * AST Structural Equality
 *
 * Compares AST nodes for structural equality, ignoring source locations.
 * Used for closure equality: two closures with identical structure are equal.
 */
import type { ASTNode } from '../../types.js';
export declare function astEquals(a: ASTNode, b: ASTNode): boolean;
//# sourceMappingURL=equals.d.ts.map