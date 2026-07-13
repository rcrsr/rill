/**
 * Completions: in-scope bindings merged with built-in functions, built-in
 * methods, and reserved keywords.
 */

import { BUILTIN_FUNCTIONS, BUILTIN_METHODS, KEYWORDS } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';

import { resolveScopeAt } from './resolve-scope.js';
import type { Binding, CompletionItem } from './types.js';

/**
 * Resolves the completion items available at 0-based `offset`.
 *
 * Merges three sources, in this order: variable bindings visible at
 * `offset` (via `resolveScopeAt`), built-in functions and methods, and
 * reserved keywords. Built-in and keyword completions are always present,
 * even on an empty document with no bindings. Recovery regions simply
 * contribute whatever bindings survive parsing; this function never
 * throws.
 */
export function getCompletions(
  parsed: ParseResult,
  offset: number
): CompletionItem[] {
  const bindingItems = resolveScopeAt(parsed, offset).map(
    bindingToCompletionItem
  );
  return [
    ...bindingItems,
    ...getBuiltinFunctionCompletions(),
    ...getBuiltinMethodCompletions(),
    ...getKeywordCompletions(),
  ];
}

function bindingToCompletionItem(binding: Binding): CompletionItem {
  return { label: binding.name, kind: 'variable' };
}

function getBuiltinFunctionCompletions(): CompletionItem[] {
  return BUILTIN_FUNCTIONS.map((name) => ({
    label: name,
    kind: 'function',
    detail: `built-in function \`${name}\``,
  }));
}

/**
 * Built-in methods are bucketed by receiver type (string, list, dict, ...).
 * The same method name may exist in more than one bucket, so this dedupes
 * by name, keeping the first bucket's description.
 */
function getBuiltinMethodCompletions(): CompletionItem[] {
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const bucket of Object.values(BUILTIN_METHODS)) {
    for (const [name, method] of Object.entries(bucket)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const description = method.annotations?.['description'];
      items.push({
        label: name,
        kind: 'function',
        detail:
          typeof description === 'string'
            ? description
            : `built-in method \`.${name}\``,
      });
    }
  }
  return items;
}

function getKeywordCompletions(): CompletionItem[] {
  return KEYWORDS.map((word) => ({
    label: word,
    kind: 'keyword',
    detail: `keyword \`${word}\``,
  }));
}
