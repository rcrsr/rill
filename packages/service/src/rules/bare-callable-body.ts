/**
 * Flags a bare identifier used as a collection-op body where a callable
 * reference was intended.
 *
 * `seq(name)` parses `name` as a zero-arg host call, not a reference to a
 * closure or host function. That call runs once and its (likely
 * non-callable) result is treated as the per-element body, which is almost
 * always a mistake:
 * - Likely intended: seq({ name($) })   -- wrap in a closure
 * - Likely intended: seq($name)         -- reference a script-defined closure
 * - Likely intended: seq(ns::name)      -- reference a namespaced callable
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { getBareCallableArg, isCollectionOpCall } from './collection-ops.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const bareCallableBody: Rule = {
  code: 'BARE_CALLABLE_BODY',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'warning',
  category: 'collections',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isCollectionOpCall(node)) return [];

    const bareCall = getBareCallableArg(node);
    if (!bareCall) return [];

    const name = bareCall.name;

    return [
      {
        code: 'BARE_CALLABLE_BODY',
        message: `Bare '${name}' is a zero-arg call here, not a callable — ${node.name} body must be a closure. Wrap it ({ ${name}($) }) or reference a callable ($var or ns::name).`,
        severity: 'warning',
        location: bareCall.span.start,
        context: extractContextLine(bareCall.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(bareCallableBody);
