/**
 * Rill Runtime Tests: code-block shape recognition and unnamed param names
 */

import { describe, expect, it } from 'vitest';
import {
  codeBlockShape,
  isUnnamedParamName,
  parse,
  unnamedParamsRead,
  walkAst,
  type ASTNode,
  type ExpressionNode,
} from '@rcrsr/rill';

function exprOf(source: string): ASTNode {
  const stmt = parse(source).statements[0];
  if (stmt === undefined || stmt.type !== 'Statement') {
    throw new Error('expected a statement');
  }
  const expr: ExpressionNode = stmt.expression;
  return expr;
}

function findFirst(source: string, type: ASTNode['type']): ASTNode {
  let found: ASTNode | undefined;
  walkAst(parse(source), (n) => {
    if (found === undefined && n.type === type) found = n;
  });
  if (found === undefined) throw new Error(`no ${type} node`);
  return found;
}

function descend(node: ASTNode): ASTNode[] {
  const out: ASTNode[] = [node];
  if (node.type === 'PipeChain') out.push(...descend(node.head));
  if (node.type === 'PostfixExpr') out.push(...descend(node.primary));
  if (node.type === 'AnnotatedExpr') out.push(...descend(node.expression));
  if (
    (node.type === 'TypeAssertion' || node.type === 'TypeCheck') &&
    node.operand !== null
  ) {
    out.push(...descend(node.operand));
  }
  return out;
}

describe('codeBlockShape', () => {
  it('matches a bare Block', () => {
    const block = descend(exprOf('{ 1 }')).find((n) => n.type === 'Block');
    expect(block).toBeDefined();
    expect(codeBlockShape(block as ASTNode)?.block).toBe(block);
  });

  it.each([
    ['a block expression statement', '{ 1 }'],
    ['a type assertion over a block', '{ 1 }:number'],
    ['a type check over a block', '{ 1 }:?number'],
  ])('recognizes %s through its wrappers', (_label, source) => {
    const expr = exprOf(source);
    const shape = codeBlockShape(expr);
    expect(shape?.block.type).toBe('Block');
  });

  it('recognizes an annotated block', () => {
    const annotated = findFirst('dict[f: ^(a: 1) { 1 }]', 'AnnotatedExpr');
    expect(codeBlockShape(annotated)?.block.type).toBe('Block');
  });

  it('recognizes an annotated block under a type assertion', () => {
    const typed = findFirst('dict[f: ^(a: 1) { 1 }:number]', 'TypeAssertion');
    expect(codeBlockShape(typed)?.block.type).toBe('Block');
  });

  it('returns undefined for an annotated closure literal', () => {
    const annotated = findFirst('dict[f: ^(a: 1) fn { 1 }]', 'AnnotatedExpr');
    expect(codeBlockShape(annotated)).toBeUndefined();
  });

  it('returns undefined for a postfix with a method call', () => {
    expect(codeBlockShape(exprOf('{ 1 } -> .len'))).toBeUndefined();
    expect(codeBlockShape(exprOf('{ 1 }.len()'))).toBeUndefined();
  });

  it('returns undefined for a non-block primary', () => {
    expect(codeBlockShape(exprOf('5'))).toBeUndefined();
    expect(codeBlockShape(exprOf('"a"'))).toBeUndefined();
  });

  it('returns undefined for a closure literal', () => {
    expect(codeBlockShape(exprOf('fn(x) { $x }'))).toBeUndefined();
  });

  it('returns undefined for a pipe chain with targets', () => {
    expect(codeBlockShape(exprOf('{ 1 } -> $x'))).toBeUndefined();
  });
});

describe('isUnnamedParamName', () => {
  it('is true for "$" and "@"', () => {
    expect(isUnnamedParamName('$')).toBe(true);
    expect(isUnnamedParamName('@')).toBe(true);
  });

  it('is false for a named param', () => {
    expect(isUnnamedParamName('x')).toBe(false);
  });
});

describe('index re-exports', () => {
  it('exposes unnamedParamsRead as a function', () => {
    expect(typeof unnamedParamsRead).toBe('function');
  });
});
