/**
 * Warns on capture-only-to-continue patterns.
 * Capturing a value just to use it immediately in the next line is
 * unnecessary. Stubbed - requires full script analysis across statement
 * boundaries: tracking all captures, all variable references, and
 * single-use detection.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { registeredRules } from './rules-registry.js';

export const throwawayCapture: Rule = {
  code: 'THROWAWAY_CAPTURE',
  nodeTypes: ['Capture'],
  defaultSeverity: 'info',

  validate(_node: ASTNode, _context: RuleContext): Diagnostic[] {
    return [];
  },
};

registeredRules.push(throwawayCapture);
