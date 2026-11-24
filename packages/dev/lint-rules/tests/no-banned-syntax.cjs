/**
 * Unit tests for the `no-banned-syntax` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const noBannedSyntax = require('../no-banned-syntax.cjs');
const { check, makeContext } = require('./harness.cjs');

function runBannedSyntaxTests() {
  // `filename` drives the allowExportAll suffix match.
  /**
   * @param {string} filename
   * @param {'TSEnumDeclaration' | 'ExportDefaultDeclaration' | 'ExportAllDeclaration'} visitorKey
   * @param {unknown[]} [options]
   * @returns {Array<string | undefined>}
   */
  function reportsFor(filename, visitorKey, options) {
    const context = makeContext('', undefined, options);
    context.filename = filename;
    noBannedSyntax.create(context)[visitorKey]({ type: visitorKey });
    return context.reports.map((r) => r.messageId);
  }
  const allow = [{ allowExportAll: ['packages/core/src/types.ts'] }];

  check(
    JSON.stringify(reportsFor('/r/a.ts', 'TSEnumDeclaration')) ===
      JSON.stringify(['noEnum']),
    'no-banned-syntax: enum is reported'
  );
  check(
    JSON.stringify(reportsFor('/r/a.ts', 'ExportDefaultDeclaration')) ===
      JSON.stringify(['noDefaultExport']),
    'no-banned-syntax: export default is reported'
  );
  check(
    JSON.stringify(reportsFor('/r/a.ts', 'ExportAllDeclaration', allow)) ===
      JSON.stringify(['noExportAll']),
    'no-banned-syntax: export * outside the allowlist is reported'
  );
  check(
    reportsFor('/r/packages/core/src/types.ts', 'ExportAllDeclaration', allow)
      .length === 0,
    'no-banned-syntax: export * in an allowlisted file is not reported'
  );
  check(
    reportsFor(
      'C:\\r\\packages\\core\\src\\types.ts',
      'ExportAllDeclaration',
      allow
    ).length === 0,
    'no-banned-syntax: allowlist matches Windows path separators'
  );
}

module.exports = { name: 'no-banned-syntax', run: runBannedSyntaxTests };
