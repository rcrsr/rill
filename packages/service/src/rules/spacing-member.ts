/**
 * Enforces no whitespace between a member-access dot and its field name.
 * Member access should read `$obj.field`, not `$obj. field` or `$obj .field`.
 *
 * The lexer and parser both accept the spaced forms: `.` is emitted as its
 * own token and the post-tokenize METHOD_NAME rewrite tests token adjacency,
 * not character adjacency. So a spaced dot parses and evaluates identically
 * to a tight one, and nothing else in the toolchain reports it. This rule is
 * the only signal, which is why it is formatting/info rather than an error.
 *
 * Only `accessChain` entries carrying a source span are checked. The block,
 * alternatives, and annotation field-access kinds have no span, so a spaced
 * dot in `.{block}`, `.(a || b)`, and `.^key` goes unreported.
 */

import type { ASTNode, FieldAccess, VariableNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  extractContextLine,
  extractSpanText,
  getSplitLines,
  isValidSpan,
} from './helpers.js';
import { registeredRules } from './rules-registry.js';

/** Field-access kinds whose span runs from the `.` through the name. */
type SpannedFieldAccess = Extract<FieldAccess, { span: unknown }>;

function hasSpan(access: FieldAccess): access is SpannedFieldAccess {
  return 'span' in access && isValidSpan(access.span);
}

/**
 * Text preceding the dot on its own line. Empty when the dot opens the line,
 * which is the idiomatic leading-dot continuation and must not be flagged.
 */
function textBeforeDotOnLine(
  line: number,
  column: number,
  source: string
): string {
  // getSplitLines, not source.split: helpers.ts memoizes the split precisely
  // because re-splitting per visited node made the engine superlinear.
  const sourceLine = getSplitLines(source)[line - 1];
  if (sourceLine === undefined) return '';
  return sourceLine.slice(0, column - 1);
}

export const spacingMember: Rule = {
  code: 'SPACING_MEMBER',
  nodeTypes: ['Variable'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const variableNode = node as VariableNode;

    // The `.?path` existence check is not part of accessChain: the parser
    // hangs its final field off existenceCheck, so checking accessChain
    // alone would silently skip every `.? field`.
    const accesses: FieldAccess[] = [
      ...variableNode.accessChain.filter(
        (a): a is FieldAccess =>
          !('accessKind' in a && a.accessKind === 'bracket')
      ),
      ...(variableNode.existenceCheck
        ? [variableNode.existenceCheck.finalAccess]
        : []),
    ];

    for (const fieldAccess of accesses) {
      if (!hasSpan(fieldAccess)) {
        continue;
      }

      const span = fieldAccess.span;
      // Span text starts at the `.` (or `.?`) and runs through the name.
      // Not masked for string literals: the dot and any whitespace after it
      // precede the name, so no literal can appear between them.
      const text = extractSpanText(span, context.source);
      const spaceAfterDot = /^\.\??[^\S\n]/.test(text);

      // A dot opening its own line is a continuation, not a spacing error.
      const before = textBeforeDotOnLine(
        span.start.line,
        span.start.column,
        context.source
      );
      const spaceBeforeDot = before.trim().length > 0 && /\s$/.test(before);

      if (!spaceAfterDot && !spaceBeforeDot) {
        continue;
      }

      const operator = text.startsWith('.?') ? '.?' : '.';
      const side = spaceAfterDot
        ? spaceBeforeDot
          ? 'No spaces around'
          : 'No space after'
        : 'No space before';

      diagnostics.push({
        code: 'SPACING_MEMBER',
        message: `${side} '${operator}': write '${text.replace(/\s+/g, '')}'`,
        severity: 'info',
        location: span.start,
        context: extractContextLine(span.start.line, context.source),
        fix: null,
      });
    }

    return diagnostics;
  },
};

registeredRules.push(spacingMember);
