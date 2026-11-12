import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { onListSingle } from './guard-retry.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [onListSingle]);
}

describe('ON_LIST_SINGLE', () => {
  it('fires on guard with a one-element on list', () => {
    const result = run('guard<on: list[#TIMEOUT]> { $x }\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ON_LIST_SINGLE',
      severity: 'info',
      message: 'on: list[#TIMEOUT] holds one code; write on: #TIMEOUT.',
      fix: null,
    });
  });

  it('fires on retry with a one-element on list', () => {
    const result = run('retry<limit: 3, on: list[#TIMEOUT]> { $x }\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: 'ON_LIST_SINGLE' });
  });

  it('is silent on the single-atom form', () => {
    expect(run('guard<on: #TIMEOUT> { $x }\n')).toEqual([]);
  });

  it('is silent on a multi-element list', () => {
    expect(run('guard<on: list[#TIMEOUT, #TYPE_MISMATCH]> { $x }\n')).toEqual(
      []
    );
  });

  it('is silent on a bare guard', () => {
    expect(run('guard { $x }\n')).toEqual([]);
  });
});
