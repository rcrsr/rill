/**
 * Flags a `.^type` read on a value declared with a union, or with a
 * collection whose element or field type holds one. `.^type` reports the
 * declared type there, not the value's own type; `.^effective` reports the
 * latter. Receivers are known only from the static type: a direct `expr:T`, a
 * declaration, a pass-through pipe step, or a variable bound once with a
 * declared type. Computed results, element reads and undeclared values stay
 * silent. The fix rewrites the key to `effective`.
 */

import { formatTypeRef } from '@rcrsr/rill';
import type { ASTNode, TypeRef } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { advancePosition, extractContextLine } from './helpers.js';
import { collectProbeReads } from './probe-reads.js';
import type { ProbeRead } from './probe-reads.js';
import { registeredRules } from './rules-registry.js';
import {
  hasUnionPart,
  isPassThroughStep,
  staticTypeOf,
  typeAfterStep,
} from './static-type.js';

// ============================================================
// CONSTANTS
// ============================================================

const READ_KEYS: ReadonlySet<string> = new Set(['type']);
const KEY_TEXT = '^type';

// ============================================================
// RECEIVER TYPE
// ============================================================

/** The declared type of the value a read applies to, or null when unknown. */
function declaredTypeOf(read: ProbeRead, context: RuleContext): TypeRef | null {
  const { receiver, stage } = read;
  const own =
    typeof receiver === 'string'
      ? (context.facts.script.declaredTypes.get(receiver) ?? null)
      : staticTypeOf(receiver, context);
  if (stage === null) return own;
  if (typeof stage === 'string' || !isPassThroughStep(stage)) return null;
  return typeAfterStep(own, stage, context);
}

// ============================================================
// DIAGNOSTICS
// ============================================================

/** Fix replacing the `type` key of the read at `at` with `effective`, or null when it is not found. */
function buildFix(
  at: ASTNode['span']['start'],
  context: RuleContext
): Diagnostic['fix'] {
  const caret = context.source.indexOf(KEY_TEXT, at.offset);
  if (caret < 0) return null;
  const start = advancePosition(at, context.source, caret + 1);
  const end = advancePosition(start, context.source, caret + 5);
  return {
    description: 'Read .^effective for the value’s own type',
    applicable: true,
    range: { start, end },
    replacement: 'effective',
  };
}

function report(
  read: ProbeRead,
  declared: TypeRef,
  context: RuleContext
): Diagnostic {
  return {
    location: read.at,
    severity: 'info',
    code: 'DECLARED_TYPE_PROBE',
    message: `This value is declared ${formatTypeRef(declared)}, so .^type reports that declared type, not the value's own type. Use .^effective for the value's own type.`,
    context: extractContextLine(read.at.line, context.source),
    fix: buildFix(read.at, context),
  };
}

// ============================================================
// RULE
// ============================================================

export const declaredTypeProbe: Rule = {
  code: 'DECLARED_TYPE_PROBE',
  nodeTypes: ['PipeChain', 'PostfixExpr', 'Variable'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const read of collectProbeReads(node, READ_KEYS)) {
      const declared = declaredTypeOf(read, context);
      if (declared !== null && hasUnionPart(declared)) {
        diagnostics.push(report(read, declared, context));
      }
    }
    return diagnostics;
  },
};

registeredRules.push(declaredTypeProbe);
