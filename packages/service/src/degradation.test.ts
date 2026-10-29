/**
 * Cross-cutting degradation and boundary tests for every query provider.
 *
 * Exercises all seven providers (documentSymbols, semanticTokens,
 * formatDocument, resolveScopeAt, findDefinition, getHover, getCompletions)
 * plus the rules engine (runRules) against recovery/partial ASTs and
 * malformed input. Every provider must degrade to a partial/empty/null result and never
 * throw; the recovery tests pin the values each provider returns.
 */
import { describe, expect, it } from 'vitest';
import { parseWithRecovery, tokenize } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';

import { documentSymbols } from './document-symbols.js';
import { semanticTokens } from './semantic-tokens.js';
import { formatDocument } from './format-document.js';
import {
  findDefinition,
  getCompletions,
  getHover,
  resolveScopeAt,
} from './scope/index.js';
import { createDefaultConfig, runRules } from './rules/index.js';

/** Runs every provider (plus runRules) against `parsed`/`source` at `offset` and returns each result; a throw fails the calling test. */
function runAllProviders(parsed: ParseResult, source: string, offset: number) {
  const tokens = tokenize(source);

  return {
    symbols: documentSymbols(parsed),
    tokens: semanticTokens(parsed, tokens, source),
    edits: formatDocument(parsed, source),
    scope: resolveScopeAt(parsed, offset),
    definition: findDefinition(parsed, offset),
    hover: getHover(parsed, offset),
    completions: getCompletions(parsed, offset),
    diagnostics: runRules(parsed, source, createDefaultConfig()),
  };
}

describe('provider degradation', () => {
  describe('RecoveryErrorNode mid-AST', () => {
    // Well-formed statements surround a RecoveryError node produced by
    // parser error recovery.
    const source =
      '1 => $a\n2 => $b\n|||broken syntax here\n3 => $c\n$a -> log\n';

    it('is surfaced as a RecoveryError statement by parseWithRecovery', () => {
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      expect(parsed.ast.statements.map((statement) => statement.type)).toEqual([
        'Statement',
        'Statement',
        'RecoveryError',
        'Statement',
        'Statement',
      ]);
    });

    it('every provider returns a partial result without throwing', () => {
      const parsed = parseWithRecovery(source);
      const offset = source.lastIndexOf('$a') + 1;

      const results = runAllProviders(parsed, source, offset);

      const variableNames = results.symbols
        .filter((symbol) => symbol.kind === 'variable')
        .map((symbol) => symbol.name);
      expect(variableNames).toContain('a');
      expect(variableNames).toContain('b');

      expect(results.definition?.start.offset).toBe(source.indexOf('$a'));
      expect(results.hover?.contents).toBe('variable `a`');
      expect(results.edits[0]?.newText).toContain('broken syntax here');

      const variableLabels = results.completions
        .filter((item) => item.kind === 'variable')
        .map((item) => item.label);
      expect(variableLabels).toContain('a');
      expect(variableLabels).toContain('b');

      expect(results.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining(['THROWAWAY_CAPTURE'])
      );
    });
  });

  describe('top-level PartialExpressionNode', () => {
    // The entire document is a single PartialExpression node.
    const source = 'error()';

    it('is surfaced as a PartialExpression statement by parseWithRecovery', () => {
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      expect(parsed.ast.statements[0]?.type).toBe('PartialExpression');
    });

    it('every provider degrades to an empty/minimal result without throwing', () => {
      const parsed = parseWithRecovery(source);
      const offset = 0;

      const results = runAllProviders(parsed, source, offset);

      expect(results.symbols).toEqual([]);
      expect(results.scope).toEqual([]);
      expect(results.definition).toBeNull();
      expect(results.hover).toBeNull();
      expect(results.edits[0]?.newText).toBe(source);
    });
  });

  describe('malformed input surviving parseWithRecovery', () => {
    // A mix of PartialExpression, RecoveryError, and a well-formed
    // trailing statement in the same document.
    const source = 'error(1 + 2))  \n"after"  \n';

    it('is surfaced with mixed recovery node types by parseWithRecovery', () => {
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      const types = parsed.ast.statements.map((statement) => statement.type);
      expect(types).toContain('PartialExpression');
      expect(types).toContain('Statement');
    });

    it('all providers run without raising', () => {
      const parsed = parseWithRecovery(source);
      const offset = source.indexOf('"after"') + 1;

      const results = runAllProviders(parsed, source, offset);

      expect(results.definition).toBeNull();
      expect(results.hover).toBeNull();
      expect(results.scope).toEqual([]);
      expect(results.symbols).toEqual([]);
      expect(results.edits).toHaveLength(1);
    });
  });
});
