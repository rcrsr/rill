/**
 * Warns on `#ATOM` literals whose name is not a runtime builtin. Such atoms
 * must be registered by the host via `registerErrorCode` before use; the
 * lint cannot see host registrations, so this is a best-effort check.
 */

import { BUILTIN_ATOMS } from '@rcrsr/rill';
import type { ASTNode, AtomLiteralNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

/**
 * Atoms pre-registered by the runtime, read from core's exported snapshot
 * so the set cannot drift from the registry. Host `registerErrorCode`
 * registrations are not included. Names are stored without the leading '#'.
 */
const BUILTIN_ATOM_SET: ReadonlySet<string> = new Set(BUILTIN_ATOMS);

export const atomUnregistered: Rule = {
  code: 'ATOM_UNREGISTERED',
  nodeTypes: ['AtomLiteral'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const atom = node as AtomLiteralNode;
    if (BUILTIN_ATOM_SET.has(atom.name)) return [];

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
