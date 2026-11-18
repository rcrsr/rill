/**
 * Shared dict-entry key helpers: resolving a static display name and the
 * key's own span, used by both the document outline and scope resolution.
 */

import { formatRillLiteral } from '@rcrsr/rill';
import type { DictEntryNode, SourceSpan } from '@rcrsr/rill';

/**
 * Resolves a static display name for a dict entry key, or `null` when the
 * key has no static name (a computed expression or a list-literal key).
 */
export function dictKeyName(key: DictEntryNode['key']): string | null {
  if (typeof key === 'string') return key;
  if (typeof key === 'object' && 'kind' in key) {
    return key.kind === 'variable' ? key.variableName : null;
  }
  return null;
}

/** Resolves the key's own span when it carries one (`$var` / computed keys). */
export function dictKeySpan(key: DictEntryNode['key']): SourceSpan | undefined {
  if (typeof key === 'object' && 'kind' in key) return key.span;
  return undefined;
}

const BARE_FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Renders a dict or ordered field key: bare only when it is an identifier
 * other than `true`/`false`, otherwise a quoted rill string literal.
 * Keep in sync with core's internal `formatFieldKey` in
 * `runtime/core/types/format-string.ts`, which is not exported.
 */
export function formatFieldKey(key: string): string {
  if (BARE_FIELD_KEY.test(key) && key !== 'true' && key !== 'false') {
    return key;
  }
  return formatRillLiteral(key);
}
