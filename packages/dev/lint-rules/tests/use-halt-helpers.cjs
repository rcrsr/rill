/**
 * Unit tests for the `use-halt-helpers` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const useHaltHelpers = require('../use-halt-helpers.cjs');
const { check, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 */

function runHaltHelpersTests() {
  /** @param {string} name @returns {FixtureNode} */
  const id = (name) => ({ type: 'Identifier', name });
  /** @param {FixtureNode} object @param {string} property @returns {FixtureNode} */
  const member = (object, property) => ({
    type: 'MemberExpression',
    computed: false,
    object,
    property: id(property),
  });
  /** @param {FixtureNode} node @returns {Array<string | undefined>} */
  function reports(node) {
    const context = makeContext('');
    useHaltHelpers.create(context).MemberExpression(node);
    return context.reports.map((r) => r.data.matcher);
  }
  const expectCall = { type: 'CallExpression', callee: id('expect') };

  check(
    JSON.stringify(
      reports(member(member(expectCall, 'rejects'), 'toThrow'))
    ) === JSON.stringify(['toThrow']),
    'use-halt-helpers: .rejects.toThrow is reported'
  );
  check(
    JSON.stringify(
      reports(member(member(expectCall, 'rejects'), 'toThrowError'))
    ) === JSON.stringify(['toThrowError']),
    'use-halt-helpers: .rejects.toThrowError is reported'
  );
  check(
    reports(member(expectCall, 'toThrow')).length === 0,
    'use-halt-helpers: a synchronous .toThrow is ignored'
  );
  check(
    reports(member(member(expectCall, 'resolves'), 'toThrow')).length === 0,
    'use-halt-helpers: .resolves.toThrow is ignored'
  );
}

module.exports = { name: 'use-halt-helpers', run: runHaltHelpersTests };
