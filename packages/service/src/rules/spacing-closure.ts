/**
 * Flags a removable space between an opening bracket and a closure's
 * opening pipe: `seq( |x| ...)` should be `seq(|x| ...)`.
 *
 * A ClosureNode.span begins at its first `|`, so the space cannot be seen
 * in the span text; the rule looks back into the source from the pipe.
 * It fires only when the run of whitespace before the `|` sits directly
 * after an opening bracket (`(` or `[`), where tightening the closure is
 * both idiomatic and safe. Whitespace that another rule requires or that
 * is idiomatic elsewhere is deliberately not flagged: a space after a
 * pipe/capture operator (`-> |x|`, `=> |x|`) is mandated by
 * SPACING_OPERATOR, and a space after an annotation, a comma, or inside a
 * block body carries no removable-space signal. Flagging those would put
 * SPACING_CLOSURE in direct conflict with idiomatic rill.
 */

import type { ASTNode, ClosureNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const spacingClosure: Rule = {
  code: 'SPACING_CLOSURE',
  nodeTypes: ['Closure'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const closureNode = node as ClosureNode;
    const source = context.source;
    const pipeOffset = closureNode.span.start.offset;

    let cursor = pipeOffset - 1;
    let sawWhitespace = false;
    while (cursor >= 0 && (source[cursor] === ' ' || source[cursor] === '\t')) {
      sawWhitespace = true;
      cursor -= 1;
    }
    const afterOpenBracket =
      cursor >= 0 && (source[cursor] === '(' || source[cursor] === '[');

    // Fire only when the space directly follows an opening bracket, where
    // it is removable without violating operator or delimiter spacing.
    if (sawWhitespace && afterOpenBracket) {
      diagnostics.push({
        code: 'SPACING_CLOSURE',
        message: 'No space before opening pipe in closure parameters',
        severity: 'info',
        location: closureNode.span.start,
        context: extractContextLine(
          closureNode.span.start.line,
          context.source
        ),
        fix: null,
      });
    }

    return diagnostics;
  },
};

registeredRules.push(spacingClosure);
