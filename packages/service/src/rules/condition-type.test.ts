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

  it.each([
    ['"hello" ? "a" ! "b"\n', 'string'],
    ['0 ? "a" ! "b"\n', 'number'],
    ['list[1] ? "a" ! "b"\n', 'list'],
    ['dict[a: 1] ? "a" ! "b"\n', 'dict'],
    ['#ABC ? "a" ! "b"\n', 'atom'],
  ])('names the literal type in the message for %s', (source, typeName) => {
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      `Condition is a ${typeName} literal; conditions must evaluate to bool.`
    );
  });

  it('fires on a literal while condition', () => {
    const source = '0 -> while ("go") do { $ + 1 }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      message:
        'Condition is a string literal; conditions must evaluate to bool.',
    });
  });

  it('fires on a literal do-while condition', () => {
    const source = '0 -> do { $ + 1 } while (1)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      message:
        'Condition is a number literal; conditions must evaluate to bool.',
    });
  });

  it('fires on a literal assert condition', () => {
    const source = '5 -> assert "ok"\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONDITION_TYPE',
      message:
        'Condition is a string literal; conditions must evaluate to bool.',
    });
  });

  it('stays silent on comparison conditions in loops and assert', () => {
    const source =
      '0 -> while ($ < 3) do { $ + 1 }\n0 -> do { $ + 1 } while ($ < 3)\n5 -> assert ($ > 0)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });

  it('stays silent on a seed-headed while loop with a literal condition', () => {
    const source = '0 while ("go") do { $ + 1 }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [conditionType]);

    expect(result).toEqual([]);
  });
});
