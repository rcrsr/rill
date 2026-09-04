/**
 * Warns on `#ATOM` literals whose name is not a runtime builtin. Such atoms
 * must be registered by the host via `registerErrorCode` before use; the
 * lint cannot see host registrations, so this is a best-effort check.
 */

import type { ASTNode, AtomLiteralNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

/**
 * Atoms pre-registered by the runtime. This is a fixed 35-name snapshot
 * copied by hand from the runtime atom registry, not derived from it live.
 * Names are stored without the leading '#'.
 */
const BUILTIN_ATOMS: ReadonlySet<string> = new Set([
  'ok',
  'R001',
  'TIMEOUT',
  'AUTH',
  'FORBIDDEN',
  'RATE_LIMIT',
  'QUOTA_EXCEEDED',
  'UNAVAILABLE',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_INPUT',
  'PROTOCOL',
  'DISPOSED',
  'IGNORE',
  'R999',
  'TYPE_MISMATCH',
  'RILL_R016',
  'RILL_R002',
  'RILL_R003',
  'RILL_R010',
  'RILL_R036',
  'RILL_R037',
  'RILL_R038',
  'RILL_R040',
  'RILL_R041',
  'RILL_R042',
  'RILL_R044',
  'RILL_R054',
  'RILL_R055',
  'RILL_R056',
  'RILL_R057',
  'RILL_R058',
  'RILL_R061',
  'RILL_R082',
  'RILL_R083',
]);

export const atomUnregistered: Rule = {
  code: 'ATOM_UNREGISTERED',
  nodeTypes: ['AtomLiteral'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const atom = node as AtomLiteralNode;
    if (BUILTIN_ATOMS.has(atom.name)) return [];

    return [
      {
        location: atom.span.start,
        severity: 'warning',
        code: 'ATOM_UNREGISTERED',
        message: `Atom #${atom.name} is not a runtime builtin; ensure the host registers it via registerErrorCode.`,
        context: extractContextLine(atom.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(atomUnregistered);
