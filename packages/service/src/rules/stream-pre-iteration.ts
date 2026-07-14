/**
 * Detects invoking a stream-returning closure before iterating over its
 * result. `$stream()` consumes chunks internally, leaving no data for a
 * subsequent `seq`/`fan`/`fold`/`filter`/`acc` pass.
 *
 * Detection:
 * - Reads variables captured from stream closures (`returnTypeTarget` of
 *   `stream`) or captured with an explicit `:stream` type annotation from
 *   the precomputed script facts.
 * - Reads the first invocation (`ClosureCall`) and first iteration
 *   (collection-op pipe target) for each such variable, filtered to those
 *   stream variables, from the same facts.
 * - Fires when invocation precedes iteration in source order, or when the
 *   variable is invoked but never iterated.
 */

import type { ASTNode, ClosureCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const streamPreIteration: Rule = {
  code: 'STREAM_PRE_ITERATION',
  nodeTypes: ['Script'],
  defaultSeverity: 'warning',

  validate(_node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const { streamVars, firstClosureCall, firstPipeIteration } =
      context.facts.script;

    if (streamVars.size === 0) {
      return diagnostics;
    }

    const firstInvocation = new Map<string, ClosureCallNode>();
    const firstIteration = new Map<string, ASTNode>();
    for (const varName of streamVars) {
      const call = firstClosureCall.get(varName);
      if (call) firstInvocation.set(varName, call);
      const iteration = firstPipeIteration.get(varName);
      if (iteration) firstIteration.set(varName, iteration);
    }

    for (const varName of streamVars) {
      const invocation = firstInvocation.get(varName);
      const iteration = firstIteration.get(varName);

      if (!invocation) {
        continue;
      }

      const invokedBeforeIteration =
        !iteration ||
        invocation.span.start.line < iteration.span.start.line ||
        (invocation.span.start.line === iteration.span.start.line &&
          invocation.span.start.column < iteration.span.start.column);

      if (invokedBeforeIteration) {
        diagnostics.push({
          location: invocation.span.start,
          severity: 'warning',
          code: 'STREAM_PRE_ITERATION',
          message: `Stream invoked before iteration; chunks consumed internally. '$${varName}' at line ${invocation.span.start.line}`,
          context: extractContextLine(
            invocation.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

registeredRules.push(streamPreIteration);
