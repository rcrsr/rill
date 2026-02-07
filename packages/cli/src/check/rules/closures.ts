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
  BinaryExprNode,
  BlockNode,
  ClosureNode,
  ConditionalNode,
  GroupedExprNode,
  InterpolationNode,
  PipeChainNode,
  PostfixExprNode,
  StatementNode,
  StringLiteralNode,
  UnaryExprNode,
  VariableNode,
  EachExprNode,
} from '@rcrsr/rill';
import { extractContextLine } from './helpers.js';

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
 * Recursively walks the AST looking for VariableNode with isPipeVar=true.
 */
function containsBareReference(node: ASTNode): boolean {
  if (node.type === 'Variable') {
    const varNode = node as VariableNode;
    // $ is represented as isPipeVar: true with name: null
    if (varNode.isPipeVar) {
      return true;
    }
  }

  // Recursively check child nodes based on node type
  switch (node.type) {
    case 'Block': {
      const blockNode = node as BlockNode;
      for (const stmt of blockNode.statements) {
        if (containsBareReference(stmt)) return true;
      }
      break;
    }

    case 'Statement': {
      const stmtNode = node as StatementNode;
      if (stmtNode.expression && containsBareReference(stmtNode.expression))
        return true;
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as PipeChainNode;
      if (pipeNode.head && containsBareReference(pipeNode.head)) return true;
      if (pipeNode.pipes) {
        for (const pipe of pipeNode.pipes) {
          if (containsBareReference(pipe)) return true;
        }
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node as PostfixExprNode;
      if (postfixNode.primary && containsBareReference(postfixNode.primary))
        return true;
      if (postfixNode.methods) {
        for (const method of postfixNode.methods) {
          if (containsBareReference(method)) return true;
        }
      }
      break;
    }

    case 'BinaryExpr': {
      const binaryNode = node as BinaryExprNode;
      if (binaryNode.left && containsBareReference(binaryNode.left))
        return true;
      if (binaryNode.right && containsBareReference(binaryNode.right))
        return true;
      break;
    }

    case 'UnaryExpr': {
      const unaryNode = node as UnaryExprNode;
      if (unaryNode.operand && containsBareReference(unaryNode.operand))
        return true;
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node as GroupedExprNode;
      if (
        groupedNode.expression &&
        containsBareReference(groupedNode.expression)
      )
        return true;
      break;
    }

    case 'StringLiteral': {
      const stringNode = node as StringLiteralNode;
      if (stringNode.parts) {
        for (const part of stringNode.parts) {
          if (typeof part === 'object' && containsBareReference(part))
            return true;
        }
      }
      break;
    }

    case 'Interpolation': {
      const interpNode = node as InterpolationNode;
      if (interpNode.expression && containsBareReference(interpNode.expression))
        return true;
      break;
    }

    case 'Conditional': {
      const condNode = node as ConditionalNode;
      if (condNode.condition && containsBareReference(condNode.condition))
        return true;
      if (condNode.thenBranch && containsBareReference(condNode.thenBranch))
        return true;
      if (condNode.elseBranch && containsBareReference(condNode.elseBranch))
        return true;
      break;
    }

    case 'MethodCall':
    case 'HostCall':
    case 'ClosureCall':
    case 'Invoke': {
      const callNode = node as { args: ASTNode[] };
      if (callNode.args) {
        for (const arg of callNode.args) {
          if (containsBareReference(arg)) return true;
        }
      }
      break;
    }
  }

  return false;
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
 */
function containsClosureCreation(node: ASTNode): boolean {
  if (node.type === 'Closure') {
    return true;
  }

  // Recursively check child nodes
  switch (node.type) {
    case 'Block': {
      const blockNode = node as BlockNode;
      for (const stmt of blockNode.statements) {
        if (containsClosureCreation(stmt)) return true;
      }
      break;
    }

    case 'Statement': {
      const stmtNode = node as StatementNode;
      if (stmtNode.expression && containsClosureCreation(stmtNode.expression))
        return true;
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as PipeChainNode;
      if (pipeNode.head && containsClosureCreation(pipeNode.head)) return true;
      if (pipeNode.pipes) {
        for (const pipe of pipeNode.pipes) {
          if (containsClosureCreation(pipe)) return true;
        }
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node as PostfixExprNode;
      if (postfixNode.primary && containsClosureCreation(postfixNode.primary))
        return true;
      break;
    }
  }

  return false;
}

/**
 * Check if a Block node contains an explicit capture statement ($ => $name).
 */
function containsExplicitCapture(node: ASTNode): boolean {
  if (node.type !== 'Block') {
    return false;
  }

  const blockNode = node as BlockNode;
  const statements = blockNode.statements;

  // Look for capture of $ into a named variable
  for (const stmt of statements) {
    if (
      stmt.type === 'Statement' &&
      stmt.expression &&
      stmt.expression.type === 'PipeChain'
    ) {
      const chain = stmt.expression;

      // Check if any pipe is a Capture
      if (chain.pipes && Array.isArray(chain.pipes)) {
        for (const pipe of chain.pipes) {
          if (pipe.type === 'Capture') {
            // Check if the head is bare $
            const head = chain.head;
            if (head && head.type === 'PostfixExpr') {
              const postfix = head as PostfixExprNode;
              if (postfix.primary && postfix.primary.type === 'Variable') {
                const varNode = postfix.primary as VariableNode;
                if (varNode.isPipeVar) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  }

  return false;
}
