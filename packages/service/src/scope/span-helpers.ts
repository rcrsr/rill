/**
 * Shared span-containment helper for scope providers.
 */

import type { SourceSpan } from '@rcrsr/rill';

/**
 * Returns true if `offset` falls within `span`, using the same half-open
 * containment convention as core's AST position lookups (`ast-walk.ts`'s
 * `spanContains`): `span.start.offset <= offset && offset < span.end.offset`.
 */
export function spanContainsOffset(span: SourceSpan, offset: number): boolean {
  return span.start.offset <= offset && offset < span.end.offset;
}
