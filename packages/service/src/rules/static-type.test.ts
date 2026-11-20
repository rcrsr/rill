import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ASTNode, TypeRef } from '@rcrsr/rill';
import { hasUnionPart, typeAfterStep } from './static-type.js';
import type { RuleContext } from './types.js';

const NUMBER: TypeRef = { kind: 'static', typeName: 'number' };
const STRING: TypeRef = { kind: 'static', typeName: 'string' };
const UNION: TypeRef = { kind: 'union', members: [NUMBER, STRING] };

function ctor(typeName: string, ...args: TypeRef[]): TypeRef {
  return {
    kind: 'static',
    typeName,
    args: args.map((value) => ({ value })),
  } as TypeRef;
}

describe('hasUnionPart', () => {
  it('is true for a plain union', () => {
    expect(hasUnionPart(UNION)).toBe(true);
  });

  it('is true for a list whose element type is a union', () => {
    expect(hasUnionPart(ctor('list', UNION))).toBe(true);
  });

  it('is true for a nested collection holding a union', () => {
    expect(hasUnionPart(ctor('dict', ctor('list', UNION)))).toBe(true);
  });

  it('is true for a dict field whose type is a union', () => {
    const dict = {
      kind: 'static',
      typeName: 'dict',
      args: [{ name: 'a', value: UNION }],
    } as TypeRef;
    expect(hasUnionPart(dict)).toBe(true);
  });

  it('is true for a stream whose element type is a union', () => {
    expect(hasUnionPart(ctor('stream', UNION))).toBe(true);
  });

  it('is false when no union appears', () => {
    expect(hasUnionPart(NUMBER)).toBe(false);
    expect(hasUnionPart(ctor('list', ctor('dict', NUMBER)))).toBe(false);
  });
});

describe('typeAfterStep any pass-through', () => {
  const ctx = {} as RuleContext;

  function stepOf(source: string): ASTNode {
    const statement = parse(source).statements[0];
    if (statement?.type !== 'Statement') throw new Error('expected statement');
    const chain = statement.expression;
    if (chain.type !== 'PipeChain') throw new Error('expected a pipe chain');
    const step = chain.pipes[0];
    if (step === undefined) throw new Error('expected a pipe step');
    return step;
  }

  it('keeps the previous type for :any', () => {
    expect(typeAfterStep(NUMBER, stepOf('1 -> :any'), ctx)).toBe(NUMBER);
  });

  it('keeps the previous type for $x:any', () => {
    expect(typeAfterStep(NUMBER, stepOf('1 => $x:any'), ctx)).toBe(NUMBER);
  });

  it('takes the stated type for $x:string', () => {
    expect(typeAfterStep(NUMBER, stepOf('1 => $x:string'), ctx)).toEqual(
      STRING
    );
  });
});
