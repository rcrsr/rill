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
 * - a read of `performance.now` or `process.hrtime`, also through
 *   `globalThis.`, `global.` or `window.`, with a string-literal computed
 *   key, or by destructuring (`const { now } = performance`);
 * - an import, dynamic import or require of a module listed in `helpers`,
 *   by string literal or template literal with no substitutions.
 *
 * Files that are not tests (the measurement helpers themselves) are ignored.
 * A use that measures nothing, such as a stub of `performance.now`, takes an
 * `oxlint-disable-next-line` comment stating why.
 *
 * Options: `[{ helpers: ['helpers/scaling', 'percentile'] }]`. Each entry
 * matches a relative module specifier (`./` or `../`) ending in `/<entry>`,
 * after a trailing `.js`, `.ts`, `.mjs`, `.cjs`, `.jsx` or `.tsx` is
 * stripped. A package specifier such as `some-pkg/percentile` never matches.
 *
 * Not auto-fixable: the fix is a file rename or a split.
 */

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const TIMING_FILE = /\.timing\.test\.[cm]?[jt]sx?$/;
const EXTENSION = /\.[cm]?[jt]sx?$/;

/** Global objects through which `performance` and `process` are read. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window']);

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
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return false;
  }
  const bare = specifier.replace(EXTENSION, '');
  return helpers.some((h) => bare.endsWith(`/${h}`));
}

/**
 * @typedef {import('./types.cjs').NodeOf<'MemberExpression'>} MemberExpression
 * @typedef {import('./types.cjs').NodeOf<'Property'>} Property
 * @typedef {MemberExpression['object'] | import('./types.cjs').NodeOf<'VariableDeclarator'>['init']} ClockSource
 * @typedef {import('./types.cjs').NodeOf<'ImportExpression'>['source'] | import('./types.cjs').NodeOf<'CallExpression'>['arguments'][number]} SpecifierSource
 */

/**
 * The static property name of a member read or object-pattern property:
 * `a.b`, `a['b']` and `{ b }` give `b`; any other computed key gives null.
 *
 * @param {MemberExpression | Property} node
 * @returns {string | null}
 */
function propertyName(node) {
  const key = node.type === 'MemberExpression' ? node.property : node.key;
  if (!node.computed && key.type === 'Identifier') return key.name;
  return key.type === 'Literal' && typeof key.value === 'string'
    ? key.value
    : null;
}

/**
 * The clock-owning global an expression names, or null. Accepts
 * `performance` and `globalThis.performance` (or `global.`, `window.`).
 *
 * @param {ClockSource} node
 * @returns {string | null}
 */
function clockOwner(node) {
  if (node?.type === 'Identifier') {
    return CLOCK_READS.has(node.name) ? node.name : null;
  }
  if (
    node?.type !== 'MemberExpression' ||
    node.object.type !== 'Identifier' ||
    !GLOBAL_OBJECTS.has(node.object.name)
  ) {
    return null;
  }
  const name = propertyName(node);
  return name !== null && CLOCK_READS.has(name) ? name : null;
}

/**
 * The string a literal or substitution-free template spells, or null.
 *
 * @param {SpecifierSource | undefined} node
 * @returns {string | null}
 */
function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return node?.type === 'TemplateLiteral' && node.expressions.length === 0
    ? (node.quasis[0]?.value.cooked ?? null)
    : null;
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
     * @param {SpecifierSource} source
     * @param {import('./types.cjs').NodeOf<'ImportDeclaration' | 'ImportExpression' | 'CallExpression'>} node
     */
    function checkSpecifier(source, node) {
      const value = staticString(source);
      if (value !== null && isHelper(value, helpers)) {
        context.report({
          node,
          messageId: 'helperImport',
          data: { what: value },
        });
      }
    }

    return {
      MemberExpression(node) {
        const owner = clockOwner(node.object);
        const name = propertyName(node);
        if (owner !== null && CLOCK_READS.get(owner) === name) {
          context.report({
            node,
            messageId: 'clockRead',
            data: { what: `${owner}.${name}` },
          });
        }
      },
      VariableDeclarator(node) {
        const owner = clockOwner(node.init);
        if (owner === null || node.id.type !== 'ObjectPattern') return;
        for (const prop of node.id.properties) {
          if (prop.type !== 'Property') continue;
          if (propertyName(prop) === CLOCK_READS.get(owner)) {
            context.report({
              node: prop,
              messageId: 'clockRead',
              data: { what: `${owner}.${CLOCK_READS.get(owner)}` },
            });
          }
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
