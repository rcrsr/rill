/**
 * Enforces `use<>` expression restrictions based on `checkerMode`.
 *
 * - Variable form (`use<$name>`) and computed form (`use<(expr)>`) are
 *   harder for static analysis and code review. Strict mode rejects them;
 *   permissive mode warns.
 * - Static `use<host:fn>` without a `:type` annotation makes type flow
 *   opaque. Strict mode rejects it; permissive mode warns.
 *
 * Both rules declare severity `warning` but resolve their emitted severity
 * from `context.checkerMode` at validation time: `error` under `'strict'`,
 * `warning` under `'permissive'` or `undefined`.
 */

import type { ASTNode, UseExprNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// USE_DYNAMIC_IDENTIFIER RULE
// ============================================================

export const useDynamicIdentifier: Rule = {
  code: 'USE_DYNAMIC_IDENTIFIER',
  nodeTypes: ['UseExpr'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const useNode = node as UseExprNode;
    const identifier = useNode.identifier;

    if (identifier.kind !== 'variable' && identifier.kind !== 'computed') {
      return [];
    }

    const isStrict = context.checkerMode === 'strict';
    const severity = isStrict ? 'error' : 'warning';

    const formLabel =
      identifier.kind === 'variable'
        ? `use<$${identifier.name}>`
        : 'use<(expr)>';

    const modeLabel = isStrict ? 'strict mode' : 'permissive mode';

    return [
      {
        location: useNode.span.start,
        severity,
        code: 'USE_DYNAMIC_IDENTIFIER',
        message: `Dynamic use<> identifier (${formLabel}) is not recommended in ${modeLabel}; prefer static use<scheme:resource>`,
        context: extractContextLine(useNode.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

// ============================================================
// USE_UNTYPED_HOST_REF RULE
// ============================================================

export const useUntypedHostRef: Rule = {
  code: 'USE_UNTYPED_HOST_REF',
  nodeTypes: ['UseExpr'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const useNode = node as UseExprNode;
    const identifier = useNode.identifier;

    if (identifier.kind !== 'static') {
      return [];
    }

    if (identifier.scheme !== 'host') {
      return [];
    }

    if (useNode.typeRef !== null) {
      return [];
    }

    const isStrict = context.checkerMode === 'strict';
    const severity = isStrict ? 'error' : 'warning';

    const resource = `${identifier.scheme}:${identifier.segments.join('.')}`;
    const modeLabel = isStrict ? 'strict mode' : 'permissive mode';

    return [
      {
        location: useNode.span.start,
        severity,
        code: 'USE_UNTYPED_HOST_REF',
        message: `use<${resource}> has no :type annotation in ${modeLabel}; add :TypeName to declare the resolved type`,
        context: extractContextLine(useNode.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(useDynamicIdentifier, useUntypedHostRef);
