/**
 * ESLint Rule: no-new-runtime-error
 *
 * Script errors are halts. Rejects `new RuntimeError(...)` and
 * `RuntimeError.fromNode(...)` in favor of the halt builders in
 * `runtime/core/types/halt.ts` (`throwTypeHalt`, `throwCatchableHostHalt`,
 * `throwFatalHostHalt`, `throwAbortHalt`, `throwErrorHalt`) called with a
 * registry atom such as `ERROR_ATOMS[ERROR_IDS.RILL_R002]`.
 *
 * Not auto-fixable: the halt builder and its site depend on the error.
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow constructing RuntimeError; throw a halt instead',
      recommended: true,
    },
    schema: [],
    messages: {
      useHalt:
        'Throw a halt via the builders in runtime/core/types/halt.ts instead of constructing RuntimeError.',
    },
  },

  create(context) {
    return {
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'RuntimeError'
        ) {
          context.report({ node, messageId: 'useHalt' });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'RuntimeError' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'fromNode'
        ) {
          context.report({ node, messageId: 'useHalt' });
        }
      },
    };
  },
};
