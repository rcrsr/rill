/**
 * Enforces space on both sides of operators.
 * Operators like +, -, ->, =>, ==, etc. should have spaces on both sides.
 * Detection extracts the operator's source-span text and checks for a
 * missing space immediately before or after the operator.
 */

import type {
  ASTNode,
  BinaryExprNode,
  PipeChainNode,
  SourceSpan,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  extractContextLine,
  extractSpanText,
  maskComments,
  maskStringLiterals,
} from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// SPACING CHECKS
// ============================================================

/**
 * Check if operator has proper spacing in source by scanning the masked
 * span text for the operator substring and testing the immediately
 * adjacent characters, rather than building a RegExp per node.
 */
function checkOperatorSpacing(
  operator: string,
  span: SourceSpan,
  source: string
): boolean {
  const text = maskComments(maskStringLiterals(extractSpanText(span, source)));

  let fromIndex = 0;
  let index = text.indexOf(operator, fromIndex);
  while (index !== -1) {
    const before = index > 0 ? text[index - 1] : undefined;
    const after = text[index + operator.length];
    const missingBefore = before !== undefined && !/\s/.test(before);
    const missingAfter = after !== undefined && !/\s/.test(after);
    if (missingBefore || missingAfter) {
      return true;
    }
    fromIndex = index + operator.length;
    index = text.indexOf(operator, fromIndex);
  }

  return false;
}

/** Check pipe operator spacing. */
function checkPipeSpacing(span: SourceSpan, source: string): boolean {
  return checkOperatorSpacing('->', span, source);
}

// ============================================================
// RULE
// ============================================================

export const spacingOperator: Rule = {
  code: 'SPACING_OPERATOR',
  nodeTypes: ['BinaryExpr', 'PipeChain'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (node.type === 'BinaryExpr') {
      const binaryNode = node as BinaryExprNode;
      const operator = binaryNode.op;

      if (checkOperatorSpacing(operator, binaryNode.span, context.source)) {
        diagnostics.push({
          code: 'SPACING_OPERATOR',
          message: `Operator '${operator}' should have spaces on both sides`,
          severity: 'info',
          location: binaryNode.span.start,
          context: extractContextLine(
            binaryNode.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    if (node.type === 'PipeChain') {
      const pipeNode = node as PipeChainNode;

      if (checkPipeSpacing(pipeNode.span, context.source)) {
        diagnostics.push({
          code: 'SPACING_OPERATOR',
          message: "Pipe operator '->' should have spaces on both sides",
          severity: 'info',
          location: pipeNode.span.start,
          context: extractContextLine(pipeNode.span.start.line, context.source),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

registeredRules.push(spacingOperator);
