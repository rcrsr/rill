import { describe, expect, it } from 'vitest';
import { equalityNoOverlap } from './equality-overlap.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    equalityNoOverlap,
  ]);
}

describe('EQUALITY_NO_OVERLAP', () => {
  it('fires on a number compared with a string', () => {
    const result = check('1 == "1"\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'EQUALITY_NO_OVERLAP',
      severity: 'warning',
      location: { line: 1 },
    });
  });

  it('fires on an .eq call with disjoint literal kinds', () => {
    expect(check('"a".eq(1)\n')).toHaveLength(1);
  });

  it('fires on != and .ne', () => {
    expect(check('1 != "1"\n')).toHaveLength(1);
    expect(check('"a".ne(1)\n')).toHaveLength(1);
  });

  it('fires on an asserted operand with a static type name', () => {
    expect(check('"x" => $x\n$x:string == 1\n')).toHaveLength(1);
  });

  it('stays silent on operands of the same kind', () => {
    expect(check('1 == 2\n')).toEqual([]);
  });

  it('stays silent on collection literals of the same kind', () => {
    expect(check('list[] == list[1]\n')).toEqual([]);
  });

  it('stays silent when an operand is not statically typed', () => {
    expect(check('"a" => $x\n$x == "a"\n')).toEqual([]);
  });
});
