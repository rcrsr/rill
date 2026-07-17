/**
 * Flags `acc(init, {body}) -> .tail`: the running-totals list is built for
 * every intermediate step, then thrown away except for the last element.
 * `fold(init, {body})` computes the same final value directly, without
 * materializing the intermediates.
 *
 * Verified empirically against the runtime: `.last` does not exist on
 * `list` (`Unknown method: last on type list`), and a pipe target of
 * `[-1]` does not index the piped value - it parses as a `ListLiteral`
 * dispatch and errors (`List dispatch: index '1' not found`). The only
 * valid adjacent final-element pipe idiom is `.tail`, which rill defines
 * as first/last (not first/rest): `[1,2,3] -> .tail` is `3`.
 *
 * Only an adjacent `acc(...) -> .tail` pair is recognized; the operator
 * and its consumer must sit next to each other in the same `PipeChain` for
 * a single-pass rule to see both without a sub-walk. The
 * capture-then-subscript form (`acc(...) => $t` followed later by
 * `$t[-1]`) needs whole-script analysis and is out of scope; it, and any
 * other non-adjacent consumer, stays silent.
 */

import type { ASTNode, PipeChainNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { isCollectionOpCall } from './collection-ops.js';
import { registeredRules } from './rules-registry.js';

export const foldIntermediates: Rule = {
  code: 'FOLD_INTERMEDIATES',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'info',
  category: 'collections',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const pipeChainNode = node as PipeChainNode;
    const pipes = pipeChainNode.pipes;

    for (let i = 0; i < pipes.length - 1; i++) {
      const op = pipes[i];
      const consumer = pipes[i + 1];
      if (!op || !consumer) continue;
      if (!isCollectionOpCall(op) || op.name !== 'acc') continue;
      if (consumer.type !== 'MethodCall' || consumer.name !== 'tail') {
        continue;
      }

      return [
        {
          code: 'FOLD_INTERMEDIATES',
          message:
            'acc(...) -> .tail discards every intermediate result but the last; use fold(...) to compute the final value directly.',
          severity: 'info',
          location: op.span.start,
          context: extractContextLine(op.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(foldIntermediates);
