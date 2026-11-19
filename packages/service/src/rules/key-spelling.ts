/**
 * Flags a number or boolean dict key. `dict[1: "n"]` stores the key `"1"`,
 * so it equals `dict["1": "n"]`; quoting the key states that spelling
 * directly. Covers dict, ordered, and dispatch-table literals, which share
 * one key rule.
 */

import { formatFieldKey } from '@rcrsr/rill';
import type { ASTNode, SourceLocation } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
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
      if (typeof entry.key !== 'string') continue;
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
