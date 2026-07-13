import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { conditionType } from './condition-type.js';
import { foldIntermediates } from './fold-intermediates.js';
import { throwawayCapture } from './throwaway-capture.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('CONDITION_TYPE (stub)', () => {
  it('emits zero diagnostics on a Conditional node', () => {
    const source = '"hello" -> .contains("ell") ? "found" ! "not found"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });
});

describe('FOLD_INTERMEDIATES (stub)', () => {
  it('emits zero diagnostics on a collection-op HostCall', () => {
    const source = '[1, 2, 3] -> fold(0, { $@ + 1 })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });

  it('emits zero diagnostics on a non-collection-op HostCall', () => {
    const source = 'compute_total()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [foldIntermediates]);

    expect(result).toEqual([]);
  });
});

describe('THROWAWAY_CAPTURE (stub)', () => {
  it('emits zero diagnostics on a Capture node', () => {
    const source = '1 => $a\n$a\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

    expect(result).toEqual([]);
  });
});

describe('with all stub rules on', () => {
  it('emits zero diagnostics across all three stub node types', () => {
    const source =
      '1 => $a\n[1, 2, 3] -> fold(0, { $@ + 1 })\n"x" ? "yes" ! "no"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      conditionType,
      foldIntermediates,
      throwawayCapture,
    ]);

    expect(result).toEqual([]);
  });
});
