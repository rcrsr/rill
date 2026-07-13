/**
 * Detects attempts to modify outer-scope variables from inside loops.
 *
 * Rill's scoping rules mean that captures inside loop bodies create LOCAL
 * variables that don't affect outer scope. This is a fundamental language
 * constraint, not a style preference.
 *
 * WRONG - this pattern NEVER works:
 *   0 => $count
 *   [1, 2, 3] -> seq { $count + 1 => $count }  # creates LOCAL $count
 *   $count                                      # still 0!
 *
 * RIGHT - use accumulators:
 *   [1, 2, 3] -> fold(0) { $@ + 1 }             # returns 3
 *   [1, 2, 3] -> acc(0) { $@ + 1 }              # returns [1, 2, 3]
 */

import type {
  ASTNode,
  ClosureNode,
  DoWhileLoopNode,
  WhileLoopNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { isCollectionOpCall, getCollectionOpBody } from './collection-ops.js';
import {
  findCapturesInBody,
  isVariableInParentScope,
} from './scope-helpers.js';

export const loopOuterCapture: Rule = {
  code: 'LOOP_OUTER_CAPTURE',
  nodeTypes: ['HostCall', 'WhileLoop', 'DoWhileLoop'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Get the loop body based on node type. Collection-op HostCall nodes
    // (seq/fan/fold/filter/acc) carry the body as a Closure or Block arg.
    let body: ASTNode | null = null;
    if (isCollectionOpCall(node)) {
      const arg = getCollectionOpBody(node);
      body = arg
        ? arg.type === 'Closure'
          ? (arg as ClosureNode).body
          : arg
        : null;
    } else if (node.type === 'WhileLoop') {
      body = (node as WhileLoopNode).body;
    } else if (node.type === 'DoWhileLoop') {
      body = (node as DoWhileLoopNode).body;
    }

    if (!body) return diagnostics;

    // Find all captures in the body.
    const captures = findCapturesInBody(body);

    // Get the current closure scope (if we're inside a closure).
    const currentClosureScope =
      context.scopeStack.length > 0
        ? context.scopeStack[context.scopeStack.length - 1]!
        : null;

    // Check if any capture targets an outer-scope variable.
    for (const capture of captures) {
      if (context.variables.has(capture.name)) {
        const outerLocation = context.variables.get(capture.name)!;
        const variableScope = context.variableScopes.get(capture.name) ?? null;

        // Only flag if the variable is in a parent scope, not a sibling closure.
        const isOuterScope = isVariableInParentScope(
          variableScope,
          currentClosureScope,
          context.scopeStack
        );

        if (isOuterScope) {
          diagnostics.push({
            code: 'LOOP_OUTER_CAPTURE',
            message:
              `Cannot modify outer variable '$${capture.name}' from inside loop. ` +
              `Captures inside loops create LOCAL variables. ` +
              `Use fold(init) with $@ accumulator, or pack state into $ as a dict. ` +
              `(Outer '$${capture.name}' defined at line ${outerLocation.line})`,
            severity: 'warning',
            location: capture.span.start,
            context: extractContextLine(
              capture.span.start.line,
              context.source
            ),
            fix: null,
          });
        }
      }
    }

    return diagnostics;
  },
};

registeredRules.push(loopOuterCapture);
