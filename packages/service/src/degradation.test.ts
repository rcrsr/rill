/**
 * Cross-cutting degradation and boundary tests for every query provider.
 *
 * Exercises all seven providers (documentSymbols, semanticTokens,
 * formatDocument, resolveScopeAt, findDefinition, getHover, getCompletions)
 * plus the rules engine (runRules) against recovery/partial ASTs, malformed
 * input, empty/whitespace-only scripts, and out-of-range offsets. Every
 * provider must degrade to a partial/empty/null result and never throw.
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

/** Runs every provider (plus runRules) against `parsed`/`source` at `offset` and asserts none throw. */
function expectAllProvidersSurvive(
  parsed: ParseResult,
  source: string,
  offset: number
): void {
  const tokens = tokenize(source);

  expect(() => documentSymbols(parsed)).not.toThrow();
  expect(() => semanticTokens(parsed, tokens, source)).not.toThrow();
  expect(() => formatDocument(parsed, source)).not.toThrow();
  expect(() => resolveScopeAt(parsed, offset)).not.toThrow();
  expect(() => findDefinition(parsed, offset)).not.toThrow();
  expect(() => getHover(parsed, offset)).not.toThrow();
  expect(() => getCompletions(parsed, offset)).not.toThrow();
  expect(() => runRules(parsed, source, createDefaultConfig())).not.toThrow();
}

describe('provider degradation', () => {
  describe('RecoveryErrorNode mid-AST', () => {
    // Well-formed statements surround a RecoveryError node produced by
    // parser error recovery.
    const source = '1 => $a\n2 => $b\n|||broken syntax here\n3 => $c\n';

    it('is surfaced as a RecoveryError statement by parseWithRecovery', () => {
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      expect(parsed.ast.statements.map((statement) => statement.type)).toEqual([
        'Statement',
        'Statement',
        'RecoveryError',
        'Statement',
      ]);
    });

    it('every provider returns a partial result without throwing', () => {
      const parsed = parseWithRecovery(source);
      const offset = source.indexOf('$a') + 1;

      expectAllProvidersSurvive(parsed, source, offset);

      const symbols = documentSymbols(parsed);
      const variableNames = symbols
        .filter((symbol) => symbol.kind === 'variable')
        .map((symbol) => symbol.name);
      expect(variableNames).toContain('a');
      expect(variableNames).toContain('b');

      const [edit] = formatDocument(parsed, source);
      expect(edit?.newText).toContain('broken syntax here');

      const diagnostics = runRules(parsed, source, createDefaultConfig());
      expect(Array.isArray(diagnostics)).toBe(true);
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

      expectAllProvidersSurvive(parsed, source, offset);

      expect(documentSymbols(parsed)).toEqual([]);
      expect(resolveScopeAt(parsed, offset)).toEqual([]);
      expect(findDefinition(parsed, offset)).toBeNull();
      expect(getHover(parsed, offset)).toBeNull();

      const [edit] = formatDocument(parsed, source);
      expect(edit?.newText).toBe(source);
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

      expectAllProvidersSurvive(parsed, source, offset);
    });
  });
});

describe('findDefinition/getHover resolution boundaries', () => {
  it('returns null when the offset resolves to nothing (unresolved variable)', () => {
    const source = '$nope -> log\n';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$nope') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();
    expect(getHover(parsed, offset)).toBeNull();
  });

  it('findDefinition returns null and getHover returns a static description for a built-in function name', () => {
    const source = 'log(1)\n';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('log') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();

    const hover = getHover(parsed, offset);
    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('log');
  });

  it('findDefinition returns null and getHover returns a static description for a reserved keyword', () => {
    const source = 'true\n';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('true') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();

    const hover = getHover(parsed, offset);
    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('true');
  });
});

describe('empty/whitespace-only script', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   \n  \n'],
  ])(
    '%s script: symbols/tokens/completions are empty, hover/definition are null',
    (_label, source) => {
      const parsed = parseWithRecovery(source);
      const tokens = tokenize(source);

      expect(documentSymbols(parsed)).toEqual([]);
      expect(semanticTokens(parsed, tokens, source)).toEqual([]);

      const completions = getCompletions(parsed, 0);
      expect(completions.some((item) => item.kind === 'variable')).toBe(false);

      expect(getHover(parsed, 0)).toBeNull();
      expect(findDefinition(parsed, 0)).toBeNull();
    }
  );
});

describe('out-of-range offsets', () => {
  const source = '1 => $a\n2 => $b\n';

  it('handles offset 0 (document start) without throwing', () => {
    const parsed = parseWithRecovery(source);

    expect(() => resolveScopeAt(parsed, 0)).not.toThrow();
    expect(() => findDefinition(parsed, 0)).not.toThrow();
    expect(() => getHover(parsed, 0)).not.toThrow();
  });

  it('handles an offset at EOF without throwing', () => {
    const parsed = parseWithRecovery(source);
    const eofOffset = source.length;

    expect(() => resolveScopeAt(parsed, eofOffset)).not.toThrow();
    expect(() => findDefinition(parsed, eofOffset)).not.toThrow();
    expect(() => getHover(parsed, eofOffset)).not.toThrow();
  });

  it('returns empty/null results for an offset past EOF without throwing', () => {
    const parsed = parseWithRecovery(source);
    const pastEofOffset = source.length + 1000;

    expect(() => resolveScopeAt(parsed, pastEofOffset)).not.toThrow();
    expect(resolveScopeAt(parsed, pastEofOffset)).toEqual([]);

    expect(() => findDefinition(parsed, pastEofOffset)).not.toThrow();
    expect(findDefinition(parsed, pastEofOffset)).toBeNull();

    expect(() => getHover(parsed, pastEofOffset)).not.toThrow();
    expect(getHover(parsed, pastEofOffset)).toBeNull();
  });
});
