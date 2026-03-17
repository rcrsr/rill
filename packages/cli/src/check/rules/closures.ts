/**
 * Closure Convention Rules
 * Enforces closure best practices from docs/guide-conventions.md:237-286.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  ClosureNode,
  GroupedExprNode,
  PipeChainNode,
  PostfixExprNode,
  VariableNode,
  EachExprNode,
} from '@rcrsr/rill';
import { extractContextLine } from './helpers.js';
import { visitNode } from '../visitor.js';

// ============================================================
// CLOSURE_BARE_DOLLAR RULE
// ============================================================

/**
 * Warns on bare $ in stored closures without parameters.
 * Bare $ in stored closures has ambiguous binding - it refers to the
 * pipe value at closure invocation time, not definition time.
 *
 * Detection:
 * - Zero-parameter closures (|| { }) used outside dict context
 * - Body contains bare $ references (VariableNode with name '$')
 *
 * Valid patterns:
 * - Dict closures: [count: ||{ $.items -> .len }]  ($ binds to dict)
 * - Parameterized closures: |x|{ $x }  (explicit params)
 * - Inline blocks: -> { $ * 2 }  (immediate evaluation)
 *
 * References:
 * - docs/guide-conventions.md:251-261
 * - docs/topic-closures.md: Late binding section
 */
export const CLOSURE_BARE_DOLLAR: ValidationRule = {
  code: 'CLOSURE_BARE_DOLLAR',
  category: 'closures',
  severity: 'warning',
  nodeTypes: ['Closure'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const closureNode = node as ClosureNode;

    // Only check zero-parameter closures (|| { })
    if (closureNode.params.length > 0) {
      return [];
    }

    // Check if closure body contains bare $ references
    const hasBareReference = containsBareReference(closureNode.body);

    if (hasBareReference) {
      return [
        {
          location: closureNode.span.start,
          severity: 'warning',
          code: 'CLOSURE_BARE_DOLLAR',
          message:
            'Bare $ in stored closure has ambiguous binding. Use explicit capture: $ => $item',
          context: extractContextLine(
            closureNode.span.start.line,
            context.source
          ),
          fix: null, // Cannot auto-fix safely - requires context understanding
        },
      ];
    }

    return [];
  },
};

/**
 * Check if a node tree contains bare $ variable references.
 * Uses visitNode for full AST traversal, detecting VariableNode with isPipeVar=true.
 */
function containsBareReference(node: ASTNode): boolean {
  let found = false;
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      if (n.type === 'Variable' && (n as VariableNode).isPipeVar) {
        found = true;
      }
    },
    exit() {},
  });
  return found;
}

// ============================================================
// CLOSURE_BRACES RULE
// ============================================================

/**
 * Enforces braces for complex closure bodies.
 * Simple expressions can use parentheses, but complex bodies need braces.
 *
 * Complex body criteria:
 * - Contains Block (multiple statements)
 * - Contains Conditional
 * - Contains loop constructs
 *
 * Simple bodies (parentheses OK):
 * - Single expression: |x|($x * 2)
 * - Single method chain: |s|($s.trim.lower)
 *
 * Complex bodies (braces required):
 * - Conditionals: |n| { ($n < 1) ? 1 ! ($n * $fact($n - 1)) }
 * - Multiple statements: |x| { $x => $y; $y * 2 }
 *
 * References:
 * - docs/guide-conventions.md:239-249
 */
export const CLOSURE_BRACES: ValidationRule = {
  code: 'CLOSURE_BRACES',
  category: 'closures',
  severity: 'info',
  nodeTypes: ['Closure'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const closureNode = node as ClosureNode;
    const body = closureNode.body;

    // Check if body is GroupedExpr containing complex content
    if (body.type === 'GroupedExpr') {
      const grouped = body as GroupedExprNode;
      const innerExpr = grouped.expression;

      // Navigate through PipeChain to find the actual content
      let content: ASTNode = innerExpr;
      if (innerExpr && innerExpr.type === 'PipeChain') {
        const head = innerExpr.head;
        // Check if head is PostfixExpr
        if (head && head.type === 'PostfixExpr') {
          content = head.primary;
        } else {
          content = head;
        }
      }

      // Check if the content is a conditional or loop
      const isComplex =
        content &&
        (content.type === 'Conditional' ||
          content.type === 'WhileLoop' ||
          content.type === 'DoWhileLoop');

      if (isComplex) {
        return [
          {
            location: closureNode.span.start,
            severity: 'info',
            code: 'CLOSURE_BRACES',
            message:
              'Use braces for complex closure bodies (conditionals, loops)',
            context: extractContextLine(
              closureNode.span.start.line,
              context.source
            ),
            fix: null, // Auto-fix would require AST reconstruction
          },
        ];
      }
    }

    return [];
  },
};

// ============================================================
// CLOSURE_LATE_BINDING RULE
// ============================================================

/**
 * Detects closures created in loops that may suffer from late binding issues.
 * When creating closures inside loops, variables are captured by reference,
 * not by value. This causes all closures to share the final loop value.
 *
 * Detection:
 * - Each loop body creates a Closure node
 * - Closure references loop variable ($) without explicit capture
 *
 * Solution: Explicit capture per iteration:
 *   [1, 2, 3] -> each {
 *     $ => $item
 *     || { $item }
 *   }
 *
 * References:
 * - docs/guide-conventions.md:251-261
 * - docs/topic-closures.md: Late binding section
 */
export const CLOSURE_LATE_BINDING: ValidationRule = {
  code: 'CLOSURE_LATE_BINDING',
  category: 'closures',
  severity: 'warning',
  nodeTypes: ['EachExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const eachNode = node as EachExprNode;
    const body = eachNode.body;

    // Check if body contains a closure creation
    const hasClosureCreation = containsClosureCreation(body);

    if (hasClosureCreation) {
      // Check if there's an explicit capture before the closure
      const hasExplicitCapture = containsExplicitCapture(body);

      if (!hasExplicitCapture) {
        return [
          {
            location: eachNode.span.start,
            severity: 'warning',
            code: 'CLOSURE_LATE_BINDING',
            message:
              'Capture loop variable explicitly for deferred closures: $ => $item',
            context: extractContextLine(
              eachNode.span.start.line,
              context.source
            ),
            fix: null, // Auto-fix would require AST reconstruction
          },
        ];
      }
    }

    return [];
  },
};

/**
 * Check if a node contains a closure creation (Closure node).
 * Uses visitNode for full AST traversal.
 */
function containsClosureCreation(node: ASTNode): boolean {
  let found = false;
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      if (n.type === 'Closure') {
        found = true;
      }
    },
    exit() {},
  });
  return found;
}

/**
 * Check if a Block node contains an explicit capture statement ($ => $name).
 * Uses visitNode for full AST traversal, detecting PipeChain nodes whose
 * head is bare $ and whose pipes include a Capture.
 */
function containsExplicitCapture(node: ASTNode): boolean {
  if (node.type !== 'Block') {
    return false;
  }

  let found = false;
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      if (n.type !== 'PipeChain') return;
      const chain = n as PipeChainNode;
      const head = chain.head;
      if (!head || head.type !== 'PostfixExpr') return;
      const postfix = head as PostfixExprNode;
      if (!postfix.primary || postfix.primary.type !== 'Variable') return;
      if (!(postfix.primary as VariableNode).isPipeVar) return;
      for (const pipe of chain.pipes) {
        if (pipe.type === 'Capture') {
          found = true;
        }
      }
    },
    exit() {},
  });
  return found;
}
