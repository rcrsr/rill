/**
 * Validates that negation in `filter` uses grouped form.
 *
 * Grouped negation is clearer and prevents bugs:
 * - Correct: filter({ !.empty })  -- grouped negation
 * - Wrong:   filter({ .empty })   -- filters for empty elements (likely bug)
 *
 * Only fires when the filter body is the bare method-shorthand `.empty`.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  getMethodName,
  isCollectionOpCall,
  isMethodShorthand,
  resolveOpBody,
} from './collection-ops.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const filterNegation: Rule = {
  code: 'FILTER_NEGATION',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'warning',
  category: 'collections',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];
    if (node.name !== 'filter') return [];

    const body = resolveOpBody(node);
    if (!body) return [];

    if (isMethodShorthand(body)) {
      const methodName = getMethodName(body);

      if (methodName === 'empty') {
        return [
          {
            code: 'FILTER_NEGATION',
            message: `Filter with '.${methodName}' likely unintended. Use grouped negation: 'filter({ !.${methodName} })' to filter non-${methodName} elements`,
            severity: 'warning',
            location: node.span.start,
            context: extractContextLine(node.span.start.line, context.source),
            fix: null,
          },
        ];
      }
    }

    return [];
  },
};

registeredRules.push(filterNegation);
