/**
 * Flags a naked code block captured into a variable. A code block is never a
 * value: `{ 5 } => $f` runs the block now and binds its result, so `$f` holds
 * `5`, not a function. Storing a function needs `fn { 5 } => $f`.
 *
 * - Capture: a chain headed by a naked block, or a block alone in
 *   parentheses, whose first pipe is a capture.
 * - Call: a call on a variable captured exactly once from such a block whose
 *   last statement provably yields no function (a literal, arithmetic, an
 *   interpolated string, a collection literal). A block ending in a call or a
 *   variable may yield a function, so a call on its capture stays silent.
 *
 * An `fn` literal, an argument block, a conditional branch, and a block held
 * as a dict or list entry are not chain heads and stay silent.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { bareBlockHead, extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const blockCapture: Rule = {
  code: 'BLOCK_CAPTURE',
  nodeTypes: ['PipeChain', 'ClosureCall'],
  defaultSeverity: 'warning',
  category: 'closures',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type === 'PipeChain') {
      if (node.pipes[0]?.type !== 'Capture') return [];
      const block = bareBlockHead(node.head);
      if (block === null) return [];
      return [
        {
          code: 'BLOCK_CAPTURE',
          message:
            'A code block is never a value: this block runs now and the capture binds its result. To store a function, write `fn { ... }`; to bind the result, drop the braces.',
          severity: 'warning',
          location: block.span.start,
          context: extractContextLine(block.span.start.line, context.source),
          fix: null,
        },
      ];
    }
    if (node.type !== 'ClosureCall' || node.accessChain.length > 0) return [];
    if (!context.facts.script.blockCapturedVars.has(node.name)) return [];
    return [
      {
        code: 'BLOCK_CAPTURE',
        message: `$${node.name} was captured from a code block, so it holds the block's result, not a function. Capture \`fn { ... }\` to store a function.`,
        severity: 'warning',
        location: node.span.start,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(blockCapture);
