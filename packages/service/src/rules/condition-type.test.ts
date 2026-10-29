import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { conditionType } from './condition-type.js';
import { makeConfig, toParseResult } from './test-support.js';

describe('CONDITION_TYPE', () => {
  it('fires on a bare string literal condition', () => {
    const source = '"hello" ? "has value" ! "empty"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      location: { line: 1 },
    });
  });

  it('fires on a bare number literal condition', () => {
    const source = '0 ? "yes" ! "no"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      location: { line: 1 },
    });
  });

  it('fires on an empty string literal condition', () => {
    const source = '"" ? "yes" ! "no"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      location: { line: 1 },
    });
  });

  it('stays silent on a piped method-call condition', () => {
    const source = '"hello" -> .contains("ell") ? "found" ! "not found"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('fires on a bare atom literal condition', () => {
    const source = '#ABC ? "yes" ! "no"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      location: { line: 1 },
    });
  });

  it('stays silent on a bool literal condition', () => {
    const source = 'true ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent when the primary carries a method call', () => {
    const source = '"hello".contains("ell") ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent on a variable condition', () => {
    const source = '$x ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent on a comparison condition', () => {
    const source = '($a > 1) ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent on a unary negation condition', () => {
    const source = '!$flag ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent on a host-call condition', () => {
    const source = 'foo() ? "a" ! "b"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });
});
