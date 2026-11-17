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

  it('fires on an .eq call written as a pipe', () => {
    expect(check('1 -> .eq("a")\n')).toHaveLength(1);
  });

  it('fires on .has with a sought kind absent from the list literal', () => {
    const result = check('list[1, 2] -> .has("a")\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'EQUALITY_NO_OVERLAP',
      severity: 'warning',
      location: { line: 1 },
    });
  });

  it('fires on .has in the method-call form', () => {
    expect(check('list[1, 2].has("a")\n')).toHaveLength(1);
  });

  it('fires on .has_any and .has_all with no candidate kind in the list', () => {
    expect(check('list[1, 2] -> .has_any(list["a", "b"])\n')).toHaveLength(1);
    expect(check('list["a"] -> .has_all(list[true])\n')).toHaveLength(1);
  });

  it('stays silent on .has when the sought kind is among the list kinds', () => {
    expect(check('list[1, "a"] -> .has("a")\n')).toEqual([]);
    expect(check('list[1, 2] -> .has(3)\n')).toEqual([]);
  });

  it('stays silent on .has_any when one candidate kind matches', () => {
    expect(check('list[1, 2] -> .has_any(list["a", 3])\n')).toEqual([]);
  });

  it('stays silent on membership with an empty or non-literal operand', () => {
    expect(check('list[] -> .has("a")\n')).toEqual([]);
    expect(check('list[1] => $l\n$l -> .has("a")\n')).toEqual([]);
    expect(check('list[1, $x] -> .has("a")\n')).toEqual([]);
    expect(check('list[1] -> .has($x)\n')).toEqual([]);
  });

  it('judges collection literals by kind only, so differing dict shapes stay silent', () => {
    expect(check('list[dict[a: 1]] -> .has(dict[b: 2])\n')).toEqual([]);
    expect(check('list[dict[a: 1]] -> .has("a")\n')).toEqual([]);
  });
});
