/**
 * Suggests selecting a field on `.!` probes. Bare `.!` yields the whole
 * status record; `.!code`, `.!message`, or `.!provider` are usually what
 * callers want.
 */

import type { ASTNode, StatusProbeNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const statusProbeNoField: Rule = {
  code: 'STATUS_PROBE_NO_FIELD',
  nodeTypes: ['StatusProbe'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const probe = node as StatusProbeNode;
    if (probe.field !== undefined) return [];

    return [
      {
        location: probe.span.start,
        severity: 'info',
        code: 'STATUS_PROBE_NO_FIELD',
        message:
          'Bare .! returns the whole status record. Project a field with .!code, .!message, or .!provider.',
        context: extractContextLine(probe.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(statusProbeNoField);
