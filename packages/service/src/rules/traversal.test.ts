import { describe, expect, it } from 'vitest';
import type {
  ASTNode,
  NumberLiteralNode,
  PostfixExprNode,
  SourceSpan,
  UnaryExprNode,
} from '@rcrsr/rill';
import { traverseForRules } from './traversal.js';

const SPAN: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/**
 * Hand-builds a chain of `depth` nested UnaryExprNode wrappers around a
 * PostfixExpr(NumberLiteral) leaf. `UnaryExprNode.operand` is typed as
 * `UnaryExprNode | PostfixExprNode`, so this shape is directly buildable
 * without going through the parser (which recurses per nesting level
 * itself and would hit its own stack limit at the depths this test needs).
 */
function buildDeeplyNestedUnaryExpr(depth: number): ASTNode {
  const leaf: NumberLiteralNode = {
    type: 'NumberLiteral',
    value: 1,
    span: SPAN,
  };
  const postfix: PostfixExprNode = {
    type: 'PostfixExpr',
    primary: leaf,
    methods: [],
    defaultValue: null,
    span: SPAN,
  };

  let node: UnaryExprNode | PostfixExprNode = postfix;
  for (let i = 0; i < depth; i++) {
    node = { type: 'UnaryExpr', op: '-', operand: node, span: SPAN };
  }
  return node;
}

describe('traverseForRules', () => {
  it('walks a deeply nested AST without a stack overflow', () => {
    // Deep enough to overflow V8's default recursive call stack for this
    // shape (empirically well past the ~10k-15k depth a naive recursive
    // visitor tolerates).
    const depth = 50_000;
    const root = buildDeeplyNestedUnaryExpr(depth);

    let enterCount = 0;
    let exitCount = 0;

    expect(() => {
      traverseForRules(root, {
        enter: () => {
          enterCount++;
        },
        exit: () => {
          exitCount++;
        },
      });
    }).not.toThrow();

    // depth UnaryExpr nodes + 1 PostfixExpr + 1 NumberLiteral leaf.
    expect(enterCount).toBe(depth + 2);
    expect(exitCount).toBe(depth + 2);
  });

  it('visits nodes parent-before-children and exits in reverse (post-order)', () => {
    const root = buildDeeplyNestedUnaryExpr(3);

    const entered: string[] = [];
    const exited: string[] = [];

    traverseForRules(root, {
      enter: (node) => entered.push(node.type),
      exit: (node) => exited.push(node.type),
    });

    expect(entered).toEqual([
      'UnaryExpr',
      'UnaryExpr',
      'UnaryExpr',
      'PostfixExpr',
      'NumberLiteral',
    ]);
    expect(exited).toEqual([
      'NumberLiteral',
      'PostfixExpr',
      'UnaryExpr',
      'UnaryExpr',
      'UnaryExpr',
    ]);
  });
});
