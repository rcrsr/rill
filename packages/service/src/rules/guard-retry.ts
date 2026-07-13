/**
 * Lints idiomatic use of `guard` and `retry` error-recovery blocks.
 */

import type { ASTNode, GuardBlockNode, RetryBlockNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// GUARD_BARE
// ============================================================

/**
 * Suggests explicit `on:` codes on `guard` blocks. A bare `guard { ... }`
 * recovers from any error, hiding intent and silencing errors the author
 * never planned for.
 */
export const guardBare: Rule = {
  code: 'GUARD_BARE',
  nodeTypes: ['GuardBlock'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const guard = node as GuardBlockNode;
    if (guard.onCodes && guard.onCodes.length > 0) return [];

    return [
      {
        location: guard.span.start,
        severity: 'info',
        code: 'GUARD_BARE',
        message:
          'Bare guard catches every error. Prefer guard<on: list[#X, ...]> to make recoverability explicit.',
        context: extractContextLine(guard.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

// ============================================================
// RETRY_TRIVIAL
// ============================================================

/**
 * Flags `retry<limit: N>` with N <= 1. A single attempt is what already
 * happens without `retry`; the block has no effect.
 */
export const retryTrivial: Rule = {
  code: 'RETRY_TRIVIAL',
  nodeTypes: ['RetryBlock'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const retry = node as RetryBlockNode;
    if (retry.attempts > 1) return [];

    return [
      {
        location: retry.span.start,
        severity: 'warning',
        code: 'RETRY_TRIVIAL',
        message: `retry<limit: ${retry.attempts}> has no effect; remove the wrapper or raise the attempt count.`,
        context: extractContextLine(retry.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(guardBare, retryTrivial);
