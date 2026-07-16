/**
 * Detects `Conditional` nodes whose condition inspects a `.!` status probe.
 * Branching on `.!code == #TIMEOUT` is the manual try/catch shape; wrapping
 * the fallible call in `guard<on: list[#TIMEOUT]> { ... }` is the idiomatic
 * form.
 */

import type { ASTNode, ConditionalNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const guardOverTryCatch: Rule = {
  code: 'GUARD_OVER_TRY_CATCH',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const cond = node as ConditionalNode;
    if (!cond.condition) return [];
    if (context.facts.bySubtree.get(cond.condition)?.hasStatusProbe !== true)
      return [];

    return [
      {
        code: 'GUARD_OVER_TRY_CATCH',
        message:
          'Branching on .! is manual try/catch. Wrap the fallible call in guard<on: list[#X]> { ... }.',
        severity: 'info',
        location: cond.span.start,
        context: extractContextLine(cond.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(guardOverTryCatch);
