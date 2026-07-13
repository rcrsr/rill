/**
 * Go-to-definition: the binding-site span for the identifier at a source
 * offset.
 */

import type { ParseResult, SourceSpan } from '@rcrsr/rill';

import { locateTarget } from './locate-target.js';
import { resolveScopeAt } from './resolve-scope.js';

/**
 * Resolves the binding-introducing span for the identifier at 0-based
 * `offset`, or `null` when nothing resolves.
 *
 * On a `.field`/`[0]` access-chain segment, the field itself carries no
 * separate declaration anywhere in source (dict shapes are structural, not
 * declared), so this returns the segment's own span rather than either the
 * whole access chain or the base variable's binding site -- distinguishing
 * this from a resolver that folds the whole chain into one span.
 *
 * Returns `null` for built-in functions/methods and reserved keywords (no
 * source-level binding site exists for them), and for any variable that
 * does not resolve to a binding visible at `offset`.
 *
 * Tolerates recovery regions: `RecoveryErrorNode`/`PartialExpressionNode`
 * simply do not match any locatable shape, so this never throws.
 */
export function findDefinition(
  parsed: ParseResult,
  offset: number
): SourceSpan | null {
  const target = locateTarget(parsed, offset);

  switch (target.kind) {
    case 'accessSegment':
      return target.span;
    case 'variableName':
    case 'closureCall':
      return findBindingSite(parsed, offset, target.name);
    case 'hostCall':
    case 'methodCall':
    case 'keyword':
    case 'boolLiteral':
    case 'none':
      return null;
  }
}

function findBindingSite(
  parsed: ParseResult,
  offset: number,
  name: string
): SourceSpan | null {
  const bindings = resolveScopeAt(parsed, offset);
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i]!;
    if (binding.name === name) return binding.bindingSite;
  }
  return null;
}
