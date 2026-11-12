/**
 * Lints idiomatic use of `guard` and `retry` error-recovery blocks.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  extractContextLine,
  maskComments,
  maskStringLiterals,
} from './helpers.js';
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
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'GuardBlock') return [];
    const guard = node;
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
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'RetryBlock') return [];
    const retry = node;
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

// ============================================================
// ON_LIST_SINGLE
// ============================================================

/**
 * Flags `on: list[#X]` on `guard` and `retry`. A one-element list holds a
 * single code; the plain form `on: #X` says the same thing directly.
 */
export const onListSingle: Rule = {
  code: 'ON_LIST_SINGLE',
  nodeTypes: ['GuardBlock', 'RetryBlock'],
  defaultSeverity: 'info',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'GuardBlock' && node.type !== 'RetryBlock') return [];
    const codes = node.onCodes;
    const only = codes?.[0];
    if (codes?.length !== 1 || only === undefined) return [];

    const options = maskComments(
      maskStringLiterals(
        context.source.slice(
          node.span.start.offset,
          node.body.span.start.offset
        )
      )
    );
    if (!options.includes('list[')) return [];

    return [
      {
        location: node.span.start,
        severity: 'info',
        code: 'ON_LIST_SINGLE',
        message: `on: list[#${only.name}] holds one code; write on: #${only.name}.`,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(guardBare, retryTrivial, onListSingle);
