/**
 * Shared scope-opening predicate. Lives at the package root so both the
 * `scope/` and `rules/` trees can import it without importing each other.
 */

import type { ASTNode } from '@rcrsr/rill';

/**
 * Determines whether `node` opens a new scope frame. Closures, grouped
 * expressions, string interpolations, and every block (including `pass`
 * bodies) do.
 */
export function opensScope(node: ASTNode): boolean {
  return (
    node.type === 'Closure' ||
    node.type === 'GroupedExpr' ||
    node.type === 'Interpolation' ||
    node.type === 'Block'
  );
}
