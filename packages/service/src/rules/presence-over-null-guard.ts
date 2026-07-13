/**
 * Detects `($x == nil) ? fallback ! $x` and `($x != nil) ? $x ! fallback`
 * patterns. The default operator (`$x ?? fallback`) reads better and avoids
 * branching.
 */

import type {
  ASTNode,
  BinaryExprNode,
  ConditionalNode,
  GroupedExprNode,
  HostCallNode,
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
 * Peel a Conditional's condition down to its BinaryExpr head, if any.
 * Conditions parse as `BodyNode` (Block | GroupedExpr | PostfixExpr |
 * PipeChain). Handles the common ternary forms: bare PostfixExpr containing
 * a BinaryExpr (rare) and the typical GroupedExpr -> PipeChain -> BinaryExpr
 * shape from `($x == nil) ? ...`.
 */
function unwrapConditionToBinary(cond: ConditionalNode): BinaryExprNode | null {
  const expr = cond.condition;
  if (!expr) return null;

  let inner: ASTNode | null = expr;
  if (inner && inner.type === 'GroupedExpr') {
    inner = (inner as GroupedExprNode).expression;
  }
  if (inner && inner.type === 'PipeChain') {
    const chain = inner as PipeChainNode;
    if (chain.pipes.length !== 0) return null;
    inner = chain.head;
  }
  if (inner && inner.type === 'BinaryExpr') {
    return inner as BinaryExprNode;
  }
  return null;
}

/**
 * Return true when an arithmetic operand is the bareword `nil`. The parser
 * lowers `nil` to a zero-arg HostCall, wrapped in a PostfixExpr.
 */
function operandIsNil(operand: ASTNode | null | undefined): boolean {
  if (!operand) return false;
  if (operand.type !== 'PostfixExpr') return false;
  const postfix = operand as PostfixExprNode;
  if (postfix.methods.length !== 0) return false;
  const primary = postfix.primary;
  if (primary.type !== 'HostCall') return false;
  const call = primary as HostCallNode;
  return call.name === 'nil' && call.args.length === 0;
}

// ============================================================
// RULE
// ============================================================

export const presenceOverNullGuard: Rule = {
  code: 'PRESENCE_OVER_NULL_GUARD',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const cond = node as ConditionalNode;
    const binExpr = unwrapConditionToBinary(cond);
    if (!binExpr) return [];
    if (binExpr.op !== '==' && binExpr.op !== '!=') return [];
    if (!operandIsNil(binExpr.left) && !operandIsNil(binExpr.right)) return [];

    return [
      {
        code: 'PRESENCE_OVER_NULL_GUARD',
        message:
          'Nil-checking conditional. Prefer the default operator: $x ?? fallback.',
        severity: 'info',
        location: cond.span.start,
        context: extractContextLine(cond.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(presenceOverNullGuard);
