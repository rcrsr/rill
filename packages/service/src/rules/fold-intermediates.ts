/**
 * Suggests `fold` for final-only results, `acc` for running totals.
 *
 * - `fold(init, {body})` returns final accumulated value only
 * - `acc(init, {body})` returns list of all intermediate results
 *
 * Informational placeholder - real implementation requires flow analysis.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { registeredRules } from './rules-registry.js';

export const foldIntermediates: Rule = {
  code: 'FOLD_INTERMEDIATES',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',
  stub: true,

  validate(_node: ASTNode, _context: RuleContext): Diagnostic[] {
    // Reserved for future flow-analysis on seq/fold/acc.
    return [];
  },
};

registeredRules.push(foldIntermediates);
