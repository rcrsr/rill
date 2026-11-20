import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { DeclarationNode } from '@rcrsr/rill';
import { declarationTypeRef } from './literal-shape.js';

function declarationOf(source: string): DeclarationNode {
  const statement = parse(source).statements[0];
  if (statement?.type !== 'Statement') throw new Error('expected a statement');
  const node = statement.expression;
  const head = node.type === 'PipeChain' ? node.head : node;
  const inner = head.type === 'PostfixExpr' ? head.primary : head;
  if (inner.type !== 'Declaration') throw new Error('expected a declaration');
  return inner;
}

describe('declarationTypeRef', () => {
  const unspecified = [
    'list list[1]',
    'list() list[1]',
    'list(any) list[1]',
    'any 5',
    'dict dict[a: 1]',
    'stream list[1]',
  ];
  it.each(unspecified)('returns null for the unspecified form %j', (source) => {
    expect(declarationTypeRef(declarationOf(source))).toBeNull();
  });

  const specified: [string, string][] = [
    ['union(number, string) 5', 'union'],
    ['number 5', 'static'],
    ['list(number) list[1]', 'static'],
  ];
  it.each(specified)('returns a type for %j', (source, kind) => {
    expect(declarationTypeRef(declarationOf(source))?.kind).toBe(kind);
  });

  it('names the declared scalar type', () => {
    expect(declarationTypeRef(declarationOf('number 5'))).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });
});
