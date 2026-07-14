/**
 * Recommends type assertions for external input validation.
 * External inputs (from host functions, user input, parsed data) should be
 * validated with type assertions to ensure type safety.
 *
 * This is an informational rule - not all external data needs assertions,
 * but it's a good practice for critical paths.
 */

import type { ASTNode, HostCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

/**
 * Verbs identifying an external-I/O host call. rill host functions follow
 * either a verb_noun (`fetch_data`, `open_socket`) or a noun_verb
 * (`api_fetch`, `db_query`, `http_get`) snake_case convention, so a match
 * requires the LEADING or TRAILING `_`-delimited segment - not any
 * substring, and not an arbitrary middle segment - to equal one of these
 * verbs. `download` (single segment, not equal to "load") does not match a
 * raw substring the old check would have hit, and `thread_pool` (neither
 * segment is a verb) does not match either.
 *
 * KNOWN LIMITATION: `already_read`'s trailing segment is the verb "read",
 * so it matches under this rule even though "already_read" reads as a
 * completed-state check, not an I/O call. Distinguishing this from a
 * genuine noun_verb call site (`db_read`, `cache_read`) is not possible
 * with a purely lexical, position-based rule - both have the identical
 * shape noun_verb with "read" trailing. Genuine noun_verb I/O names
 * (`db_query`, `http_get`) must fire, so the trailing-segment match is
 * kept and this one false positive is accepted rather than narrowing the
 * rule until real noun_verb I/O calls silently stop being flagged.
 */
const EXTERNAL_IO_VERBS = new Set([
  'fetch',
  'read',
  'load',
  'query',
  'open',
  'post',
  'get',
]);

/**
 * True when `functionName`'s leading OR trailing snake_case segment is a
 * known external-I/O verb. Word-boundaried on `_` rather than a raw
 * substring match, and restricted to the two positional segments most
 * likely to carry the verb (verb_noun or noun_verb), not an arbitrary
 * middle segment. See the KNOWN LIMITATION note on `EXTERNAL_IO_VERBS`.
 */
function isExternalDataFunction(functionName: string): boolean {
  const segments = functionName.split('_');
  const leadingSegment = segments[0];
  const trailingSegment = segments[segments.length - 1];
  return (
    (leadingSegment !== undefined && EXTERNAL_IO_VERBS.has(leadingSegment)) ||
    (trailingSegment !== undefined && EXTERNAL_IO_VERBS.has(trailingSegment))
  );
}

export const validateExternal: Rule = {
  code: 'VALIDATE_EXTERNAL',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const hostCallNode = node as HostCallNode;
    const functionName = hostCallNode.name;

    // Skip namespaced functions (ns::func) - these are trusted host APIs.
    if (functionName.includes('::')) {
      return [];
    }

    // Check if this is a parsing or external data function.
    if (!isExternalDataFunction(functionName)) {
      return [];
    }

    // Skip if this HostCall is already wrapped in a TypeAssertion.
    if (context.assertedHostCalls.has(node)) {
      return [];
    }

    return [
      {
        code: 'VALIDATE_EXTERNAL',
        message: `Consider validating external input with type assertion: ${functionName}():type`,
        severity: 'info',
        location: hostCallNode.span.start,
        context: extractContextLine(
          hostCallNode.span.start.line,
          context.source
        ),
        fix: null,
      },
    ];
  },
};

registeredRules.push(validateExternal);
