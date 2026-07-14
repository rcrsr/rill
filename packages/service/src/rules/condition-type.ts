/**
 * Validates that conditional conditions evaluate to boolean.
 *
 * Rill conditionals don't enforce boolean type checking at the static
 * analysis level; the language allows truthy/falsy semantics, and runtime
 * handles type errors. This rule is a stub, reserved for a future static
 * boolean-condition check.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { registeredRules } from './rules-registry.js';

export const conditionType: Rule = {
  code: 'CONDITION_TYPE',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'warning',
  stub: true,

  validate(_node: ASTNode, _context: RuleContext): Diagnostic[] {
    return [];
  },
};

registeredRules.push(conditionType);
