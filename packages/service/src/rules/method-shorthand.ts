/**
 * Suggests using method shorthand over block form in collection operators.
 *
 * Block-wrapping a single method call is verbose:
 * - Verbose:    fan({ $.upper() })
 * - Preferred:  fan(.upper)  -- when supported
 *
 * Informational - both forms work identically.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  getMethodName,
  isBlockWrappingMethod,
  isCollectionOpCall,
  resolveOpBody,
} from './collection-ops.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const methodShorthand: Rule = {
  code: 'METHOD_SHORTHAND',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];

    const body = resolveOpBody(node);
    if (!body) return [];

    if (isBlockWrappingMethod(body)) {
      const methodName = getMethodName(body);

      if (methodName) {
        return [
          {
            code: 'METHOD_SHORTHAND',
            message: `Prefer method shorthand '.${methodName}' over block form '{ $.${methodName}() }'`,
            severity: 'info',
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

registeredRules.push(methodShorthand);
