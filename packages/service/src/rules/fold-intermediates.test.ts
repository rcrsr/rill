import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { foldIntermediates } from './fold-intermediates.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('FOLD_INTERMEDIATES', () => {
  it('fires on an adjacent acc(...) -> .tail pipe pair', () => {
    const source = '[1, 2, 3] -> acc(0, { $@ + $ }) -> .tail\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'FOLD_INTERMEDIATES',
      location: { line: 1 },
    });
  });

  it('stays silent on acc(...) alone (documented running-totals idiom)', () => {
    const source = '[1, 2, 3] -> acc(0, { $@ + $ })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });

  it('stays silent on fold(...) (already the correct operator)', () => {
    const source = '[1, 2, 3] -> fold(0, { $@ + $ })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });

  it('stays silent when acc(...) and .tail are not adjacent', () => {
    const source = '[1, 2, 3] -> acc(0, { $@ + $ }) -> log -> .tail\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });

  it('stays silent on a non-acc collection op followed by .tail', () => {
    const source = '[1, 2, 3] -> seq({ $ * 2 }) -> .tail\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });

  it('fires once per occurrence when a single PipeChain has multiple adjacent acc(...) -> .tail pairs', () => {
    const source =
      '[1, 2, 3] -> acc(0, { $@ + $ }) -> .tail -> acc(0, { $@ + $ }) -> .tail\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toHaveLength(2);
    expect(result.every((d) => d.code === 'FOLD_INTERMEDIATES')).toBe(true);
  });
});
