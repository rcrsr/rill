import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { useEmptyMethod } from './use-empty-method.js';
import { captureInlineChain } from './capture-inline-chain.js';
import { makeConfig, toParseResult } from './test-support.js';

describe('USE_EMPTY_METHOD', () => {
  it('fires on == "" comparison, suggesting .empty', () => {
    const source = '$x == ""\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [useEmptyMethod]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_EMPTY_METHOD',
      severity: 'warning',
      message: 'Use .empty for emptiness checks instead of comparing with ""',
      fix: null,
    });
  });

  it('fires on != "" comparison, suggesting !.empty', () => {
    const source = '$x != ""\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [useEmptyMethod]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_EMPTY_METHOD',
      severity: 'warning',
      message: 'Use !.empty for emptiness checks instead of comparing with ""',
      fix: null,
    });
  });

  it('does not fire when using .empty directly', () => {
    const source = '$x -> .empty\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [useEmptyMethod])).toEqual(
      []
    );
  });

  it('does not fire on a non-empty-string comparison', () => {
    const source = '$x == "hello"\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [useEmptyMethod])).toEqual(
      []
    );
  });
});

describe('CAPTURE_INLINE_CHAIN', () => {
  it('fires when a capture is immediately followed by a statement using it', () => {
    const source = 'prompt("Read file") => $raw\n$raw -> log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [captureInlineChain]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CAPTURE_INLINE_CHAIN',
      severity: 'info',
      message:
        "Consider inline capture: '=> $raw -> ...' instead of separate statements",
      fix: null,
    });
  });

  it('does not fire when the capture is already inlined into the chain', () => {
    const source = 'prompt("Read file") => $raw -> log\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [captureInlineChain])
    ).toEqual([]);
  });

  it('does not fire when the next statement does not reference the captured variable', () => {
    const source = 'prompt("Read file") => $raw\nlog("done")\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [captureInlineChain])
    ).toEqual([]);
  });

  it('does not fire when the capture-then-use pattern is nested inside a block (matches the rill-cli baseline, which only ever inspects top-level script statements)', () => {
    const source = '$cond ? { prompt() => $raw\n$raw -> log } ! { "no" }\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [captureInlineChain])
    ).toEqual([]);
  });
});

describe('with all rules from this task on', () => {
  it('emits zero diagnostics on a clean, idiomatic script', () => {
    const source = '$x -> .empty\nprompt("Read file") => $raw -> log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      useEmptyMethod,
      captureInlineChain,
    ]);

    expect(result).toEqual([]);
  });
});
