/**
 * Runtime Tests: ErrorRegistryImpl category self-check
 *
 * Covers:
 * - Constructing the registry with a definition whose category disagrees
 *   with its published ID letter throws at construction time.
 * - Every shipped definition's category agrees with its ID letter
 *   (RILL-{letter}###: L=lexer, P=parse, R=runtime, C=check).
 *
 * `ErrorRegistryImpl` is imported by path here because the top-level
 * barrel exports only the `ErrorRegistry` interface and the singleton
 * `ERROR_REGISTRY`, not the implementation class used to construct
 * fixtures for this check.
 */

import { describe, expect, it } from 'vitest';
import { ERROR_REGISTRY, type ErrorDefinition } from '@rcrsr/rill';
import { ErrorRegistryImpl } from '../../src/error-registry.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../src/error-registry.js';

function makeDefinition(
  overrides: Partial<ErrorDefinition> = {}
): ErrorDefinition {
  return {
    errorId: 'RILL-R999',
    category: 'runtime',
    description: 'fixture definition',
    messageTemplate: 'fixture message',
    cause: 'fixture cause',
    resolution: 'fixture resolution',
    examples: [],
    ...overrides,
  };
}

describe('ErrorRegistryImpl category self-check', () => {
  it('throws when a definition declares category "parse" but its ID letter is R', () => {
    const mismatched = makeDefinition({
      errorId: 'RILL-R999',
      category: 'parse',
    });

    expect(() => new ErrorRegistryImpl([mismatched])).toThrow(
      /RILL-R999.*category 'parse'.*letter 'R'.*implies 'runtime'/
    );
  });

  it('throws when a definition declares category "runtime" but its ID letter is P', () => {
    const mismatched = makeDefinition({
      errorId: 'RILL-P999',
      category: 'runtime',
    });

    expect(() => new ErrorRegistryImpl([mismatched])).toThrow(
      /RILL-P999.*category 'runtime'.*letter 'P'.*implies 'parse'/
    );
  });

  it('does not throw the category-mismatch error when category matches the ID letter', () => {
    // A single-definition registry still fails the separate ERROR_IDS
    // completeness check, so assert on the mismatch guard specifically:
    // a matched category never appears in that error's message.
    const matched = makeDefinition({
      errorId: 'RILL-R999',
      category: 'runtime',
    });

    expect(() => new ErrorRegistryImpl([matched])).not.toThrow(
      /declares category/
    );
  });

  it('RILL-R085 is registered with category runtime and a derived RILL_R085 atom', () => {
    const definition = ERROR_REGISTRY.get(ERROR_IDS.RILL_R085);

    expect(definition).toBeDefined();
    expect(definition?.category).toBe('runtime');
    expect(ERROR_ATOMS[ERROR_IDS.RILL_R085]).toBe('RILL_R085');
  });

  it('every shipped error definition has a category matching its ID letter', () => {
    const letterToCategory: Record<string, string> = {
      L: 'lexer',
      P: 'parse',
      R: 'runtime',
      C: 'check',
    };

    for (const [errorId, def] of ERROR_REGISTRY.entries()) {
      const letter = errorId[5]!;
      const expected = letterToCategory[letter];
      expect(expected).toBeDefined();
      expect(def.category).toBe(expected);
    }
  });
});
