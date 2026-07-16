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
 * Check if a branch body references the bare pipe-variable `$`, reading the
 * precomputed `hasBareDollar` subtree fact rather than re-walking. This
 * fact is scoped to the branch's own body: a `$` nested inside a closure
 * literal or a collection-op body within the branch refers to that inner
 * scope's own iteration variable, not the piped value being classified
 * here, and is masked out accordingly (see facts.ts).
 */
function referencesBareDollar(
  context: RuleContext,
  node: BodyNode | null
): boolean {
  if (!node) return false;
  return context.facts.bySubtree.get(node)?.hasBareDollar ?? false;
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
  category: 'flow',

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

    const thenReferences = referencesBareDollar(
      context,
      conditional.thenBranch
    );
    const elseBranch = conditional.elseBranch;
    const elseReferences =
      elseBranch && elseBranch.type !== 'Conditional'
        ? referencesBareDollar(context, elseBranch)
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
