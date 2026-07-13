import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { closureBareDollar } from './closure-bare-dollar.js';
import { closureBraces } from './closure-braces.js';
import { closureLateBinding } from './closure-late-binding.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('CLOSURE_BARE_DOLLAR', () => {
  it('fires on a zero-param stored closure with a bare $ body', () => {
    const source = '(|| { $ }) => $f\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureBareDollar]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CLOSURE_BARE_DOLLAR',
      severity: 'warning',
      message:
        'Bare $ in stored closure has ambiguous binding. Use explicit capture: $ => $item',
      fix: null,
    });
  });

  it('does not fire on a parameterized closure', () => {
    const source = '|x| ($x * 2) => $f\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureBareDollar]);

    expect(result).toEqual([]);
  });
});

describe('CLOSURE_BRACES', () => {
  it('fires when a grouped-expression closure body wraps a conditional', () => {
    const source = '|n| (($n < 1) ? 1 ! 2) => $f\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureBraces]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CLOSURE_BRACES',
      severity: 'info',
      message: 'Use braces for complex closure bodies (conditionals, loops)',
      fix: null,
    });
  });

  it('does not fire on a simple grouped-expression closure body', () => {
    const source = '|x| ($x * 2) => $f\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureBraces]);

    expect(result).toEqual([]);
  });
});

describe('CLOSURE_LATE_BINDING', () => {
  it('fires when seq creates a closure with no preceding explicit capture', () => {
    const source = '[1, 2, 3] -> seq({ (|| { $ }) => $g\n $g() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureLateBinding]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CLOSURE_LATE_BINDING',
      severity: 'warning',
      message:
        'Capture loop variable explicitly for deferred closures: $ => $item',
      fix: null,
    });
  });

  it('does not fire when the loop variable is captured explicitly first', () => {
    const source =
      '[1, 2, 3] -> seq({ $ => $item\n (|| { $item }) => $g\n $g() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureLateBinding]);

    expect(result).toEqual([]);
  });

  it('does not fire on a HostCall that is not a collection op', () => {
    const source = 'compute_total()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureLateBinding]);

    expect(result).toEqual([]);
  });
});

describe('with all closure-mechanism rules on', () => {
  it('returns no findings for a clean script', () => {
    const source =
      '|x| ($x * 2) => $f\n' +
      '[1, 2, 3] -> seq({ $ => $item\n (|| { $item }) => $g\n $g() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      closureBareDollar,
      closureBraces,
      closureLateBinding,
    ]);

    expect(result).toEqual([]);
  });
});
