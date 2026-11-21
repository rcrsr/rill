/**
 * Flags a negative number literal index on a value known to be a map.
 * `$m[-1]` looks up the key -1; unlike a list, a map does not count from the
 * end. Use `$m.values[-1]` for the last value. Hint only.
 *
 * Fires only when the receiver is a variable captured once from a map literal
 * whose keys are all static and none equals the negative index. Silent when the
 * literal holds that key, has a computed key or a `??` default, or when the map
 * is known only by a declared type; silent for every other receiver and for a
 * negative index further along a chain.
 */

import type { ASTNode, MapLiteralNode, VariableNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

/** The value of a negative number literal index, or null for any other expression. */
function negativeNumberLiteral(expr: ASTNode): number | null {
  const node = unwrapBareLiteral(expr);
  if (node.type !== 'UnaryExpr' || node.op !== '-') return null;
  const operand = unwrapBareLiteral(node.operand);
  return operand.type === 'NumberLiteral' ? -operand.value : null;
}

/** Numeric value of a static number key, null for a static non-number key, undefined when computed. */
function numberKey(node: ASTNode): number | null | undefined {
  const inner = unwrapBareLiteral(node);
  if (inner.type === 'NumberLiteral') return inner.value;
  if (inner.type === 'UnaryExpr' && inner.op === '-') {
    const operand = unwrapBareLiteral(inner.operand);
    if (operand.type === 'NumberLiteral') return -operand.value;
  }
  switch (inner.type) {
    case 'StringLiteral':
      return inner.parts.every((part) => typeof part === 'string')
        ? null
        : undefined;
    case 'AtomLiteral':
    case 'BoolLiteral':
      return null;
    default:
      return undefined;
  }
}

/** True when the literal's keys are all static and none is `target`. */
function literalLacksKey(map: MapLiteralNode, target: number): boolean {
  if (map.defaultValue !== null) return false;
  for (const entry of map.entries) {
    const key = unwrapBareLiteral(entry.key);
    const nodes = key.type === 'ListLiteral' ? key.elements : [key];
    for (const node of nodes) {
      const value = numberKey(node);
      if (value === undefined || value === target) return false;
    }
  }
  return true;
}

function validateVariable(
  node: VariableNode,
  context: RuleContext
): Diagnostic[] {
  const [first] = node.accessChain;
  if (node.name === null || node.isPipeVar) return [];
  if (first === undefined || !('accessKind' in first)) return [];
  if (first.accessKind !== 'bracket') return [];
  const index = negativeNumberLiteral(first.expression);
  if (index === null) return [];
  const literal = context.facts.script.mapLiteralVars.get(node.name);
  if (literal === undefined || !literalLacksKey(literal, index)) return [];
  const at = first.span.start;
  return [
    {
      location: at,
      severity: 'info',
      code: 'MAP_NEGATIVE_INDEX',
      message: `$${node.name} is a map, so a negative index selects the key, not a position from the end. Read the last value with .values[-1].`,
      context: extractContextLine(at.line, context.source),
      fix: null,
    },
  ];
}

export const mapNegativeIndex: Rule = {
  code: 'MAP_NEGATIVE_INDEX',
  nodeTypes: ['Variable'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    return node.type === 'Variable' ? validateVariable(node, context) : [];
  },
};

registeredRules.push(mapNegativeIndex);
