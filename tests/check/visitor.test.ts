/**
 * Visitor Tests
 * Verify AST traversal with enter/exit callbacks.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/index.js';
import { visitNode, type RuleVisitor } from '../../src/check/visitor.js';
import type { ASTNode } from '../../src/types.js';
import type { ValidationContext } from '../../src/check/types.js';

function createTestContext(source: string): ValidationContext {
  const ast = parse(source);
  return {
    source,
    ast,
    config: { rules: {}, severity: {} },
    diagnostics: [],
    variables: new Map(),
  };
}

describe('visitNode', () => {
  it('calls enter before children and exit after', () => {
    const source = '1 + 2';
    const context = createTestContext(source);
    const order: string[] = [];

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        order.push(`enter:${node.type}`);
      },
      exit: (node: ASTNode) => {
        order.push(`exit:${node.type}`);
      },
    };

    visitNode(context.ast, context, visitor);

    // Verify enter/exit order
    expect(order[0]).toBe('enter:Script');
    expect(order[order.length - 1]).toBe('exit:Script');

    // Every enter should have a matching exit
    const enterCount = order.filter((s) => s.startsWith('enter:')).length;
    const exitCount = order.filter((s) => s.startsWith('exit:')).length;
    expect(enterCount).toBe(exitCount);
  });

  it('visits all node types in a complex expression', () => {
    const source = `
      "hello" => $greeting
      $greeting -> .upper
    `;
    const context = createTestContext(source);
    const nodeTypes = new Set<string>();

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        nodeTypes.add(node.type);
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    // Verify key node types are visited
    expect(nodeTypes.has('Script')).toBe(true);
    expect(nodeTypes.has('Statement')).toBe(true);
    expect(nodeTypes.has('PipeChain')).toBe(true);
    expect(nodeTypes.has('StringLiteral')).toBe(true);
    expect(nodeTypes.has('Capture')).toBe(true);
    expect(nodeTypes.has('Variable')).toBe(true);
    expect(nodeTypes.has('MethodCall')).toBe(true);
  });

  it('visits conditional branches', () => {
    const source = 'true ? "yes" ! "no"';
    const context = createTestContext(source);
    const nodeTypes = new Set<string>();

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        nodeTypes.add(node.type);
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    expect(nodeTypes.has('Conditional')).toBe(true);
    expect(nodeTypes.has('BoolLiteral')).toBe(true);
    expect(nodeTypes.has('StringLiteral')).toBe(true);
  });

  it('visits loop bodies', () => {
    const source = '[1, 2, 3] -> each { $ * 2 }';
    const context = createTestContext(source);
    const nodeTypes = new Set<string>();

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        nodeTypes.add(node.type);
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    expect(nodeTypes.has('EachExpr')).toBe(true);
    expect(nodeTypes.has('Block')).toBe(true);
    expect(nodeTypes.has('Tuple')).toBe(true);
  });

  it('visits closure parameters and body', () => {
    const source = '|x: number| ($x * 2)';
    const context = createTestContext(source);
    const nodeTypes = new Set<string>();

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        nodeTypes.add(node.type);
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    expect(nodeTypes.has('Closure')).toBe(true);
    expect(nodeTypes.has('ClosureParam')).toBe(true);
    expect(nodeTypes.has('GroupedExpr')).toBe(true);
    expect(nodeTypes.has('BinaryExpr')).toBe(true);
  });

  it('visits destructure patterns', () => {
    const source = '[1, 2, 3] -> *<$a, $b, $c>';
    const context = createTestContext(source);
    const nodeTypes = new Set<string>();

    const visitor: RuleVisitor = {
      enter: (node: ASTNode) => {
        nodeTypes.add(node.type);
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    expect(nodeTypes.has('Destructure')).toBe(true);
    expect(nodeTypes.has('DestructPattern')).toBe(true);
  });

  it('counts nodes correctly', () => {
    const source = '1 + 2 + 3';
    const context = createTestContext(source);
    let nodeCount = 0;

    const visitor: RuleVisitor = {
      enter: () => {
        nodeCount++;
      },
      exit: () => {},
    };

    visitNode(context.ast, context, visitor);

    // Script, Statement, PipeChain, BinaryExpr (outer), BinaryExpr (inner),
    // PostfixExpr nodes, NumberLiterals
    expect(nodeCount).toBeGreaterThan(5);
  });
});
