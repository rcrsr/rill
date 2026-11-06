/**
 * Warns on variable reassignment.
 * Variables lock to their first type, and reassignment suggests confusing
 * flow control. Prefer functional style or new variables.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { isVariableInParentScope } from './scope-helpers.js';

export const avoidReassignment: Rule = {
  code: 'AVOID_REASSIGNMENT',
  nodeTypes: ['Capture'],
  defaultSeverity: 'warning',
  category: 'anti-patterns',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'Capture') return [];
    const captureNode = node;
    const varName = captureNode.name;

    const firstLocation = context.variables.get(varName);
    if (firstLocation !== undefined) {
      const variableScope = context.variableScopes.get(varName) ?? null;

      const currentClosureScope = context.scopeStack.at(-1) ?? null;

      const isInSameOrParentScope = isVariableInParentScope(
        variableScope,
        currentClosureScope,
        context.scopeStack
      );

      if (isInSameOrParentScope) {
        return [
          {
            code: 'AVOID_REASSIGNMENT',
            message: `Variable reassignment detected: '$${varName}' first defined at line ${firstLocation.line}. Prefer new variable or functional style.`,
            severity: 'warning',
            location: captureNode.span.start,
            context: extractContextLine(
              captureNode.span.start.line,
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

registeredRules.push(avoidReassignment);
