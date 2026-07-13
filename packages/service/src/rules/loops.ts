/**
 * Loop convention rules: enforces idioms for `while` and `do-while` loops.
 */

import type {
  ASTNode,
  DoWhileLoopNode,
  PipeChainNode,
  WhileLoopNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/** Collect all variable captures (=> $name) in the given AST node. */
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

/** Collect all variable references ($name) in the given AST node. */
function collectVariableReferences(node: ASTNode, names: string[]): void {
  switch (node.type) {
    case 'Variable':
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

export const loopAccumulator: Rule = {
  code: 'LOOP_ACCUMULATOR',
  nodeTypes: ['WhileLoop', 'DoWhileLoop'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const loop = node as WhileLoopNode | DoWhileLoopNode;

    const capturedNames: string[] = [];
    collectCaptures(loop.body, capturedNames);

    if (capturedNames.length === 0) {
      return [];
    }

    const conditionRefs: string[] = [];
    collectVariableReferences(loop.condition, conditionRefs);

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
          fix: null,
        },
      ];
    }

    return [];
  },
};

// ============================================================
// PREFER_DO_WHILE RULE
// ============================================================

export const preferDoWhile: Rule = {
  code: 'PREFER_DO_WHILE',
  nodeTypes: ['WhileLoop'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const loop = node as WhileLoopNode;

    if (callsRetryFunction(loop.body)) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'PREFER_DO_WHILE',
          message:
            'Consider do-while for retry patterns where body runs at least once: do { body } while (condition)',
          context: extractContextLine(node.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

// ============================================================
// USE_EACH RULE
// ============================================================

export const useEach: Rule = {
  code: 'USE_EACH',
  nodeTypes: ['WhileLoop'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const loop = node as WhileLoopNode;

    const conditionStr = JSON.stringify(loop.condition);
    const bodyStr = JSON.stringify(loop.body);

    const hasLenCheck = conditionStr.includes('"field":"len"');
    const hasBracketAccess = bodyStr.includes('"accessKind":"bracket"');

    if (hasLenCheck || hasBracketAccess) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'USE_EACH',
          message:
            "Use 'seq' for collection iteration instead of while loops: collection -> seq({ body })",
          context: extractContextLine(node.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(loopAccumulator, preferDoWhile, useEach);
