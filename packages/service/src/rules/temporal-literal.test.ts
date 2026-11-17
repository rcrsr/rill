import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { temporalLiteral } from './temporal-literal.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    temporalLiteral,
  ]);
}

describe('TEMPORAL_LITERAL', () => {
  it('fires on a duration literal with suffixes out of order', () => {
    const result = check('duration("30s1m")\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'TEMPORAL_LITERAL',
      severity: 'warning',
      location: { line: 1 },
    });
    expect(result[0]?.message).toContain('duration() cannot parse "30s1m"');
  });

  it('fires on an unparseable datetime literal', () => {
    const result = check('datetime("not a date")\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('Invalid ISO 8601 string');
  });

  it('fires on an impossible calendar date', () => {
    const result = check('datetime("2024-02-30")\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('Invalid datetime component day');
  });

  it('stays silent on valid literals', () => {
    expect(check('duration("1m30s")\n')).toEqual([]);
    expect(check('datetime("2024-02-29T12:00:00Z")\n')).toEqual([]);
  });

  it('stays silent on non-literal arguments', () => {
    expect(check('"30s1m" => $d\nduration($d)\n')).toEqual([]);
    expect(check('"x" => $n\nduration("{$n}s1m")\n')).toEqual([]);
  });

  it('stays silent on other host calls', () => {
    expect(check('log("30s1m")\n')).toEqual([]);
  });
});
