import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { closureLateBinding } from './closure-late-binding.js';
import { makeConfig, toParseResult } from './test-support.js';

describe('CLOSURE_LATE_BINDING', () => {
  it('fires when seq creates a fn with no preceding explicit capture', () => {
    const source = '[1, 2, 3] -> seq({ fn { $ } => $g\n $g() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureLateBinding]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CLOSURE_LATE_BINDING',
      severity: 'warning',
      message:
        'Capture loop variable explicitly for deferred functions: $ => $item',
      fix: null,
    });
  });

  it('does not fire when the loop variable is captured explicitly first', () => {
    const source =
      '[1, 2, 3] -> seq({ $ => $item\n fn() { $item } => $g\n $g() })\n';
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

describe('with the fn rules on', () => {
  it('returns no findings for a clean script', () => {
    const source =
      'fn(x) { $x * 2 } => $f\n' +
      '[1, 2, 3] -> seq({ $ => $item\n fn() { $item } => $g\n $g() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [closureLateBinding]);

    expect(result).toEqual([]);
  });
});
