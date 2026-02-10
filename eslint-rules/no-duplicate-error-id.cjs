/**
 * ESLint Rule: no-duplicate-error-id
 *
 * Detects when RuntimeError message argument contains the error ID prefix.
 *
 * Targets:
 * - new RuntimeError('RILL-R001', 'RILL-R001: message')
 * - RuntimeError.fromNode('RILL-R001', 'RILL-R001: message', node)
 *
 * Auto-fixable: Strips 'RILL-RXXX: ' prefix from message argument.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow duplicate error ID in RuntimeError message argument',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      duplicateErrorId:
        "Error message must not include error ID prefix. The ID '{{errorId}}' is already the first parameter.",
    },
  },

  create(context) {
    /**
     * Extracts error ID from first argument if it's a string literal.
     * @param {object} node - CallExpression or NewExpression node
     * @returns {string|null} Error ID string or null if not a literal
     */
    function getErrorId(node) {
      if (node.arguments.length === 0) return null;
      const firstArg = node.arguments[0];

      // Only handle string literals (not variables or expressions)
      if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
        return firstArg.value;
      }

      return null;
    }

    /**
     * Extracts message prefix from second argument.
     * Handles string literals and template literals with literal prefix.
     * @param {object} node - CallExpression or NewExpression node
     * @returns {string|null} Message prefix or null if cannot determine
     */
    function getMessagePrefix(node) {
      if (node.arguments.length < 2) return null;
      const secondArg = node.arguments[1];

      // String literal: check full value
      if (secondArg.type === 'Literal' && typeof secondArg.value === 'string') {
        return secondArg.value;
      }

      // Template literal: check first quasi (literal part before first expression)
      if (secondArg.type === 'TemplateLiteral' && secondArg.quasis.length > 0) {
        // Only check if first quasi is literal (no complex expression at start)
        return (
          secondArg.quasis[0].value.cooked || secondArg.quasis[0].value.raw
        );
      }

      return null;
    }

    /**
     * Checks if callee is RuntimeError constructor or fromNode factory.
     * @param {object} callee - Callee node
     * @returns {boolean} True if matches RuntimeError or RuntimeError.fromNode
     */
    function isRuntimeErrorCall(callee) {
      // new RuntimeError(...)
      if (callee.type === 'Identifier' && callee.name === 'RuntimeError') {
        return true;
      }

      // RuntimeError.fromNode(...)
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'RuntimeError' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'fromNode'
      ) {
        return true;
      }

      return false;
    }

    /**
     * Reports violation and provides auto-fix.
     * @param {object} node - CallExpression or NewExpression node
     * @param {string} errorId - Error ID string
     * @param {string} messageText - Full message text
     */
    function reportViolation(node, errorId, messageText) {
      const secondArg = node.arguments[1];

      context.report({
        node: secondArg,
        messageId: 'duplicateErrorId',
        data: {
          errorId,
        },
        fix(fixer) {
          const sourceCode = context.sourceCode || context.getSourceCode();
          const originalText = sourceCode.getText(secondArg);

          // Compute the prefix to remove
          const prefix = `${errorId}: `;

          // Handle string literals
          if (secondArg.type === 'Literal') {
            // Preserve original quote style by replacing in source text
            const fixedText = originalText.replace(
              new RegExp(
                `^(['"\`])${errorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `
              ),
              '$1'
            );
            return fixer.replaceText(secondArg, fixedText);
          }

          // Handle template literals
          if (secondArg.type === 'TemplateLiteral') {
            // Replace the prefix in the original source text
            const fixedText = originalText.replace(
              new RegExp(
                `^(\`)${errorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `
              ),
              '$1'
            );
            return fixer.replaceText(secondArg, fixedText);
          }

          return null;
        },
      });
    }

    /**
     * Checks a RuntimeError call node for duplicate error ID.
     * @param {object} node - CallExpression or NewExpression node
     */
    function checkRuntimeError(node) {
      // EC-6: Skip if error ID is not a string literal (variable case)
      const errorId = getErrorId(node);
      if (!errorId) return;

      // EC-7: Skip if message is not determinable (complex expression case)
      const messageText = getMessagePrefix(node);
      if (!messageText) return;

      // Check if message starts with "errorId: "
      const expectedPrefix = `${errorId}: `;
      if (messageText.startsWith(expectedPrefix)) {
        reportViolation(node, errorId, messageText);
      }
    }

    return {
      // Check: new RuntimeError(...)
      NewExpression(node) {
        // EC-5: Ignore non-RuntimeError constructors
        if (!isRuntimeErrorCall(node.callee)) return;
        checkRuntimeError(node);
      },

      // Check: RuntimeError.fromNode(...)
      CallExpression(node) {
        // EC-5: Ignore non-RuntimeError calls
        if (!isRuntimeErrorCall(node.callee)) return;
        checkRuntimeError(node);
      },
    };
  },
};
