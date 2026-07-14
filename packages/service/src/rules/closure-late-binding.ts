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

import type { ASTNode, ClosureNode, HostCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { getCollectionOpBody, isCollectionOpCall } from './collection-ops.js';

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

    const hasClosureCreation =
      context.facts.bySubtree.get(innerBody)?.hasClosure === true;
    if (!hasClosureCreation) return [];

    const hasExplicitCapture =
      innerBody.type === 'Block' &&
      context.facts.bySubtree.get(innerBody)?.hasExplicitCapture === true;
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
