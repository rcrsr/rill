/**
 * Suggests using `fan` over `seq` when no side effects are present.
 *
 * `fan` is semantically clearer for pure transformations: it signals no
 * side effects and may execute in parallel.
 *
 * Detects `seq` calls whose closure body contains no side-effecting
 * operations (host calls, closure calls).
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { isCollectionOpCall, resolveOpBody } from './collection-ops.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const preferMap: Rule = {
  code: 'PREFER_MAP',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];
    if (node.name !== 'seq') return [];

    const body = resolveOpBody(node);
    if (!body) return [];

    if (context.facts.bySubtree.get(body)?.hasSideEffect === true) {
      return [];
    }

    return [
      {
        code: 'PREFER_MAP',
        message:
          "Consider using 'fan' instead of 'seq' for pure transformations (no side effects)",
        severity: 'info',
        location: node.span.start,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(preferMap);
