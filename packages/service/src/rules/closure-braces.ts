/**
 * Enforces braces for complex closure bodies. A grouped-expression body
 * (`|x| (...)`) that wraps a conditional, loop, guard, or retry is hard to
 * scan; braces make control flow visually explicit.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const closureBraces: Rule = {
  code: 'CLOSURE_BRACES',
  nodeTypes: ['Closure'],
  defaultSeverity: 'info',
  category: 'closures',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'Closure') return [];
    const closureNode = node;
    const body = closureNode.body;

    if (body.type === 'GroupedExpr') {
      const grouped = body;
      const innerExpr = grouped.expression;

      let content: ASTNode = innerExpr;
      if (innerExpr.type === 'PipeChain') {
        const head = innerExpr.head;
        if (head.type === 'PostfixExpr') {
          content = head.primary;
        } else {
          content = head;
        }
      }

      const isComplex =
        content.type === 'Conditional' ||
        content.type === 'WhileLoop' ||
        content.type === 'DoWhileLoop' ||
        content.type === 'GuardBlock' ||
        content.type === 'RetryBlock';

      if (isComplex) {
        return [
          {
            code: 'CLOSURE_BRACES',
            message:
              'Use braces for complex closure bodies (conditionals, loops)',
            severity: 'info',
            location: closureNode.span.start,
            context: extractContextLine(
              closureNode.span.start.line,
              context.source
            ),
            fix: null,
          },
        ];
      }
    }

    return [];
  },
};

registeredRules.push(closureBraces);
