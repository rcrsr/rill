/**
 * ESLint Rule: no-banned-syntax
 *
 * Rejects TypeScript syntax the codebase replaces with a safer form:
 * - `enum`: use an `as const` object, which tree-shakes and keeps string
 *   values visible in error messages.
 * - `export default`: use named exports, so barrel files list every export.
 * - `export * from`: list exports by name, so the public surface stays
 *   explicit and re-export cycles stay visible.
 *
 * Options: `[{ allowExportAll: ['packages/core/src/types.ts'] }]` exempts
 * files whose path ends with a listed suffix from the `export *` check.
 *
 * Not auto-fixable: each replacement needs a naming decision.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow enum, default exports, and export-all',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowExportAll: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noEnum: 'Use an `as const` object instead of `enum`.',
      noDefaultExport: 'Use a named export instead of `export default`.',
      noExportAll: 'List exports by name instead of `export * from`.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const allowExportAll = options.allowExportAll ?? [];
    const filename = String(context.filename ?? '').replaceAll('\\', '/');
    const exportAllAllowed = allowExportAll.some((suffix) =>
      filename.endsWith(suffix)
    );

    return {
      TSEnumDeclaration(node) {
        context.report({ node, messageId: 'noEnum' });
      },
      ExportDefaultDeclaration(node) {
        context.report({ node, messageId: 'noDefaultExport' });
      },
      ExportAllDeclaration(node) {
        if (!exportAllAllowed) {
          context.report({ node, messageId: 'noExportAll' });
        }
      },
    };
  },
};
