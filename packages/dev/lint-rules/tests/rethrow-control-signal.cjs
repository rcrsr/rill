/**
 * Unit tests for the `rethrow-control-signal` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const rethrowControlSignal = require('../rethrow-control-signal.cjs');
const { check, findRange, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 */

function runRethrowControlSignalTests() {
  // `tryText` and `catchText` are the brace-delimited block texts; the rule
  // reads them through getText, and reads `bodyStatements` structurally.
  /** @param {string} tryText @param {string} catchText @param {string | null} param @param {FixtureNode[]} [bodyStatements] @param {unknown[]} [options] @returns {number} */
  function run(tryText, catchText, param, bodyStatements, options) {
    const source = `try ${tryText} catch ${catchText}`;
    const tryRange = findRange(source, tryText);
    const catchRange = findRange(source, catchText, tryRange[1]);
    const context = makeContext(source, undefined, options);
    rethrowControlSignal.create(context).TryStatement({
      type: 'TryStatement',
      block: { type: 'BlockStatement', range: tryRange },
      handler: {
        type: 'CatchClause',
        param: param !== null ? { type: 'Identifier', name: param } : null,
        body: {
          type: 'BlockStatement',
          range: catchRange,
          body: bodyStatements ?? [],
        },
      },
    });
    return context.reports.length;
  }
  /** @param {string} name @returns {FixtureNode} */
  const rethrow = (name) => ({
    type: 'ThrowStatement',
    argument: { type: 'Identifier', name },
  });
  const evalTry = '{ await evaluateBody(s, b); }';

  check(
    run(evalTry, '{ convert(e); }', 'e') === 1,
    'rethrow-control-signal: converting catch around evaluate* is reported'
  );
  check(
    run('{ await cb.fn(args); }', '{ }', null) === 1,
    'rethrow-control-signal: empty catch around .fn( is reported'
  );
  check(
    run('{ JSON.parse(x); }', '{ }', null) === 0,
    'rethrow-control-signal: a try that runs no rill code is ignored'
  );
  check(
    run(
      evalTry,
      '{ if (e instanceof ControlSignal) throw e; convert(e); }',
      'e'
    ) === 0,
    'rethrow-control-signal: a catch naming ControlSignal passes'
  );
  check(
    run(evalTry, '{ rejectBreakAsHalt(e, site); throw e; }', 'e') === 0,
    'rethrow-control-signal: a catch calling rejectBreakAsHalt passes'
  );
  check(
    run(evalTry, '{ log(e); throw e; }', 'e', [rethrow('e')]) === 0,
    'rethrow-control-signal: a trailing rethrow of the binding passes'
  );
  check(
    run(evalTry, '{ log(e); throw other; }', 'e', [rethrow('other')]) === 1,
    'rethrow-control-signal: throwing a different value is reported'
  );
  check(
    run(evalTry, '{ if (ok) { use(); } else { throw e; } }', 'e', [
      {
        type: 'IfStatement',
        alternate: { type: 'BlockStatement', body: [rethrow('e')] },
      },
    ]) === 0,
    'rethrow-control-signal: a rethrow in the trailing else branch passes'
  );
  check(
    run(
      evalTry,
      '{ return reshapeHostThrow(e); }',
      'e',
      [],
      [{ delegates: ['reshapeHostThrow'] }]
    ) === 0,
    'rethrow-control-signal: a call to a listed delegate passes'
  );
  check(
    run(evalTry, '{ return reshapeHostThrow(e); }', 'e') === 1,
    'rethrow-control-signal: an unlisted handler call is reported'
  );
  check(
    run(evalTry, '{ /* ControlSignal */ convert(e); } // BreakSignal', 'e') ===
      1,
    'rethrow-control-signal: a signal named only in a comment is reported'
  );
  check(
    run(evalTry, '{ // rejectBreakAsHalt\n convert(e); }', 'e') === 1,
    'rethrow-control-signal: a signal named only in a line comment is reported'
  );
  check(
    run(
      evalTry,
      '{ return reshape(e); }',
      'e',
      [],
      [{ delegates: ['a(b', '.*'] }]
    ) === 1,
    'rethrow-control-signal: a delegate name with regex metacharacters does not throw'
  );
}

module.exports = {
  name: 'rethrow-control-signal',
  run: runRethrowControlSignalTests,
};
