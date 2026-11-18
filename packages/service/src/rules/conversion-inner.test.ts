import { describe, expect, it } from 'vitest';
import { pipeConvertsInner } from './conversion-inner.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    pipeConvertsInner,
  ]);
}

describe('PIPE_CONVERTS_INNER', () => {
  it('fires when a list literal of numbers pipes into list(string)', () => {
    const result = check('list[1, 2] -> list(string)\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'PIPE_CONVERTS_INNER',
      severity: 'info',
      message:
        'Piping into list(string) converts number values to string; write `-> :list(string)` to check without converting.',
      fix: null,
    });
  });

  it('fires on a parameterized type assertion source', () => {
    expect(check('$x:list(number) -> list(string)\n')).toHaveLength(1);
  });

  it('fires when one element of a mixed literal differs', () => {
    expect(check('list[1, "a"] -> list(string)\n')).toHaveLength(1);
  });

  it('adapts the message to a dict target with named fields', () => {
    const result = check('dict[a: 1, b: "x"] -> dict(a: string, b: string)\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('`-> :dict(a: string, b: string)`');
  });

  it('matches tuple positions by index', () => {
    expect(check('tuple[1, "a"] -> tuple(number, string)\n')).toEqual([]);
    expect(check('tuple[1, "a"] -> tuple(number, number)\n')).toHaveLength(1);
  });

  it('stays silent when the source is unknowable', () => {
    expect(check('$x -> list(string)\n')).toEqual([]);
    expect(check('list[$a, 2] -> list(string)\n')).toEqual([]);
  });

  it('stays silent when the kinds already agree', () => {
    expect(check('list["a", "b"] -> list(string)\n')).toEqual([]);
    expect(check('$x:list(string) -> list(string)\n')).toEqual([]);
  });

  it('stays silent on the checking form', () => {
    expect(check('list[1, 2] -> :list(string)\n')).toEqual([]);
  });

  it('stays silent when the target part is not a scalar type', () => {
    expect(check('list[1, 2] -> list(union(string, number))\n')).toEqual([]);
    expect(check('list[1, 2] -> list\n')).toEqual([]);
  });
});
