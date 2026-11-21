/**
 * Lints idiomatic use of `guard` and `retry` error-recovery blocks.
 */

import type { ASTNode, DictEntryNode, DictNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// Shared message
// ============================================================

/** Builds the message for a wrapper that changes nothing about its body. */
function noEffectMessage(wrapper: string, remedy: string): string {
  return `${wrapper} has no effect; remove the wrapper or ${remedy}.`;
}

// ============================================================
// Option readers
// ============================================================

/** True for a `...expression` entry, which carries no key form. */
function isSpreadEntry(entry: DictEntryNode): boolean {
  return entry.key === '...' && entry.keyForm === undefined;
}

/** The entry written under `name`, or undefined when no entry names it. */
function writtenOption(
  options: DictNode | null,
  name: string
): DictEntryNode | undefined {
  return options?.entries.find(
    (entry) => entry.key === name && !isSpreadEntry(entry)
  );
}

/**
 * True when the options may supply a field the source does not name: a spread,
 * or a variable, computed, or multi-key entry.
 */
function hasUnwrittenFields(options: DictNode | null): boolean {
  return (
    options?.entries.some(
      (entry) => isSpreadEntry(entry) || typeof entry.key !== 'string'
    ) ?? false
  );
}

/**
 * The sole primary of a value written as one bare literal, else undefined.
 * A pipe, method, default (`??`), existence check, or terminator makes the
 * value richer than its primary.
 */
function writtenPrimary(entry: DictEntryNode): ASTNode | undefined {
  return barePrimary(entry.value);
}

function barePrimary(value: ASTNode): ASTNode | undefined {
  if (value.type !== 'PipeChain') return undefined;
  if (value.pipes.length > 0 || value.terminator !== null) return undefined;
  const head = value.head;
  if (head.type !== 'PostfixExpr') return undefined;
  if (head.methods.length > 0 || head.defaultValue !== null) return undefined;
  if (head.existenceCheck !== null && head.existenceCheck !== undefined) {
    return undefined;
  }
  return head.primary;
}

// ============================================================
// GUARD_BARE
// ============================================================

/**
 * Suggests explicit `on:` codes on `guard` blocks. A bare `guard { ... }`
 * recovers from any error, hiding intent and silencing errors the author
 * never planned for. A guard whose options are spread in may carry `on`, so
 * it is not bare.
 */
export const guardBare: Rule = {
  code: 'GUARD_BARE',
  nodeTypes: ['GuardBlock'],
  defaultSeverity: 'info',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'GuardBlock') return [];
    const guard = node;
    if (writtenOption(guard.options, 'on') !== undefined) return [];
    if (hasUnwrittenFields(guard.options)) return [];

    return [
      {
        location: guard.span.start,
        severity: 'info',
        code: 'GUARD_BARE',
        message:
          'Bare guard catches every error. Prefer guard(on: list[#X, ...]) to make recoverability explicit.',
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
 * Flags `retry(attempts: N)` with N <= 1. A single attempt is what already
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
    const attempts = writtenOption(retry.options, 'attempts');
    const count = attempts === undefined ? undefined : writtenPrimary(attempts);
    if (count?.type !== 'NumberLiteral' || count.value > 1) return [];

    return [
      {
        location: retry.span.start,
        severity: 'warning',
        code: 'RETRY_TRIVIAL',
        message: noEffectMessage(
          `retry(attempts: ${count.value})`,
          'raise the attempt count'
        ),
        context: extractContextLine(retry.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

// ============================================================
// TIMEOUT_TRIVIAL
// ============================================================

/**
 * Flags `timeout()` with no limit. An empty options dict arms neither the
 * total nor the idle bound; the block has no effect.
 */
export const timeoutTrivial: Rule = {
  code: 'TIMEOUT_TRIVIAL',
  nodeTypes: ['TimeoutBlock'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'TimeoutBlock') return [];
    const timeout = node;
    if (timeout.options.entries.length > 0) return [];

    return [
      {
        location: timeout.span.start,
        severity: 'warning',
        code: 'TIMEOUT_TRIVIAL',
        message: noEffectMessage('timeout()', 'add a limit'),
        context: extractContextLine(timeout.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

// ============================================================
// ON_LIST_SINGLE
// ============================================================

/**
 * Flags `on: list[#X]` on `guard` and `retry`, and the bare `on: [#X]`. A
 * one-element list holds a single code; the plain form `on: #X` says the same
 * thing directly.
 */
export const onListSingle: Rule = {
  code: 'ON_LIST_SINGLE',
  nodeTypes: ['GuardBlock', 'RetryBlock'],
  defaultSeverity: 'info',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'GuardBlock' && node.type !== 'RetryBlock') return [];
    const on = writtenOption(node.options, 'on');
    const list = on === undefined ? undefined : writtenPrimary(on);
    if (list?.type !== 'ListLiteral' && list?.type !== 'TupleLiteral') {
      return [];
    }
    const [only, ...rest] = list.elements;
    if (only === undefined || rest.length > 0 || only.type === 'ListSpread') {
      return [];
    }
    const atom = barePrimary(only);
    if (atom?.type !== 'AtomLiteral') return [];

    return [
      {
        location: node.span.start,
        severity: 'info',
        code: 'ON_LIST_SINGLE',
        message: `on: list[#${atom.name}] holds one code; write on: #${atom.name}.`,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(guardBare, retryTrivial, timeoutTrivial, onListSingle);
