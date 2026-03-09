/**
 * UseExpr Validation Rules
 * Enforces use<> expression restrictions based on checkerMode.
 *
 * AC-14: use<$varName> and use<(expr)> forms produce errors in strict mode,
 *        warnings in permissive mode.
 * AC-15: use<host:fn> without :type annotation produces an error in strict mode,
 *        a warning in permissive mode.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type { ASTNode, UseExprNode } from '@rcrsr/rill';
import { extractContextLine } from './helpers.js';

// ============================================================
// USE_DYNAMIC_IDENTIFIER RULE (AC-14)
// ============================================================

/**
 * Flags dynamic use<> identifier forms in checkerMode-aware way.
 * Variable form (use<$name>) and computed form (use<(expr)>) are harder for
 * static analysis and code review. Strict mode rejects them; permissive warns.
 *
 * References:
 * - AC-14 in use-construct spec
 * - docs/guide-conventions.md checker modes section
 */
export const USE_DYNAMIC_IDENTIFIER: ValidationRule = {
  code: 'USE_DYNAMIC_IDENTIFIER',
  category: 'anti-patterns',
  severity: 'warning',
  nodeTypes: ['UseExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const useNode = node as UseExprNode;
    const identifier = useNode.identifier;

    // Only applies to variable and computed forms
    if (identifier.kind !== 'variable' && identifier.kind !== 'computed') {
      return [];
    }

    const isStrict = context.config.checkerMode === 'strict';
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
// USE_UNTYPED_HOST_REF RULE (AC-15)
// ============================================================

/**
 * Flags static use<host:fn> expressions that lack a :type annotation.
 * Untyped host references make type flow opaque. Strict mode rejects them;
 * permissive mode warns.
 *
 * References:
 * - AC-15 in use-construct spec
 * - docs/guide-conventions.md checker modes section
 */
export const USE_UNTYPED_HOST_REF: ValidationRule = {
  code: 'USE_UNTYPED_HOST_REF',
  category: 'types',
  severity: 'warning',
  nodeTypes: ['UseExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const useNode = node as UseExprNode;
    const identifier = useNode.identifier;

    // Only applies to static form
    if (identifier.kind !== 'static') {
      return [];
    }

    // No diagnostic if a :type annotation is present
    if (useNode.typeRef !== null) {
      return [];
    }

    const isStrict = context.config.checkerMode === 'strict';
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
