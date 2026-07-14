/**
 * Shared dict-entry key helpers: resolving a static display name and the
 * key's own span, used by both the document outline and scope resolution.
 */

import type { DictEntryNode, SourceSpan } from '@rcrsr/rill';

/**
 * Resolves a static display name for a dict entry key, or `null` when the
 * key has no static name (a computed expression or a list-literal key).
 */
export function dictKeyName(key: DictEntryNode['key']): string | null {
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);
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
