/**
 * Recommends type assertions for external input validation.
 * External inputs (from host functions, user input, parsed data) should be
 * validated with type assertions to ensure type safety.
 *
 * This is an informational rule - not all external data needs assertions,
 * but it's a good practice for critical paths.
 */

import type { ASTNode, HostCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const validateExternal: Rule = {
  code: 'VALIDATE_EXTERNAL',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const hostCallNode = node as HostCallNode;
    const functionName = hostCallNode.name;

    // Skip namespaced functions (ns::func) - these are trusted host APIs.
    if (functionName.includes('::')) {
      return [];
    }

    // Check if this is a parsing or external data function.
    const isExternalDataFunction =
      functionName.includes('fetch') ||
      functionName.includes('read') ||
      functionName.includes('load');

    if (!isExternalDataFunction) {
      return [];
    }

    // Skip if this HostCall is already wrapped in a TypeAssertion.
    if (context.assertedHostCalls.has(node)) {
      return [];
    }

    return [
      {
        code: 'VALIDATE_EXTERNAL',
        message: `Consider validating external input with type assertion: ${functionName}():type`,
        severity: 'info',
        location: hostCallNode.span.start,
        context: extractContextLine(
          hostCallNode.span.start.line,
          context.source
        ),
        fix: null,
      },
    ];
  },
};

registeredRules.push(validateExternal);
