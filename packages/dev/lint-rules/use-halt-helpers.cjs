/**
 * ESLint Rule: use-halt-helpers
 *
 * A halt surfaces either as a raw `RuntimeHaltSignal` or as a rematerialised
 * `RuntimeError`. `expectHalt` and `expectHaltMessage` accept both;
 * `.rejects.toThrow(...)` does not. Rejects `.rejects.toThrow` and
 * `.rejects.toThrowError` in favor of the helpers in `tests/helpers/`.
 *
 * Not auto-fixable: the matching helper depends on what the test asserts.
 */

const THROW_MATCHERS = new Set(['toThrow', 'toThrowError']);

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require halt helpers instead of rejects.toThrow in tests',
      recommended: true,
    },
    schema: [],
    messages: {
      useHaltHelper:
        'Use expectHalt or expectHaltMessage from tests/helpers/ instead of .rejects.{{matcher}}.',
    },
  },

  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.computed ||
          node.property.type !== 'Identifier' ||
          !THROW_MATCHERS.has(node.property.name)
        ) {
          return;
        }
        const object = node.object;
        if (
          object.type === 'MemberExpression' &&
          !object.computed &&
          object.property.type === 'Identifier' &&
          object.property.name === 'rejects'
        ) {
          context.report({
            node,
            messageId: 'useHaltHelper',
            data: { matcher: node.property.name },
          });
        }
      },
    };
  },
};
