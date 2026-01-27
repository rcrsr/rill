/**
 * Loop Convention Rules
 * Enforces conventions for while, do-while, and loop control flow.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  WhileLoopNode,
  DoWhileLoopNode,
  PipeChainNode,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Collect all variable captures (:> $name) in the given AST node.
 */
function collectCaptures(node: ASTNode, names: string[]): void {
  switch (node.type) {
    case 'Capture':
      names.push(`$${node.name}`);
      return;

    case 'Block':
      node.statements.forEach((stmt) => collectCaptures(stmt, names));
      return;

    case 'Statement':
      collectCaptures(node.expression, names);
      return;

    case 'AnnotatedStatement':
      collectCaptures(node.statement, names);
      return;

    case 'PipeChain':
      node.pipes.forEach((pipe) => collectCaptures(pipe as ASTNode, names));
      if (node.terminator && node.terminator.type === 'Capture')
        collectCaptures(node.terminator, names);
      return;

    case 'PostfixExpr':
      collectCaptures(node.primary, names);
      node.methods.forEach((method) => collectCaptures(method, names));
      return;

    case 'BinaryExpr':
      collectCaptures(node.left, names);
      collectCaptures(node.right, names);
      return;

    case 'UnaryExpr':
      collectCaptures(node.operand, names);
      return;

    case 'GroupedExpr':
      collectCaptures(node.expression, names);
      return;

    case 'Conditional':
      if (node.input) collectCaptures(node.input, names);
      if (node.condition) collectCaptures(node.condition, names);
      collectCaptures(node.thenBranch, names);
      if (node.elseBranch) collectCaptures(node.elseBranch, names);
      return;

    case 'WhileLoop':
    case 'DoWhileLoop':
      collectCaptures(node.body, names);
      return;

    default:
      return;
  }
}

/**
 * Collect all variable references ($name) in the given AST node.
 */
function collectVariableReferences(node: ASTNode, names: string[]): void {
  switch (node.type) {
    case 'Variable':
      // Add the variable name if it's not the pipe variable ($)
      if (!node.isPipeVar && node.name) {
        names.push(`$${node.name}`);
      }
      return;

    case 'Block':
      node.statements.forEach((stmt) => collectVariableReferences(stmt, names));
      return;

    case 'Statement':
      collectVariableReferences(node.expression, names);
      return;

    case 'AnnotatedStatement':
      collectVariableReferences(node.statement, names);
      return;

    case 'PipeChain':
      collectVariableReferences(node.head, names);
      node.pipes.forEach((pipe) =>
        collectVariableReferences(pipe as ASTNode, names)
      );
      if (node.terminator)
        collectVariableReferences(node.terminator as ASTNode, names);
      return;

    case 'PostfixExpr':
      collectVariableReferences(node.primary, names);
      node.methods.forEach((method) =>
        collectVariableReferences(method, names)
      );
      return;

    case 'BinaryExpr':
      collectVariableReferences(node.left, names);
      collectVariableReferences(node.right, names);
      return;

    case 'UnaryExpr':
      collectVariableReferences(node.operand, names);
      return;

    case 'GroupedExpr':
      collectVariableReferences(node.expression, names);
      return;

    case 'Conditional':
      if (node.input) collectVariableReferences(node.input, names);
      if (node.condition) collectVariableReferences(node.condition, names);
      collectVariableReferences(node.thenBranch, names);
      if (node.elseBranch) collectVariableReferences(node.elseBranch, names);
      return;

    case 'WhileLoop':
    case 'DoWhileLoop':
      collectVariableReferences(node.condition, names);
      collectVariableReferences(node.body, names);
      return;

    default:
      return;
  }
}

/**
 * Check if a loop body appears to be calling a retry function.
 * Simple heuristic: looks for function calls like attemptOperation() or retry().
 */
function callsRetryFunction(node: ASTNode): boolean {
  if (node.type === 'Block') {
    return node.statements.some((stmt) => callsRetryFunction(stmt));
  }

  if (node.type === 'Statement') {
    return callsRetryFunction(node.expression);
  }

  if (node.type === 'PipeChain') {
    const chain = node as PipeChainNode;
    const head = chain.head;

    // Check if head is a function call
    if (head.type === 'PostfixExpr') {
      const primary = head.primary;
      if (primary.type === 'HostCall' || primary.type === 'ClosureCall') {
        return true;
      }
    }
  }

  return false;
}

// ============================================================
// LOOP_ACCUMULATOR RULE
// ============================================================

/**
 * Validates that variables captured in loop bodies aren't referenced in conditions.
 *
 * In while and do-while loops, $ serves as the accumulator across iterations.
 * Variables captured inside the loop body exist only within that iteration, so
 * referencing them in the loop condition is a logic error - the condition will
 * always see undefined (or the outer scope variable if one exists).
 *
 * Error pattern (captured variable in condition):
 *   0 -> ($x < 5) @ {        # $x is undefined in condition
 *     $ :> $x
 *     $x + 1
 *   }
 *
 * Correct pattern ($ as accumulator):
 *   0 -> ($ < 5) @ { $ + 1 }
 *
 * Also correct (capture only used within iteration):
 *   0 -> ($ < 5) @ {
 *     $ :> $x
 *     log($x)                # $x only used in body, not condition
 *     $x + 1
 *   }
 *
 * References:
 * - docs/16_conventions.md:151-171
 */
export const LOOP_ACCUMULATOR: ValidationRule = {
  code: 'LOOP_ACCUMULATOR',
  category: 'loops',
  severity: 'info',
  nodeTypes: ['WhileLoop', 'DoWhileLoop'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const loop = node as WhileLoopNode | DoWhileLoopNode;

    // Collect all variable captures in loop body
    const capturedNames: string[] = [];
    collectCaptures(loop.body, capturedNames);

    if (capturedNames.length === 0) {
      return []; // No captures, no problem
    }

    // Collect all variable references in loop condition
    const conditionRefs: string[] = [];
    collectVariableReferences(loop.condition, conditionRefs);

    // Find captures that are referenced in the condition
    const capturedSet = new Set(capturedNames);
    const problematicVars = conditionRefs.filter((ref) => capturedSet.has(ref));

    if (problematicVars.length > 0) {
      const vars = [...new Set(problematicVars)].join(', ');
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'LOOP_ACCUMULATOR',
          message: `${vars} captured in loop body but referenced in condition; loop body variables reset each iteration`,
          context: extractContextLine(node.span.start.line, context.source),
          fix: null, // Complex fix - requires refactoring loop body
        },
      ];
    }

    return [];
  },
};

// ============================================================
// PREFER_DO_WHILE RULE
// ============================================================

/**
 * Suggests using do-while for retry patterns.
 *
 * Do-while is clearer for retry patterns where the body must run at least once:
 *
 * Good (do-while for retry):
 *   @ {
 *     attemptOperation()
 *   } ? (.contains("RETRY"))
 *
 * Less clear (while with separate first attempt):
 *   attemptOperation() :> $result
 *   $result -> .contains("RETRY") @ {
 *     attemptOperation()
 *   }
 *
 * This is informational - helps guide users to the clearer pattern.
 *
 * References:
 * - docs/16_conventions.md:173-186
 */
export const PREFER_DO_WHILE: ValidationRule = {
  code: 'PREFER_DO_WHILE',
  category: 'loops',
  severity: 'info',
  nodeTypes: ['WhileLoop'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const loop = node as WhileLoopNode;

    // Heuristic: if loop body appears to be calling a retry/attempt function,
    // suggest do-while
    if (callsRetryFunction(loop.body)) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'PREFER_DO_WHILE',
          message:
            'Consider do-while for retry patterns where body runs at least once: @ { body } ? (condition)',
          context: extractContextLine(node.span.start.line, context.source),
          fix: null, // Complex fix - requires restructuring to do-while
        },
      ];
    }

    return [];
  },
};

// ============================================================
// USE_EACH RULE
// ============================================================

/**
 * Suggests using each for collection iteration instead of while loops.
 *
 * When iterating over a collection, each is clearer and more idiomatic:
 *
 * Good (each for collection):
 *   $items -> each { process($) }
 *
 * Less clear (while loop):
 *   0 :> $i
 *   ($i < $items.len) @ {
 *     $items[$i] -> process()
 *     $i + 1
 *   }
 *
 * This is informational - while loops work, but each is clearer for collections.
 *
 * References:
 * - docs/16_conventions.md:188-196
 */
export const USE_EACH: ValidationRule = {
  code: 'USE_EACH',
  category: 'loops',
  severity: 'info',
  nodeTypes: ['WhileLoop'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const loop = node as WhileLoopNode;

    // Simple heuristic: if the condition or body appears to be doing array iteration
    const conditionStr = JSON.stringify(loop.condition);
    const bodyStr = JSON.stringify(loop.body);

    // Look for patterns like:
    // - field access to 'len' (array length checks)
    // - bracket access patterns with BracketAccess nodes in body
    const hasLenCheck = conditionStr.includes('"field":"len"');
    const hasBracketAccess = bodyStr.includes('"accessKind":"bracket"');

    if (hasLenCheck || hasBracketAccess) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'USE_EACH',
          message:
            "Use 'each' for collection iteration instead of while loops: collection -> each { body }",
          context: extractContextLine(node.span.start.line, context.source),
          fix: null, // Complex fix - requires restructuring to each
        },
      ];
    }

    return [];
  },
};
