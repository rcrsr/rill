/**
 * Suggests using ?? for defaults instead of verbose conditionals. The `??`
 * operator is more concise than a conditional that branches on an existence
 * check just to pick between the checked value and a fallback.
 *
 * Fires only on the exact shape ?? can express: the condition is an
 * existence check on `X.field` (optionally negated with `!`), the branch
 * taken when the field exists resolves to that same `X.field`, and the
 * branch taken when it does not is a distinct fallback expression. A
 * conditional that merely contains a `.?field` check somewhere in its
 * condition, without the branches mirroring the checked path, is not this
 * pattern and must not fire.
 */

import type {
  ASTNode,
  BodyNode,
  ConditionalNode,
  GroupedExprNode,
  PipeChainNode,
  PostfixExprNode,
  PropertyAccess,
  UnaryExprNode,
  VariableNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Peel a body/condition expression down to its pipe-chain head, unwrapping
 * a single layer of grouping parens and a headless pipe chain (no pipes, no
 * terminator). Conditions and branches parse as `BodyNode` (Block |
 * GroupedExpr | PostfixExpr | PipeChain); the canonical existence-check
 * pattern only ever produces the GroupedExpr and bare PostfixExpr shapes,
 * so anything else (a genuine pipe, a block with statements) is left as-is
 * and rejected by the caller's type check.
 */
function unwrapToHead(node: ASTNode): ASTNode {
  let inner: ASTNode = node;
  if (inner.type === 'GroupedExpr') {
    inner = (inner as GroupedExprNode).expression;
  }
  if (inner.type === 'PipeChain') {
    const chain = inner as PipeChainNode;
    if (chain.pipes.length !== 0 || chain.terminator !== null) {
      return inner;
    }
    inner = chain.head;
  }
  return inner;
}

/**
 * Structural equality for a chain of property accesses, ignoring source
 * spans (which differ between the condition's occurrence and the branch's
 * occurrence even when the path they describe is identical).
 */
function accessChainsEqual(a: PropertyAccess[], b: PropertyAccess[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(stripSpans(a)) === JSON.stringify(stripSpans(b));
}

function stripSpans(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSpans);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'span') continue;
      out[key] = stripSpans(val);
    }
    return out;
  }
  return value;
}

/**
 * Match a condition against `X.?field` or `!X.?field`: a bare variable
 * reference (no method calls) whose `existenceCheck` is set. Returns the
 * checked variable and whether the check was negated, or null if the
 * condition is not exactly this shape.
 */
function matchExistenceCheck(
  condition: BodyNode | null
): { negated: boolean; variable: VariableNode } | null {
  if (!condition) return null;

  let target = unwrapToHead(condition);
  let negated = false;
  if (target.type === 'UnaryExpr') {
    const unary = target as UnaryExprNode;
    if (unary.op !== '!') return null;
    negated = true;
    target = unary.operand;
  }

  if (target.type !== 'PostfixExpr') return null;
  const postfix = target as PostfixExprNode;
  if (postfix.methods.length !== 0) return null;
  if (postfix.primary.type !== 'Variable') return null;

  const variable = postfix.primary as VariableNode;
  if (variable.existenceCheck === null) return null;
  if (variable.existenceCheck.typeRef !== null) return null;
  if (variable.defaultValue !== null) return null;

  return { negated, variable };
}

/**
 * Match a branch against a bare variable reference (no method calls, no
 * existence check, no default value). Returns the variable node, or null
 * if the branch is anything else (a literal, a call chain, a block).
 */
function matchVariableReference(body: BodyNode): VariableNode | null {
  const head = unwrapToHead(body);
  if (head.type !== 'PostfixExpr') return null;

  const postfix = head as PostfixExprNode;
  if (postfix.methods.length !== 0) return null;
  if (postfix.defaultValue !== null) return null;
  if (postfix.primary.type !== 'Variable') return null;

  const variable = postfix.primary as VariableNode;
  if (variable.existenceCheck !== null) return null;
  if (variable.defaultValue !== null) return null;

  return variable;
}

/** True when two variable references name the same base variable. */
function sameBaseVariable(a: VariableNode, b: VariableNode): boolean {
  return a.isPipeVar === b.isPipeVar && a.name === b.name;
}

/**
 * Check if a conditional is using the ?? pattern with a `.?field` check.
 * Canonical shape: $dict.?field ? $dict.field ! "default"
 * This should be simplified to: $dict.field ?? "default"
 *
 * Requires the condition to be exactly an existence check on `X.field`
 * (optionally negated), the branch taken when the field exists to resolve
 * to that same `X.field`, and the fallback branch to be a distinct
 * expression rather than the same path.
 */
function isVerboseDefaultPattern(node: ConditionalNode): boolean {
  if (node.elseBranch === null) return false;
  if (node.elseBranch.type === 'Conditional') return false;

  const match = matchExistenceCheck(node.condition);
  if (!match) return false;

  const checkedPath: PropertyAccess[] = [
    ...match.variable.accessChain,
    match.variable.existenceCheck!.finalAccess,
  ];

  const resolvedBranch = match.negated ? node.elseBranch : node.thenBranch;
  const fallbackBranch = match.negated ? node.thenBranch : node.elseBranch;

  const resolvedVar = matchVariableReference(resolvedBranch);
  if (!resolvedVar) return false;
  if (!sameBaseVariable(resolvedVar, match.variable)) return false;
  if (!accessChainsEqual(resolvedVar.accessChain, checkedPath)) return false;

  // The fallback must be a distinct expression, not the same checked path
  // (which would make both branches resolve to the same value).
  const fallbackVar = matchVariableReference(fallbackBranch);
  if (
    fallbackVar &&
    sameBaseVariable(fallbackVar, match.variable) &&
    accessChainsEqual(fallbackVar.accessChain, checkedPath)
  ) {
    return false;
  }

  return true;
}

// ============================================================
// RULE
// ============================================================

export const useDefaultOperator: Rule = {
  code: 'USE_DEFAULT_OPERATOR',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',
  category: 'conditionals',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const conditional = node as ConditionalNode;

    if (isVerboseDefaultPattern(conditional)) {
      return [
        {
          code: 'USE_DEFAULT_OPERATOR',
          message:
            'Use ?? for defaults instead of conditionals: $dict.field ?? "default"',
          severity: 'info',
          location: node.span.start,
          context: extractContextLine(node.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(useDefaultOperator);
