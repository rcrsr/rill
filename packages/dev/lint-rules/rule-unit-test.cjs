#!/usr/bin/env node
/**
 * Dependency-free unit-test harness for the custom lint rules.
 *
 * oxlint exposes no RuleTester, and the repo intentionally carries no
 * JavaScript parser (no eslint, no acorn/espree). This harness therefore
 * calls `rule.create(mockContext)` directly and drives the returned AST
 * visitors with hand-built ESTree fixture nodes (a minimal subset of the
 * fields each rule actually reads). Auto-fix cases run the rule's real
 * `fix(fixer)` callback against a mocked `fixer.replaceText` and splice the
 * result into the fixture source, so quote-style preservation and
 * template-literal handling are exercised against real source text.
 *
 * Layout: `tests/harness.cjs` holds the shared fixtures and assertions, and
 * `tests/<rule>.cjs` holds one rule's cases, exporting `{ name, run }`.
 *
 * Run standalone: `rill-test-rules`, or `node lint-rules/rule-unit-test.cjs`
 * from the package root.
 * Wired into: this package's `test` script, and the consuming repository's root
 * `test:rules` script (see package.json).
 */

'use strict';

const { readdirSync } = require('node:fs');
const { check, stats } = require('./tests/harness.cjs');

const suites = [
  require('./tests/no-banned-syntax.cjs'),
  require('./tests/no-dict-bracket-assign.cjs'),
  require('./tests/no-duplicate-error-id.cjs'),
  require('./tests/no-new-runtime-error.cjs'),
  require('./tests/no-spec-id-reference.cjs'),
  require('./tests/rethrow-control-signal.cjs'),
  require('./tests/timing-test-isolation.cjs'),
  require('./tests/use-halt-helpers.cjs'),
];

// Every rule file beside this one needs a suite above. A rule without one
// fails the run, so no rule ships untested.
const NOT_RULES = new Set(['rule-unit-test.cjs', 'types.cjs']);
const covered = new Set(suites.map((suite) => `${suite.name}.cjs`));
for (const file of readdirSync(__dirname)) {
  if (!file.endsWith('.cjs') || NOT_RULES.has(file)) continue;
  check(covered.has(file), `${file} has a suite`, `add tests/${file}`);
}

for (const suite of suites) {
  suite.run();
}

if (stats.fail > 0) {
  console.error(
    `FAIL rule-unit-test: ${stats.fail} failed, ${stats.pass} passed.`
  );
  process.exit(1);
}

const names = suites.map((suite) => suite.name).join(', ');
console.log(`PASS rule-unit-test: ${stats.pass} assertions passed (${names}).`);
