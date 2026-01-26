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
 * Check if a loop body contains variable captures.
 * Returns true if any captures are found in the body.
 */
function containsCaptures(node: ASTNode): boolean {
  switch (node.type) {
    case 'Capture':
      return true;

    case 'Block':
      return node.statements.some((stmt) => containsCaptures(stmt));

    case 'Statement':
      return containsCaptures(node.expression);

    case 'AnnotatedStatement':
      return containsCaptures(node.statement);

    case 'PipeChain':
      if (node.pipes.some((pipe) => containsCaptures(pipe as ASTNode)))
        return true;
      if (node.terminator && node.terminator.type === 'Capture') return true;
      return false;

    case 'PostfixExpr':
      if (containsCaptures(node.primary)) return true;
      return node.methods.some((method) => containsCaptures(method));

    case 'BinaryExpr':
      return containsCaptures(node.left) || containsCaptures(node.right);

    case 'UnaryExpr':
      return containsCaptures(node.operand);

    case 'GroupedExpr':
      return containsCaptures(node.expression);

    case 'Conditional':
      if (node.input && containsCaptures(node.input)) return true;
      if (node.condition && containsCaptures(node.condition)) return true;
      if (containsCaptures(node.thenBranch)) return true;
      if (node.elseBranch && containsCaptures(node.elseBranch)) return true;
      return false;

    case 'WhileLoop':
    case 'DoWhileLoop':
      return containsCaptures(node.body);

    default:
      return false;
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
 * Validates that $ is used as accumulator in while/do-while loops.
 *
 * In while and do-while loops, $ serves as the accumulator across iterations.
 * Variables captured inside the loop body exist only within that iteration.
 *
 * Good pattern ($ accumulates):
 *   0 -> ($ < 5) @ { $ + 1 }
 *
 * Avoid pattern (named variables don't persist):
 *   0 -> ($ < 5) @ {
 *     $ :> $x        # $x exists only in this iteration
 *     $x + 1
 *   }
 *
 * This is stylistic - both work, but $ is clearer for accumulation.
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

    // Check if loop body contains captures
    if (containsCaptures(loop.body)) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'LOOP_ACCUMULATOR',
          message:
            'Use $ as accumulator in while/do-while. Variables captured inside loop body exist only within that iteration.',
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
