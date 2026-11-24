/**
 * Unit tests for the `timing-test-isolation` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const timingTestIsolation = require('../timing-test-isolation.cjs');
const { check, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 */

// Each case is [filename, code, reported]. `code` is a short descriptor:
// `a.b` or `a[b]` is a member read, and `import`, `import()` or `require`
// followed by a specifier is that form of module load.
function runTimingTestIsolationTests() {
  /** @param {string} name @returns {FixtureNode} */
  const id = (name) => ({ type: 'Identifier', name });
  /** @param {string} code @returns {[string, FixtureNode]} */
  function build(code) {
    const [form, spec = ''] = code.split(' ');
    const source = { type: 'Literal', value: spec };
    if (form === 'import') return ['ImportDeclaration', { source }];
    if (form === 'import()') return ['ImportExpression', { source }];
    if (form === 'require') {
      return ['CallExpression', { callee: id(form), arguments: [source] }];
    }
    const [object = '', property = ''] = code.split(/[.[\]]/);
    const computed = code.includes('[');
    const node = { computed, object: id(object), property: id(property) };
    return ['MemberExpression', node];
  }
  /** @type {Array<[string, string, boolean]>} */
  const cases = [
    ['a.test.ts', 'performance.now', true],
    ['a.test.tsx', 'process.hrtime', true],
    ['a.test.ts', 'Date.now', false],
    ['a.test.ts', 'performance[now]', false],
    ['a.timing.test.ts', 'performance.now', false],
    ['percentile.ts', 'performance.now', false],
    ['a.test.ts', 'import ./percentile.js', true],
    ['a.test.ts', 'import ../helpers/scaling.js', true],
    ['a.test.ts', 'import ./not-percentile.js', false],
    ['a.test.ts', 'import() ./percentile', true],
    ['a.test.ts', 'require ./percentile.cjs', true],
    ['a.timing.test.ts', 'import ./percentile.js', false],
  ];
  const options = [{ helpers: ['helpers/scaling', 'percentile'] }];
  for (const [filename, code, reported] of cases) {
    const context = makeContext('', [], options);
    context.filename = `/r/src/${filename}`;
    const [visitorKey, node] = build(code);
    timingTestIsolation.create(context)[visitorKey]?.(node);
    check(
      (context.reports.length === 1) === reported,
      `timing-test-isolation: ${code} in ${filename}`,
      `got ${context.reports.length} reports`
    );
  }
}

module.exports = {
  name: 'timing-test-isolation',
  run: runTimingTestIsolationTests,
};
