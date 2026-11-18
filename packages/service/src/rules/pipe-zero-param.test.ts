import { describe, expect, it } from 'vitest';
import { pipeZeroParamTarget } from './pipe-zero-param.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    pipeZeroParamTarget,
  ]);
}

describe('PIPE_ZERO_PARAM_TARGET', () => {
  it('fires on a zero-parameter closure pipe target', () => {
    const result = check('5 -> || { 1 }\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'PIPE_ZERO_PARAM_TARGET',
      severity: 'warning',
      location: { line: 1 },
      fix: null,
    });
  });

  it('fires on the parenthesized body form', () => {
    expect(check('5 -> ||(1)\n')).toHaveLength(1);
  });

  it('stays silent on a closure with a parameter', () => {
    expect(check('5 -> |x|($x)\n')).toEqual([]);
  });

  it('stays silent on a zero-parameter closure that is not a pipe target', () => {
    expect(check('|| { 1 } => $f\n')).toEqual([]);
  });

  it('stays silent on a block pipe target', () => {
    expect(check('5 -> { $ }\n')).toEqual([]);
  });
});
