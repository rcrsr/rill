/**
 * Flags conditional conditions that are trivially non-boolean literals.
 *
 * rill has no truthy/falsy semantics (design principle #7: no truthiness).
 * `$cond ? a ! b` requires `$cond` to be an actual `bool` value; anything
 * else halts at runtime (see
 * packages/core/tests/language/ref-llms-full-assertions.test.ts, the
 * `"" ? "yes" ! "no" errors (not boolean)` case). This rule only catches the
 * decidable subset: a condition whose syntax is unambiguously a non-bool
 * literal (string, number, list, dict, tuple, ordered) with no method calls,
 * pipe targets, or default-value fallback that could still resolve to a
 * `bool`. Neither this package nor `@rcrsr/rill` performs static type
 * inference, so the general case - a condition built from a variable,
 * host call, or closure result - is out of reach; those stay silent even
 * though many of them are equally certain to halt at runtime.
 */

import type { ASTNode, BodyNode, ConditionalNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// FIRE-SET PRIMARY TYPES
// ============================================================

/**
 * Primary node types that unambiguously produce a non-bool value.
 *
 * `DictLiteralNode` is not in this set: the parser always produces
 * `type: 'Dict'` for `dict[...]` literals (already listed below); no parse
 * path emits a `DictLiteral`-typed node, so including it would be
 * unreachable dead code.
 */
const NON_BOOL_PRIMARY_TYPES = new Set([
  'StringLiteral',
  'NumberLiteral',
  'ListLiteral',
  'TupleLiteral',
  'OrderedLiteral',
  'Dict',
  'AtomLiteral',
]);

// ============================================================
// UNWRAP
// ============================================================

/**
 * Iteratively unwrap a conditional's `condition` down to the node whose
 * shape decides whether the rule fires. Iterative (not recursive) to match
 * the explicit-stack rationale in `traversal.ts`: machine-generated
 * conditions can nest deeply, and an explicit loop avoids growing the JS
 * call stack on that input.
 *
 * Returns `null` whenever unwrapping reaches a node that cannot be
 * classified further with confidence (the caller then stays silent), or
 * the current node once nothing more can be unwrapped.
 */
function unwrapCondition(condition: BodyNode | null): ASTNode | null {
  if (condition === null) {
    // Piped form: `$x -> ? a ! b`. Not analyzed here.
    return null;
  }

  let current: ASTNode = condition;

  for (;;) {
    switch (current.type) {
      case 'Block':
        // Multi-statement condition body; not analyzed here.
        return null;

      case 'GroupedExpr':
        current = current.expression;
        continue;

      case 'PipeChain': {
        if (current.pipes.length > 0 || current.terminator !== null) {
          return null;
        }
        current = current.head;
        continue;
      }

      case 'BinaryExpr':
      case 'UnaryExpr':
        return null;

      case 'PostfixExpr': {
        if (current.methods.length > 0 || current.defaultValue !== null) {
          return null;
        }
        current = current.primary;
        continue;
      }

      default:
        return current;
    }
  }
}

// ============================================================
// RULE
// ============================================================

export const conditionType: Rule = {
  code: 'CONDITION_TYPE',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'warning',
  category: 'conditionals',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const conditionalNode = node as ConditionalNode;
    const primary = unwrapCondition(conditionalNode.condition);

    if (primary === null || !NON_BOOL_PRIMARY_TYPES.has(primary.type)) {
      return [];
    }

    return [
      {
        code: 'CONDITION_TYPE',
        message:
          'Condition is a non-bool literal; conditions must evaluate to bool.',
        severity: 'warning',
        location: primary.span.start,
        context: extractContextLine(primary.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(conditionType);
