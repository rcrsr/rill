/**
 * Enforces no inner spaces for indexing brackets.
 * Array/dict indexing should use $var[0] not $var[ 0 ].
 *
 * KNOWN QUIRK (ported verbatim from the rill-cli source): the rule defines
 * a `fix()` method, but `validate()` never wires it into the emitted
 * diagnostic. Every diagnostic below carries `fix: null` even though a fix
 * could be computed. This is a dead-code path in the source rule, not an
 * omission here.
 */

import type {
  ASTNode,
  BracketAccess,
  PostfixExprNode,
  VariableNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  extractContextLine,
  extractSpanText,
  isValidSpan,
  maskStringLiterals,
} from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const spacingBrackets: Rule = {
  code: 'SPACING_BRACKETS',
  nodeTypes: ['PostfixExpr'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const postfixNode = node as PostfixExprNode;

    // Only process if primary is a Variable (contains accessChain).
    if (postfixNode.primary.type !== 'Variable') {
      return diagnostics;
    }

    const variableNode = postfixNode.primary as VariableNode;

    for (const access of variableNode.accessChain) {
      if (!('accessKind' in access) || access.accessKind !== 'bracket') {
        continue;
      }

      const bracketAccess = access as BracketAccess;

      if (!isValidSpan(bracketAccess.span)) {
        continue;
      }

      const text = extractSpanText(bracketAccess.span, context.source);
      const maskedText = maskStringLiterals(text);

      const hasSpaceAfterOpen = /\[\s/.test(maskedText);
      const hasSpaceBeforeClose = /\s\]/.test(maskedText);

      if (hasSpaceAfterOpen || hasSpaceBeforeClose) {
        const content = text.substring(1, text.length - 1).trim();

        diagnostics.push({
          code: 'SPACING_BRACKETS',
          message: `No spaces inside brackets: remove spaces around ${content}`,
          severity: 'info',
          location: bracketAccess.span.start,
          context: extractContextLine(
            bracketAccess.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

registeredRules.push(spacingBrackets);
