/**
 * Enforces space on both sides of operators.
 * Operators like +, -, ->, =>, ==, etc. should have spaces on both sides.
 * Detection extracts the operator's source-span text and checks for a
 * missing space immediately before or after the operator.
 */

import type {
  ASTNode,
  BinaryExprNode,
  CaptureNode,
  PipeChainNode,
  SourceSpan,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  escapeRegex,
  extractContextLine,
  extractSpanText,
  maskStringLiterals,
} from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// SPACING CHECKS
// ============================================================

/** Check if operator has proper spacing in source. */
function checkOperatorSpacing(
  operator: string,
  span: SourceSpan,
  source: string
): boolean {
  const text = maskStringLiterals(extractSpanText(span, source));

  const patterns = [
    new RegExp(`\\S${escapeRegex(operator)}`), // No space before
    new RegExp(`${escapeRegex(operator)}\\S`), // No space after
  ];

  return patterns.some((pattern) => pattern.test(text));
}

/** Check pipe operator spacing. */
function checkPipeSpacing(span: SourceSpan, source: string): boolean {
  const text = maskStringLiterals(extractSpanText(span, source));
  return /\S->/.test(text) || /->\S/.test(text);
}

/** Check capture operator spacing. */
function checkCaptureSpacing(span: SourceSpan, source: string): boolean {
  const text = maskStringLiterals(extractSpanText(span, source));
  return /\S=>/.test(text) || /=>\S/.test(text);
}

// ============================================================
// RULE
// ============================================================

export const spacingOperator: Rule = {
  code: 'SPACING_OPERATOR',
  nodeTypes: ['BinaryExpr', 'PipeChain', 'Capture'],
  defaultSeverity: 'info',

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

    if (node.type === 'Capture') {
      const captureNode = node as CaptureNode;

      // DEBT (drift tracking): this branch never fires. Assumption carried
      // over from the ported rill-cli source: CaptureNode.span spans the
      // `=>` operator itself, so checkCaptureSpacing's `\S=>` / `=>\S`
      // patterns could match adjacent-source whitespace violations. In the
      // current @rcrsr/rill core, CaptureNode.span no longer spans `=>`
      // (it covers the captured expression/target only), so the extracted
      // span text never contains the operator and the regexes cannot match.
      // Kept as a faithful, inert port to preserve rill-cli diagnostic
      // parity. Re-review if a future @rcrsr/rill core change alters
      // CaptureNode.span to include the `=>` token again.
      if (checkCaptureSpacing(captureNode.span, context.source)) {
        diagnostics.push({
          code: 'SPACING_OPERATOR',
          message: "Capture operator '=>' should have spaces on both sides",
          severity: 'info',
          location: captureNode.span.start,
          context: extractContextLine(
            captureNode.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

registeredRules.push(spacingOperator);
