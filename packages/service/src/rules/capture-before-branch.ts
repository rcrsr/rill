/**
 * Suggests capturing a value before a conditional when the piped value is
 * referenced in both branches. Repeating a bare $ reference in both the
 * then- and else-branch is a signal the underlying expression should be
 * captured once, ahead of the branch, rather than re-derived twice.
 */

import type {
  ASTNode,
  BodyNode,
  ConditionalNode,
  PipeChainNode,
  PostfixExprNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if a node contains a variable reference.
 * For $ (pipe variable), checks for isPipeVar: true. For named variables,
 * checks for the variable name. This is a heuristic string-scan over the
 * serialized subtree, not a regex, so it stays linear in subtree size.
 */
function referencesVariable(node: BodyNode | null, varName: string): boolean {
  if (!node) return false;

  const nodeStr = JSON.stringify(node);

  if (varName === '$') {
    return nodeStr.includes('"isPipeVar":true');
  }
  return nodeStr.includes(`"name":"${varName}"`);
}

/**
 * Get the primary expression from a PipeChain's head.
 * ArithHead can be BinaryExprNode, UnaryExprNode, or PostfixExprNode.
 */
function getPrimaryFromHead(chain: PipeChainNode): ASTNode | null {
  const head = chain.head;

  if (head.type === 'PostfixExpr') {
    return (head as PostfixExprNode).primary;
  }

  return null;
}

// ============================================================
// RULE
// ============================================================

export const captureBeforeBranch: Rule = {
  code: 'CAPTURE_BEFORE_BRANCH',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const conditional = node as ConditionalNode;

    if (!conditional.elseBranch) {
      return [];
    }

    const inputExpr = conditional.input;

    // If input exists and is already a simple variable, no need to capture.
    if (inputExpr && inputExpr.type === 'PipeChain') {
      const headPrimary = getPrimaryFromHead(inputExpr);
      if (
        headPrimary &&
        headPrimary.type === 'Variable' &&
        inputExpr.pipes.length === 0 &&
        !inputExpr.terminator
      ) {
        return [];
      }
    }

    const thenReferences = referencesVariable(conditional.thenBranch, '$');
    const elseBranch = conditional.elseBranch;
    const elseReferences =
      elseBranch && elseBranch.type !== 'Conditional'
        ? referencesVariable(elseBranch, '$')
        : false;

    if (thenReferences && elseReferences) {
      return [
        {
          code: 'CAPTURE_BEFORE_BRANCH',
          message:
            'Consider capturing value before conditional when used in multiple branches',
          severity: 'info',
          location: conditional.span.start,
          context: extractContextLine(
            conditional.span.start.line,
            context.source
          ),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(captureBeforeBranch);
