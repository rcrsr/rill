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
// `a.b`, `a.b.c`, `a[b]` or `a['b']` is a member read; `const {k} = a.b` is a
// destructuring read; `import`, `import()`, `import\`` (a template-literal
// dynamic import) or `require` followed by a specifier is a module load.
function runTimingTestIsolationTests() {
  /** @param {string} name @returns {FixtureNode} */
  const id = (name) => ({ type: 'Identifier', name });
  /** @param {string} value @returns {FixtureNode} */
  const lit = (value) => ({ type: 'Literal', value });
  /**
   * `a.b.c` builds nested reads; `a['b']` is a computed string-literal key;
   * `a[b]` is a computed identifier key.
   * @param {string} path @returns {FixtureNode}
   */
  function member(path) {
    const [head = '', ...rest] = path.split('.');
    /** @type {FixtureNode} */
    let node = id(head);
    for (const part of rest) {
      node = {
        type: 'MemberExpression',
        computed: false,
        object: node,
        property: id(part),
      };
    }
    return node;
  }
  /** @param {string} code @returns {[string, FixtureNode]} */
  function build(code) {
    const [form, spec = ''] = code.split(' ');
    const source = lit(spec);
    if (form === 'import') return ['ImportDeclaration', { source }];
    if (form === 'import`') {
      const quasis = [{ type: 'TemplateElement', value: { cooked: spec } }];
      const template = { type: 'TemplateLiteral', expressions: [], quasis };
      return ['ImportExpression', { source: template }];
    }
    if (form === 'const') {
      // `const {key} = init`
      const key = code.slice(code.indexOf('{') + 1, code.indexOf('}'));
      const init = member(code.slice(code.indexOf('= ') + 2));
      const prop = { type: 'Property', computed: false, key: id(key) };
      const pattern = { type: 'ObjectPattern', properties: [prop] };
      return ['VariableDeclarator', { id: pattern, init }];
    }
    if (form === 'import()') return ['ImportExpression', { source }];
    if (form === 'require') {
      return ['CallExpression', { callee: id(form), arguments: [source] }];
    }
    const bracket = code.indexOf('[');
    if (bracket !== -1) {
      const key = code.slice(bracket + 1, -1);
      const quoted = key.startsWith("'");
      const property = quoted ? lit(key.slice(1, -1)) : id(key);
      const object = member(code.slice(0, bracket));
      const node = {
        type: 'MemberExpression',
        computed: true,
        object,
        property,
      };
      return ['MemberExpression', node];
    }
    const node = member(code);
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
    ['a.test.ts', 'globalThis.performance.now', true],
    ['a.test.ts', 'global.process.hrtime', true],
    ['a.test.ts', 'window.performance.now', true],
    ['a.test.ts', 'globalThis.Date.now', false],
    ['a.test.ts', "performance['now']", true],
    ['a.test.ts', 'const {now} = performance', true],
    ['a.test.ts', 'const {hrtime} = globalThis.process', true],
    ['a.test.ts', 'const {timeOrigin} = performance', false],
    ['a.timing.test.ts', 'const {now} = performance', false],
    ['a.test.ts', 'import` ./percentile.js', true],
    ['a.test.ts', 'import some-pkg/percentile', false],
    ['a.test.ts', 'import percentile', false],
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
