/**
 * AST Visitor
 * Recursive traversal with enter/exit callbacks for validation rules.
 */

import type { ASTNode } from '../types.js';
import type { ValidationContext } from './types.js';

// ============================================================
// VISITOR INTERFACE
// ============================================================

/**
 * Visitor pattern interface for AST traversal.
 * Provides enter/exit callbacks invoked before and after visiting children.
 */
export interface RuleVisitor {
  /**
   * Called before visiting node's children.
   * Use for pre-order traversal validation.
   */
  enter(node: ASTNode, context: ValidationContext): void;

  /**
   * Called after visiting node's children.
   * Use for post-order traversal validation.
   */
  exit(node: ASTNode, context: ValidationContext): void;
}

// ============================================================
// VISITOR FUNCTION
// ============================================================

/**
 * Recursively visit AST nodes with enter/exit callbacks.
 * Handles all 46 node types from ASTNode union.
 *
 * Traversal order:
 * 1. visitor.enter(node)
 * 2. Recurse into children
 * 3. visitor.exit(node)
 */
export function visitNode(
  node: ASTNode,
  context: ValidationContext,
  visitor: RuleVisitor
): void {
  // Enter callback before children
  visitor.enter(node, context);

  // Recurse based on node type
  switch (node.type) {
    case 'Script':
      if (node.frontmatter) {
        visitNode(node.frontmatter, context, visitor);
      }
      for (const stmt of node.statements) {
        visitNode(stmt, context, visitor);
      }
      break;

    case 'Frontmatter':
      // Leaf node - no children
      break;

    case 'Statement':
      visitNode(node.expression, context, visitor);
      break;

    case 'AnnotatedStatement':
      for (const arg of node.annotations) {
        visitNode(arg, context, visitor);
      }
      visitNode(node.statement, context, visitor);
      break;

    case 'NamedArg':
      visitNode(node.value, context, visitor);
      break;

    case 'SpreadArg':
      visitNode(node.expression, context, visitor);
      break;

    case 'PipeChain':
      visitNode(node.head, context, visitor);
      for (const pipe of node.pipes) {
        visitNode(pipe, context, visitor);
      }
      if (node.terminator) {
        visitNode(node.terminator, context, visitor);
      }
      break;

    case 'PostfixExpr':
      visitNode(node.primary, context, visitor);
      for (const method of node.methods) {
        visitNode(method, context, visitor);
      }
      break;

    case 'BinaryExpr':
      visitNode(node.left, context, visitor);
      visitNode(node.right, context, visitor);
      break;

    case 'UnaryExpr':
      visitNode(node.operand, context, visitor);
      break;

    case 'GroupedExpr':
      visitNode(node.expression, context, visitor);
      break;

    case 'StringLiteral':
      for (const part of node.parts) {
        if (typeof part !== 'string') {
          visitNode(part, context, visitor);
        }
      }
      break;

    case 'Interpolation':
      visitNode(node.expression, context, visitor);
      break;

    case 'NumberLiteral':
    case 'BoolLiteral':
      // Leaf nodes - no children
      break;

    case 'Tuple':
      for (const element of node.elements) {
        visitNode(element, context, visitor);
      }
      break;

    case 'Dict':
      for (const entry of node.entries) {
        visitNode(entry, context, visitor);
      }
      break;

    case 'DictEntry':
      visitNode(node.value, context, visitor);
      break;

    case 'Closure':
      for (const param of node.params) {
        visitNode(param, context, visitor);
      }
      visitNode(node.body, context, visitor);
      break;

    case 'ClosureParam':
      if (node.defaultValue) {
        visitNode(node.defaultValue, context, visitor);
      }
      break;

    case 'Variable':
      if (node.defaultValue) {
        visitNode(node.defaultValue, context, visitor);
      }
      break;

    case 'HostCall':
      for (const arg of node.args) {
        visitNode(arg, context, visitor);
      }
      break;

    case 'ClosureCall':
      for (const arg of node.args) {
        visitNode(arg, context, visitor);
      }
      break;

    case 'MethodCall':
      for (const arg of node.args) {
        visitNode(arg, context, visitor);
      }
      break;

    case 'Invoke':
      for (const arg of node.args) {
        visitNode(arg, context, visitor);
      }
      break;

    case 'PipeInvoke':
      for (const arg of node.args) {
        visitNode(arg, context, visitor);
      }
      break;

    case 'Conditional':
      if (node.input) {
        visitNode(node.input, context, visitor);
      }
      if (node.condition) {
        visitNode(node.condition, context, visitor);
      }
      visitNode(node.thenBranch, context, visitor);
      if (node.elseBranch) {
        visitNode(node.elseBranch, context, visitor);
      }
      break;

    case 'WhileLoop':
      visitNode(node.condition, context, visitor);
      visitNode(node.body, context, visitor);
      break;

    case 'DoWhileLoop':
      if (node.input) {
        visitNode(node.input, context, visitor);
      }
      visitNode(node.body, context, visitor);
      visitNode(node.condition, context, visitor);
      break;

    case 'Block':
      for (const stmt of node.statements) {
        visitNode(stmt, context, visitor);
      }
      break;

    case 'EachExpr':
      visitNode(node.body, context, visitor);
      if (node.accumulator) {
        visitNode(node.accumulator, context, visitor);
      }
      break;

    case 'MapExpr':
      visitNode(node.body, context, visitor);
      break;

    case 'FoldExpr':
      visitNode(node.body, context, visitor);
      if (node.accumulator) {
        visitNode(node.accumulator, context, visitor);
      }
      break;

    case 'FilterExpr':
      visitNode(node.body, context, visitor);
      break;

    case 'ClosureChain':
      visitNode(node.target, context, visitor);
      break;

    case 'Destructure':
      for (const element of node.elements) {
        visitNode(element, context, visitor);
      }
      break;

    case 'DestructPattern':
      if (node.nested) {
        visitNode(node.nested, context, visitor);
      }
      break;

    case 'Slice':
      if (node.start) {
        visitNode(node.start, context, visitor);
      }
      if (node.stop) {
        visitNode(node.stop, context, visitor);
      }
      if (node.step) {
        visitNode(node.step, context, visitor);
      }
      break;

    case 'Spread':
      if (node.operand) {
        visitNode(node.operand, context, visitor);
      }
      break;

    case 'TypeAssertion':
      if (node.operand) {
        visitNode(node.operand, context, visitor);
      }
      break;

    case 'TypeCheck':
      if (node.operand) {
        visitNode(node.operand, context, visitor);
      }
      break;

    case 'Capture':
    case 'Break':
    case 'Return':
      // Leaf nodes - no children
      break;

    case 'Error':
      // Error recovery node - no children to visit
      break;

    default: {
      // Exhaustive check: if we reach here, a node type is missing
      const _exhaustive: never = node;
      throw new Error(
        `Unhandled node type in visitor: ${(_exhaustive as ASTNode).type}`
      );
    }
  }

  // Exit callback after children
  visitor.exit(node, context);
}
