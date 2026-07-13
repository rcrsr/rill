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
 * Atoms pre-registered by the runtime. This is a fixed snapshot copied from
 * the runtime atom registry, not derived from it live. Names are stored
 * without the leading '#'.
 */
const BUILTIN_ATOMS: ReadonlySet<string> = new Set([
  'ok',
  'R001',
  'R999',
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
  'TYPE_MISMATCH',
]);

export const atomUnregistered: Rule = {
  code: 'ATOM_UNREGISTERED',
  nodeTypes: ['AtomLiteral'],
  defaultSeverity: 'warning',

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
