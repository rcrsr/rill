/**
 * Flags `==`, `!=`, `.eq`, and `.ne` comparisons whose operands can never
 * describe a common value, so the comparison is certain to halt at runtime.
 *
 * Only operands with a statically known type take part: a bare scalar
 * literal, a collection literal (judged by its kind alone, with no element
 * or field constraints), or `expr:T` with a static, argument-free type name.
 * Any other operand is unknowable statically and keeps the rule silent.
 * Overlap is decided by the runtime's own `structureOverlaps`.
 */

import { structureOverlaps } from '@rcrsr/rill';
import type { ASTNode, TypeStructure } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { literalKind, unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// OPERAND TYPES
// ============================================================

const EQUALITY_METHODS: ReadonlySet<string> = new Set(['eq', 'ne']);

/** The statically known structure of an operand, or null when unknowable. */
function operandStructure(expr: ASTNode): TypeStructure | null {
  const node = unwrapBareLiteral(expr);
  const kind = literalKind(node);
  if (kind !== null) return { kind };
  if (node.type !== 'TypeAssertion') return null;
  const { typeRef } = node;
  if (typeRef.kind !== 'static') return null;
  if (typeRef.args !== undefined && typeRef.args.length > 0) return null;
  return { kind: typeRef.typeName };
}

// ============================================================
// COMPARED PAIRS
// ============================================================

/** The two operands of an equality comparison node, or null for any other node. */
function comparedPair(node: ASTNode): readonly [ASTNode, ASTNode] | null {
  if (node.type === 'BinaryExpr') {
    return node.op === '==' || node.op === '!='
      ? [node.left, node.right]
      : null;
  }
  if (node.type !== 'PostfixExpr' || node.methods.length !== 1) return null;
  const call = node.methods[0];
  if (
    call?.type !== 'MethodCall' ||
    !EQUALITY_METHODS.has(call.name) ||
    call.args.length !== 1
  ) {
    return null;
  }
  const arg = call.args[0];
  return arg === undefined ? null : [node.primary, arg];
}

// ============================================================
// RULE
// ============================================================

export const equalityNoOverlap: Rule = {
  code: 'EQUALITY_NO_OVERLAP',
  nodeTypes: ['BinaryExpr', 'PostfixExpr'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const pair = comparedPair(node);
    if (pair === null) return [];
    const left = operandStructure(pair[0]);
    const right = operandStructure(pair[1]);
    if (left === null || right === null) return [];
    if (structureOverlaps(left, right)) return [];

    return [
      {
        code: 'EQUALITY_NO_OVERLAP',
        message: `Comparing ${left.kind} with ${right.kind}; the types never overlap, so the comparison halts.`,
        severity: 'warning',
        location: node.span.start,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(equalityNoOverlap);
