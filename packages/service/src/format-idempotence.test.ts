/**
 * Full-corpus formatting-idempotence verification.
 *
 * `format-document.test.ts` (co-located with `formatDocument`) proves
 * idempotence on a small, purpose-built set of well-formed and malformed
 * inputs. This module extends that proof to every statically-extractable
 * rill snippet in the protected `packages/core/tests/language/` corpus,
 * reusing the shared loader from `rules/corpus-loader.ts` so the exercised
 * snippet set matches the one already used by the diagnostic-parity tests.
 *
 * `parseWithRecovery` is used (rather than `parse`) so malformed corpus
 * snippets — which do occur in the language corpus, e.g. error-recovery
 * fixtures — are exercised through the same recovery/passthrough path
 * `formatDocument` documents, not skipped.
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { loadCorpusSnippets } from './rules/corpus-loader.js';
import { formatDocument } from './format-document.js';

describe('formatDocument idempotence over the full language corpus', () => {
  const snippets = loadCorpusSnippets();

  it('loads a non-empty corpus snippet set', () => {
    // Guards against a silently-empty glob making the idempotence check
    // below pass vacuously.
    expect(snippets.length).toBeGreaterThan(0);
  });

  it.each(snippets.map((snippet, index) => ({ ...snippet, index })))(
    'formats snippet #$index from $file idempotently: format(format(x)) === format(x)',
    ({ source }) => {
      const parsed = parseWithRecovery(source);
      const firstEdits = formatDocument(parsed, source);
      expect(firstEdits).toHaveLength(1);
      const once = firstEdits[0]?.newText ?? '';

      const reparsed = parseWithRecovery(once);
      const secondEdits = formatDocument(reparsed, once);
      expect(secondEdits).toHaveLength(1);
      const twice = secondEdits[0]?.newText ?? '';

      expect(twice).toBe(once);
    }
  );
});
