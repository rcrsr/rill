/**
 * Flags comparisons whose operands can never describe a common value, so the
 * comparison is certain to halt at runtime: `==`, `!=`, `.eq`, `.ne`, and the
 * list membership methods `.has`, `.has_any`, `.has_all`.
 *
 * Only operands with a statically known type take part: a bare scalar
 * literal, a collection literal (judged by its kind alone, with no element
 * or field constraints), or `expr:T` with a static, argument-free type name.
 * Any other operand is unknowable statically and keeps the rule silent.
 * Overlap is decided by the runtime's own `structureOverlaps`.
 *
 * Membership methods are checked for scalar-kind mismatches only: the
 * receiver must be a list literal of scalar literals (number, string, bool,
 * atom), and the sought value (or each candidate of `.has_any`/`.has_all`)
 * a scalar literal. Collection literals inside a list or as the sought value
 * are never judged by their contents, so a mismatch between, say, two dict
 * shapes stays unreported here even though the runtime halts on it.
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
const MEMBERSHIP_METHODS: ReadonlySet<string> = new Set([
  'has',
  'has_any',
  'has_all',
]);
const SCALAR_KINDS: ReadonlySet<string> = new Set([
  'number',
  'string',
  'bool',
  'atom',
]);

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

/** A statically comparable pair, with the operand structures to test. */
interface ComparedPair {
  readonly left: TypeStructure;
  readonly right: TypeStructure;
  readonly description: string;
}

/** The scalar kind of a bare literal, or null for anything else. */
function scalarKind(expr: ASTNode): string | null {
  const kind = literalKind(unwrapBareLiteral(expr));
  return kind !== null && SCALAR_KINDS.has(kind) ? kind : null;
}

/** The distinct scalar kinds of a list literal's elements, or null when unknowable. */
function listScalarKinds(expr: ASTNode): string[] | null {
  const node = unwrapBareLiteral(expr);
  if (node.type !== 'ListLiteral' || node.elements.length === 0) return null;
  const kinds = new Set<string>();
  for (const element of node.elements) {
    const kind = scalarKind(element);
    if (kind === null) return null;
    kinds.add(kind);
  }
  return [...kinds];
}

function kindsStructure(kinds: readonly string[]): TypeStructure {
  const [only] = kinds;
  if (kinds.length === 1 && only !== undefined) return { kind: only };
  return { kind: 'union', members: kinds.map((kind) => ({ kind })) };
}

/** The pair a method call compares, or null when it is not a checked call. */
function methodPair(
  receiver: ASTNode,
  call: ASTNode | undefined
): ComparedPair | null {
  if (call?.type !== 'MethodCall' || call.args.length !== 1) return null;
  const arg = call.args[0];
  if (arg === undefined) return null;

  if (EQUALITY_METHODS.has(call.name)) {
    const left = operandStructure(receiver);
    const right = operandStructure(arg);
    if (left === null || right === null) return null;
    return {
      left,
      right,
      description: `Comparing ${left.kind} with ${right.kind}`,
    };
  }
  if (!MEMBERSHIP_METHODS.has(call.name)) return null;

  const elements = listScalarKinds(receiver);
  if (elements === null) return null;
  let sought: string[] | null;
  if (call.name === 'has') {
    const kind = scalarKind(arg);
    sought = kind === null ? null : [kind];
  } else {
    sought = listScalarKinds(arg);
  }
  if (sought === null) return null;
  return {
    left: kindsStructure(elements),
    right: kindsStructure(sought),
    description: `Checking a list of ${elements.join(' | ')} with .${call.name} for ${sought.join(' | ')}`,
  };
}

/** The pair an equality or membership node compares, or null for any other node. */
function comparedPair(node: ASTNode): ComparedPair | null {
  if (node.type === 'BinaryExpr') {
    if (node.op !== '==' && node.op !== '!=') return null;
    const left = operandStructure(node.left);
    const right = operandStructure(node.right);
    if (left === null || right === null) return null;
    return {
      left,
      right,
      description: `Comparing ${left.kind} with ${right.kind}`,
    };
  }
  if (node.type === 'PostfixExpr') {
    return node.methods.length === 1
      ? methodPair(node.primary, node.methods[0])
      : null;
  }
  if (node.type === 'PipeChain') {
    return methodPair(node.head, node.pipes[0]);
  }
  return null;
}

// ============================================================
// RULE
// ============================================================

export const equalityNoOverlap: Rule = {
  code: 'EQUALITY_NO_OVERLAP',
  nodeTypes: ['BinaryExpr', 'PostfixExpr', 'PipeChain'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const pair = comparedPair(node);
    if (pair === null) return [];
    if (structureOverlaps(pair.left, pair.right)) return [];

    return [
      {
        code: 'EQUALITY_NO_OVERLAP',
        message: `${pair.description}; the types never overlap, so the comparison halts.`,
        severity: 'warning',
        location: node.span.start,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(equalityNoOverlap);
