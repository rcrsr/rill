/**
 * Detects closures created inside sequential collection bodies that may
 * suffer from late binding issues. Closures capture variables by reference,
 * so all closures created in a loop body share the final iteration value
 * unless the loop variable is captured explicitly per iteration.
 *
 * Targets the sequential callables `seq` and `acc`. (`fan`/`filter` execute
 * in parallel, `fold` reduces to a single value, so late-binding pitfalls
 * are less common there.)
 */

import type {
  ASTNode,
  ClosureNode,
  HostCallNode,
  PipeChainNode,
  PostfixExprNode,
  VariableNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { traverseForRules } from './traversal.js';
import { getCollectionOpBody, isCollectionOpCall } from './collection-ops.js';

// ============================================================
// HELPERS
// ============================================================

/** Check if a node contains a closure creation (Closure node). */
function containsClosureCreation(node: ASTNode): boolean {
  let found = false;
  traverseForRules(node, {
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
 * Check if a Block node contains an explicit capture statement ($ => $name)
 * at the top level (closureDepth === 0). Captures inside nested closures
 * are scoped to that closure and do not fix late binding for the body.
 */
function containsExplicitCapture(node: ASTNode): boolean {
  if (node.type !== 'Block') {
    return false;
  }

  let found = false;
  let closureDepth = 0;
  traverseForRules(node, {
    enter(n: ASTNode) {
      if (n.type === 'Closure') {
        closureDepth++;
        return;
      }
      if (closureDepth > 0) return;
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
    exit(n: ASTNode) {
      if (n.type === 'Closure') {
        closureDepth--;
      }
    },
  });
  return found;
}

// ============================================================
// RULE
// ============================================================

export const closureLateBinding: Rule = {
  code: 'CLOSURE_LATE_BINDING',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];
    if (node.name !== 'seq' && node.name !== 'acc') return [];

    const opCall = node as HostCallNode;
    const arg = getCollectionOpBody(opCall);
    if (!arg) return [];

    const innerBody = arg.type === 'Closure' ? (arg as ClosureNode).body : arg;

    const hasClosureCreation = containsClosureCreation(innerBody);
    if (!hasClosureCreation) return [];

    const hasExplicitCapture = containsExplicitCapture(innerBody);
    if (hasExplicitCapture) return [];

    return [
      {
        code: 'CLOSURE_LATE_BINDING',
        message:
          'Capture loop variable explicitly for deferred closures: $ => $item',
        severity: 'warning',
        location: opCall.span.start,
        context: extractContextLine(opCall.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(closureLateBinding);
