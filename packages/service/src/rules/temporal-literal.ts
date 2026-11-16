/**
 * Flags `duration("...")` and `datetime("...")` calls whose bare string
 * literal argument cannot parse, so the call is certain to halt at runtime
 * with `#INVALID_INPUT`. Parsing is delegated to the runtime's own pure
 * parsers (`parseDurationText`, `parseIsoDatetime`), so the rule cannot
 * drift from what the constructors accept.
 *
 * Only a first argument that is a plain string literal with no
 * interpolation is checked; any other argument is unknowable statically
 * and stays silent.
 */

import { parseDurationText, parseIsoDatetime } from '@rcrsr/rill';
import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// CONSTRUCTOR TABLE
// ============================================================

/** Returns a failure message for unparseable text, or undefined when valid. */
type TextCheck = (text: string) => string | undefined;

const TEMPORAL_CHECKS: ReadonlyMap<string, TextCheck> = new Map([
  [
    'duration',
    (text) =>
      parseDurationText(text) === undefined
        ? `duration() cannot parse "${text}"`
        : undefined,
  ],
  [
    'datetime',
    (text) => {
      const parsed = parseIsoDatetime(text);
      return typeof parsed === 'number' ? undefined : parsed.message;
    },
  ],
]);

// ============================================================
// RULE
// ============================================================

export const temporalLiteral: Rule = {
  code: 'TEMPORAL_LITERAL',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'HostCall') return [];
    const check = TEMPORAL_CHECKS.get(node.name);
    const first = node.args[0];
    if (check === undefined || first === undefined) return [];

    const arg = unwrapBareLiteral(first);
    if (arg.type !== 'StringLiteral') return [];
    if (!arg.parts.every((part) => typeof part === 'string')) return [];

    const message = check(arg.parts.join(''));
    if (message === undefined) return [];

    return [
      {
        code: 'TEMPORAL_LITERAL',
        message: `${message}; the call halts with #INVALID_INPUT.`,
        severity: 'warning',
        location: arg.span.start,
        context: extractContextLine(arg.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(temporalLiteral);
