/**
 * Warns on `#ATOM` literals whose name is not a runtime builtin. Unknown
 * names no longer resolve to `#R001`; they are plain atoms identified by
 * name, so this is a best-effort hint that the name may be a typo.
 */

import { BUILTIN_ATOMS } from '@rcrsr/rill';
import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

/**
 * Builtin atoms, read from core's exported list so the set cannot drift
 * from the runtime. Names are stored without the leading '#'.
 */
const BUILTIN_ATOM_SET: ReadonlySet<string> = new Set(BUILTIN_ATOMS);

export const atomUnregistered: Rule = {
  code: 'ATOM_UNREGISTERED',
  nodeTypes: ['AtomLiteral'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'AtomLiteral') return [];
    const atom = node;
    if (BUILTIN_ATOM_SET.has(atom.name)) return [];

    return [
      {
        location: atom.span.start,
        severity: 'warning',
        code: 'ATOM_UNREGISTERED',
        message: `Atom #${atom.name} is not a builtin atom; unknown names no longer resolve to #R001.`,
        context: extractContextLine(atom.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(atomUnregistered);
