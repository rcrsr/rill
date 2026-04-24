/**
 * ESLint Rule: no-cross-mixin-any
 *
 * Forbids `(this as any)` and `(evaluator as any)` patterns in eval/ mixin files.
 * Cross-mixin calls must use `EvaluatorInterface`, not `as any`.
 *
 * Targets:
 * - (this as any).method(...)
 * - (evaluator as any).method(...)
 *
 * Auto-fix: None. Human judgment required for correct cast target.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `(this as any)` and `(evaluator as any)` in eval/ mixin files',
      recommended: true,
    },
    schema: [],
    messages: {
      crossMixinAny:
        'Cross-mixin calls must use `EvaluatorInterface`, not `as any`. Cast `this as EvaluatorInterface` instead.',
    },
  },

  create(context) {
    return {
      TSAsExpression(node) {
        // Must cast to `any`
        if (node.typeAnnotation.type !== 'TSAnyKeyword') return;

        const expr = node.expression;

        // Case 1: (this as any)
        if (expr.type === 'ThisExpression') {
          context.report({ node, messageId: 'crossMixinAny' });
          return;
        }

        // Case 2: (evaluator as any)
        if (expr.type === 'Identifier' && expr.name === 'evaluator') {
          context.report({ node, messageId: 'crossMixinAny' });
        }
      },
    };
  },
};
