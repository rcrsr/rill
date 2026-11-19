/**
 * Flags a number or boolean dict key. `dict[1: "n"]` stores the key `"1"`,
 * so it equals `dict["1": "n"]`; quoting the key states that spelling
 * directly. Covers dict, ordered, and dispatch-table literals, which share
 * one key rule. A number or bool inside a multi-key list key is not stored
 * as a string spelling: it halts, so it is reported with that outcome.
 */

import { formatFieldKey } from '@rcrsr/rill';
import type { ASTNode, SourceLocation } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { scalarLiteralKind } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

export const dictKeySpelling: Rule = {
  code: 'DICT_KEY_SPELLING',
  nodeTypes: ['Dict', 'DictLiteral', 'OrderedLiteral'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (
      node.type !== 'Dict' &&
      node.type !== 'DictLiteral' &&
      node.type !== 'OrderedLiteral'
    ) {
      return [];
    }
    const diagnostics: Diagnostic[] = [];
    for (const entry of node.entries) {
      if (typeof entry.key !== 'string') {
        if (!('elements' in entry.key)) continue;
        for (const element of entry.key.elements) {
          const kind = scalarLiteralKind(element);
          if (kind !== 'number' && kind !== 'bool') continue;
          const at: SourceLocation = element.span.start;
          diagnostics.push({
            location: at,
            severity: 'info',
            code: 'DICT_KEY_SPELLING',
            message: `A multi-key list key takes strings, but this element is a ${kind}, so the literal halts RILL-R002. Quote it.`,
            context: extractContextLine(at.line, context.source),
            fix: null,
          });
        }
        continue;
      }
      if (entry.keyForm !== 'number' && entry.keyForm !== 'bool') continue;
      const location: SourceLocation = entry.span.start;
      diagnostics.push({
        location,
        severity: 'info',
        code: 'DICT_KEY_SPELLING',
        message: `Key ${entry.key} is stored as the string ${formatFieldKey(entry.key)}. Quote it to write that spelling directly.`,
        context: extractContextLine(location.line, context.source),
        fix: null,
      });
    }
    return diagnostics;
  },
};

registeredRules.push(dictKeySpelling);
