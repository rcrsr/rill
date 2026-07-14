import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { captureBeforeBranch } from './capture-before-branch.js';
import { useDefaultOperator } from './use-default-operator.js';
import { complexCondition } from './complex-condition.js';
import { presenceOverNullGuard } from './presence-over-null-guard.js';
import { guardOverTryCatch } from './guard-over-try-catch.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('CAPTURE_BEFORE_BRANCH', () => {
  it('fires when bare $ is referenced in both branches', () => {
    const source = '$x -> .contains("ok") ? "Success: {$}" ! "Failed: {$}"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      captureBeforeBranch,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CAPTURE_BEFORE_BRANCH',
      severity: 'info',
      message:
        'Consider capturing value before conditional when used in multiple branches',
      fix: null,
    });
  });

  it('does not fire when only one branch references the piped value', () => {
    const source = '$x -> .contains("ok") ? "Success: {$}" ! "Failed"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      captureBeforeBranch,
    ]);

    expect(result).toEqual([]);
  });

  it("does not fire when a branch's bare $ belongs to a nested closure scope", () => {
    const source =
      '$x -> .contains("ok") ? (list[1, 2] -> fan({ $ * 2 })) ! "Failed: {$}"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      captureBeforeBranch,
    ]);

    expect(result).toEqual([]);
  });
});

describe('USE_DEFAULT_OPERATOR', () => {
  it('fires on the verbose .?field ? .field ! default pattern', () => {
    const source = '$dict.?field ? $dict.field ! "default"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [useDefaultOperator]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_DEFAULT_OPERATOR',
      severity: 'info',
      message:
        'Use ?? for defaults instead of conditionals: $dict.field ?? "default"',
      fix: null,
    });
  });

  it('does not fire on a conditional without an existence check', () => {
    const source = '"hello" -> .contains("ell") ? "found" ! "not found"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [useDefaultOperator]);

    expect(result).toEqual([]);
  });
});

describe('COMPLEX_CONDITION', () => {
  it('fires when the condition has 3+ boolean operators', () => {
    const source = '($a && $b && $c && $d) ? "y" ! "n"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [complexCondition]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'COMPLEX_CONDITION',
      severity: 'info',
      message:
        'Complex condition with multiple operators. Extract to named checks for clarity.',
      fix: null,
    });
  });

  it('does not fire on a simple two-operand condition', () => {
    const source = '($a && $b) ? "y" ! "n"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [complexCondition]);

    expect(result).toEqual([]);
  });
});

describe('PRESENCE_OVER_NULL_GUARD', () => {
  it('fires on ($x == nil) ? fallback ! $x', () => {
    const source = '($x == nil) ? "none" ! $x\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      presenceOverNullGuard,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'PRESENCE_OVER_NULL_GUARD',
      severity: 'info',
      message:
        'Nil-checking conditional. Prefer the default operator: $x ?? fallback.',
      fix: null,
    });
  });

  it('does not fire on a conditional without a nil comparison', () => {
    const source = '($x > 0) ? "pos" ! "nonpos"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      presenceOverNullGuard,
    ]);

    expect(result).toEqual([]);
  });
});

describe('GUARD_OVER_TRY_CATCH', () => {
  it('fires when the condition inspects a .! status probe', () => {
    const source = '$x.! ? "err" ! "ok"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [guardOverTryCatch]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'GUARD_OVER_TRY_CATCH',
      severity: 'info',
      message:
        'Branching on .! is manual try/catch. Wrap the fallible call in guard<on: list[#X]> { ... }.',
      fix: null,
    });
  });

  it('does not fire on a conditional without a status probe', () => {
    const source = '($x > 0) ? "pos" ! "nonpos"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [guardOverTryCatch]);

    expect(result).toEqual([]);
  });
});

describe('with all conditional-node rules on', () => {
  it('returns no findings for a clean script', () => {
    const source =
      '"hello" -> .contains("ell") ? "found" ! "not found"\n' +
      '($a && $b) ? "y" ! "n"\n' +
      '($x > 0) ? "pos" ! "nonpos"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      captureBeforeBranch,
      useDefaultOperator,
      complexCondition,
      presenceOverNullGuard,
      guardOverTryCatch,
    ]);

    expect(result).toEqual([]);
  });
});
