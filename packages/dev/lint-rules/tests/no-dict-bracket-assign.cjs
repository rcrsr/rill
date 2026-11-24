/**
 * Unit tests for the `no-dict-bracket-assign` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const noDictBracketAssign = require('../no-dict-bracket-assign.cjs');
const { check, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 * @typedef {import('./harness.cjs').Report} Report
 */

function runDictBracketAssignTests() {
  /** @param {string} name @returns {FixtureNode} */
  const id = (name) => ({ type: 'Identifier', name });
  /** @param {string} method @returns {FixtureNode} */
  function objectCall(method) {
    return {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: id('Object'),
        property: id(method),
      },
      arguments: [id('src')],
    };
  }
  /** @param {string} method @param {FixtureNode} binding @returns {FixtureNode} */
  function forOf(method, binding) {
    return {
      type: 'ForOfStatement',
      left: {
        type: 'VariableDeclaration',
        declarations: [{ id: binding }],
      },
      right: objectCall(method),
    };
  }
  /** @param {string} key @param {string} [operator] @param {boolean} [computed] @returns {FixtureNode} */
  function assign(key, operator, computed) {
    return {
      type: 'AssignmentExpression',
      operator: operator ?? '=',
      left: {
        type: 'MemberExpression',
        computed: computed ?? true,
        object: id('out'),
        property: id(key),
      },
    };
  }
  // Drives enter → assignment → exit, then an assignment after the loop.
  /** @param {FixtureNode} loop @param {FixtureNode} inside @param {FixtureNode} [after] @returns {Report[]} */
  function run(loop, inside, after) {
    const context = makeContext('');
    const v = noDictBracketAssign.create(context);
    v.ForOfStatement(loop);
    v.AssignmentExpression(inside);
    v['ForOfStatement:exit'](loop);
    if (after) v.AssignmentExpression(after);
    return context.reports;
  }
  const pair = { type: 'ArrayPattern', elements: [id('k'), id('v')] };

  check(
    run(forOf('entries', pair), assign('k')).length === 1,
    'no-dict-bracket-assign: out[k] = v in an Object.entries loop is reported'
  );
  check(
    run(forOf('keys', id('k')), assign('k')).length === 1,
    'no-dict-bracket-assign: out[k] = v in an Object.keys loop is reported'
  );
  check(
    run(forOf('entries', pair), assign('other')).length === 0,
    'no-dict-bracket-assign: a key other than the loop binding is ignored'
  );
  check(
    run(forOf('entries', pair), assign('k', '+=')).length === 0,
    'no-dict-bracket-assign: compound assignment is ignored'
  );
  check(
    run(forOf('entries', pair), assign('k', '=', false)).length === 0,
    'no-dict-bracket-assign: non-computed out.k = v is ignored'
  );
  check(
    run(forOf('values', id('k')), assign('k')).length === 0,
    'no-dict-bracket-assign: Object.values loops are ignored'
  );
  check(
    run(forOf('entries', pair), assign('other'), assign('k')).length === 0,
    'no-dict-bracket-assign: the binding is out of scope after the loop exits'
  );
}

module.exports = {
  name: 'no-dict-bracket-assign',
  run: runDictBracketAssignTests,
};
