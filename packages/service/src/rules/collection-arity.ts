/**
 * Flags a collection operator whose function argument cannot take the
 * arguments the operator passes it. `seq`, `fan`, `filter`, and `sort` pass
 * the element alone, so their function takes exactly one argument. `fold` and
 * `acc` pass the element and the accumulator, so theirs takes exactly two.
 * A block argument counts its params by the unnamed params it reads; an fn
 * literal counts its declared params. This is the static analogue of the
 * runtime arity halts: too few params halts RILL-R045, a surplus required
 * param halts RILL-R044. An argument that is not a block or an fn literal
 * stays silent.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import {
  functionArgumentArity,
  isArityOpCall,
  opArity,
} from './collection-ops.js';
import { registeredRules } from './rules-registry.js';

function plural(count: number): string {
  return count === 1 ? '1 argument' : `${count} arguments`;
}

export const collectionArity: Rule = {
  code: 'COLLECTION_ARITY',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'error',
  category: 'collections',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isArityOpCall(node)) return [];
    const found = functionArgumentArity(node);
    if (found === null) return [];
    const expected = opArity(node.name);
    const { total, required } = found.arity;
    let detail: string | null = null;
    if (total < expected) {
      detail = `takes ${plural(total)}, so the call halts RILL-R045`;
    } else if (required > expected) {
      detail = `requires ${plural(required)}, so the call halts RILL-R044`;
    }
    if (detail === null) return [];
    return [
      {
        code: 'COLLECTION_ARITY',
        message: `${node.name} passes its function ${plural(expected)}, but this function ${detail}.`,
        severity: 'error',
        location: found.arg.span.start,
        context: extractContextLine(found.arg.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(collectionArity);
