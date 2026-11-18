/**
 * Flags an inline closure with no parameters used as a pipe target. A pipe
 * target receives the piped value as its argument, so a zero-parameter
 * closure halts at runtime with RILL-R045.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const pipeZeroParamTarget: Rule = {
  code: 'PIPE_ZERO_PARAM_TARGET',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'warning',
  category: 'closures',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'PipeChain') return [];
    const diagnostics: Diagnostic[] = [];
    for (const pipe of node.pipes) {
      if (pipe.type !== 'Closure' || pipe.params.length > 0) continue;
      diagnostics.push({
        code: 'PIPE_ZERO_PARAM_TARGET',
        message:
          'A pipe target closure with no parameters halts RILL-R045; declare a parameter to receive the piped value.',
        severity: 'warning',
        location: pipe.span.start,
        context: extractContextLine(pipe.span.start.line, context.source),
        fix: null,
      });
    }
    return diagnostics;
  },
};

registeredRules.push(pipeZeroParamTarget);
