/**
 * Validates that break is not used in parallel operators (`fan`, `filter`).
 *
 * Break is semantically invalid in parallel execution contexts. It is
 * valid in sequential operators (`seq`, `acc`, `fold`).
 *
 * Error severity because this is semantically wrong, not just stylistic.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  containsBreak,
  isCollectionOpCall,
  isParallelOp,
  resolveOpBody,
} from './collection-ops.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const breakInParallel: Rule = {
  code: 'BREAK_IN_PARALLEL',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'error',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];
    if (!isParallelOp(node.name)) return [];

    const body = resolveOpBody(node);
    if (!body) return [];

    if (containsBreak(body)) {
      return [
        {
          code: 'BREAK_IN_PARALLEL',
          message: `Break not allowed in '${node.name}' (parallel operator). Use 'seq' for sequential iteration with break.`,
          severity: 'error',
          location: node.span.start,
          context: extractContextLine(node.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(breakInParallel);
