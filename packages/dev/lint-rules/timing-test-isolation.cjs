/**
 * ESLint Rule: timing-test-isolation
 *
 * A test that asserts on wall-clock time must run alone, after the rest of
 * the suite, or another test file competing for the CPU moves its
 * measurement. The vitest configs run `*.timing.test.*` files as a separate
 * project with `fileParallelism: false` in a later group. A wall-clock
 * measurement in any other test file runs beside the unit files and flakes
 * under load, so this rule reports it.
 *
 * Reported in a `*.test.*` file not named `*.timing.test.*`:
 * - a read of `performance.now` or `process.hrtime`;
 * - an import, dynamic import or require of a module listed in `helpers`.
 *
 * Files that are not tests (the measurement helpers themselves) are ignored.
 * A use that measures nothing, such as a stub of `performance.now`, takes an
 * `oxlint-disable-next-line` comment stating why.
 *
 * Options: `[{ helpers: ['helpers/scaling', 'percentile'] }]`. Each entry
 * matches a module specifier equal to it or ending in `/<entry>`, after a
 * trailing `.js`, `.ts`, `.mjs`, `.cjs`, `.jsx` or `.tsx` is stripped.
 *
 * Not auto-fixable: the fix is a file rename or a split.
 */

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const TIMING_FILE = /\.timing\.test\.[cm]?[jt]sx?$/;
const EXTENSION = /\.[cm]?[jt]sx?$/;

/** Clock reads keyed by global object name. */
const CLOCK_READS = new Map([
  ['performance', 'now'],
  ['process', 'hrtime'],
]);

/**
 * @param {string} specifier
 * @param {string[]} helpers
 * @returns {boolean}
 */
function isHelper(specifier, helpers) {
  const bare = specifier.replace(EXTENSION, '');
  return helpers.some((h) => bare === h || bare.endsWith(`/${h}`));
}

/** @type {import('./types.cjs').Rule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require wall-clock measurements in tests to live in *.timing.test.* files',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          helpers: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      clockRead:
        '{{what}} measures wall-clock time in a test not named *.timing.test.*. Move the timed test to a *.timing.test.* file so it runs isolated.',
      helperImport:
        "'{{what}}' is a timing helper imported by a test not named *.timing.test.*. Move the timed test to a *.timing.test.* file so it runs isolated.",
    },
  },

  create(context) {
    const filename = String(context.filename ?? '').replaceAll('\\', '/');
    if (!TEST_FILE.test(filename) || TIMING_FILE.test(filename)) return {};

    const options = /** @type {{ helpers?: string[] } | undefined} */ (
      context.options[0]
    );
    const helpers = options?.helpers ?? [];

    /**
     * @param {{ type: string, value?: unknown }} source
     * @param {import('./types.cjs').NodeOf<'ImportDeclaration' | 'ImportExpression' | 'CallExpression'>} node
     */
    function checkSpecifier(source, node) {
      if (
        source.type === 'Literal' &&
        typeof source.value === 'string' &&
        isHelper(source.value, helpers)
      ) {
        context.report({
          node,
          messageId: 'helperImport',
          data: { what: source.value },
        });
      }
    }

    return {
      MemberExpression(node) {
        if (
          node.computed ||
          node.object.type !== 'Identifier' ||
          node.property.type !== 'Identifier'
        ) {
          return;
        }
        if (CLOCK_READS.get(node.object.name) === node.property.name) {
          context.report({
            node,
            messageId: 'clockRead',
            data: { what: `${node.object.name}.${node.property.name}` },
          });
        }
      },
      ImportDeclaration(node) {
        checkSpecifier(node.source, node);
      },
      ImportExpression(node) {
        checkSpecifier(node.source, node);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0
        ) {
          checkSpecifier(node.arguments[0], node);
        }
      },
    };
  },
};
