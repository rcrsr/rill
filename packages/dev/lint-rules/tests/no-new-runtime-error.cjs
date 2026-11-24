/**
 * Unit tests for the `no-new-runtime-error` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const noNewRuntimeError = require('../no-new-runtime-error.cjs');
const { check, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 */

function runNewRuntimeErrorTests() {
  /** @param {string} name @returns {FixtureNode} */
  const id = (name) => ({ type: 'Identifier', name });
  /** @param {'NewExpression' | 'CallExpression'} visitorKey @param {FixtureNode} node @returns {number} */
  function reports(visitorKey, node) {
    const context = makeContext('');
    noNewRuntimeError.create(context)[visitorKey](node);
    return context.reports.length;
  }
  /** @param {string} object @param {boolean} [computed] @returns {FixtureNode} */
  const fromNode = (object, computed) => ({
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: computed ?? false,
      object: id(object),
      property: id('fromNode'),
    },
  });

  check(
    reports('NewExpression', { callee: id('RuntimeError') }) === 1,
    'no-new-runtime-error: new RuntimeError() is reported'
  );
  check(
    reports('NewExpression', { callee: id('TypeError') }) === 0,
    'no-new-runtime-error: other constructors are ignored'
  );
  check(
    reports('CallExpression', fromNode('RuntimeError')) === 1,
    'no-new-runtime-error: RuntimeError.fromNode() is reported'
  );
  check(
    reports('CallExpression', fromNode('ParseError')) === 0,
    'no-new-runtime-error: fromNode on another class is ignored'
  );
}

module.exports = { name: 'no-new-runtime-error', run: runNewRuntimeErrorTests };
