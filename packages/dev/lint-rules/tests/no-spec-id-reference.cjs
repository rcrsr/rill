/**
 * Unit tests for the `no-spec-id-reference` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const noSpecIdReference = require('../no-spec-id-reference.cjs');
const { check, findRange, literalNode, makeContext } = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').FixtureNode} FixtureNode
 */

// Comment fixture: `raw` is the full comment text including `//` or the block
// delimiters, matching the range oxlint hands the rule.
/**
 * @param {string} source
 * @param {string} raw
 * @param {number} [from]
 * @returns {FixtureNode}
 */
function commentNode(source, raw, from) {
  const range = findRange(source, raw, from);
  return { type: raw.startsWith('//') ? 'Line' : 'Block', range };
}

function runSpecIdReferenceTests() {
  // ---- comments ----

  /** @type {Array<{ label: string, source: string, raw: string, expected: string[] }>} */
  const commentCases = [
    {
      label: 'comment: bare EC id is reported',
      source: '// Negative n halts with #INVALID_INPUT (EC-1).',
      raw: '// Negative n halts with #INVALID_INPUT (EC-1).',
      expected: ['EC-1'],
    },
    {
      label: 'comment: compound AC id is captured whole',
      source: '// Component properties (AC-FDL-4)',
      raw: '// Component properties (AC-FDL-4)',
      expected: ['AC-FDL-4'],
    },
    {
      label: 'comment: several ids report in source order',
      source: '// Covers EC-3, IR-8 and NFR-ERR-4 together',
      raw: '// Covers EC-3, IR-8 and NFR-ERR-4 together',
      expected: ['EC-3', 'IR-8', 'NFR-ERR-4'],
    },
    {
      // The whole point of the leading `\b`: rill's own error surface is
      // documented in the error reference and must survive untouched.
      label: 'comment: rill error codes are not spec ids',
      source: '// Halts with RILL-R010 and RILL-P007, sets #TYPE_MISMATCH',
      raw: '// Halts with RILL-R010 and RILL-P007, sets #TYPE_MISMATCH',
      expected: [],
    },
    {
      // A word character before the prefix must defeat the match, or every
      // occurrence of SPEC-, REC-, and ABC- in prose becomes a false positive.
      // One case per prefix that is a suffix of a longer token: EC in SPEC/REC,
      // BC in ABC.
      label: 'comment: prefix embedded in a longer word is ignored',
      source: '// See SPEC-1, REC-2 and the ABC-3 note',
      raw: '// See SPEC-1, REC-2 and the ABC-3 note',
      expected: [],
    },
    {
      label: 'comment: architecture decision record id is reported',
      source: '// Native conversion always returns a value (ADR-0037).',
      raw: '// Native conversion always returns a value (ADR-0037).',
      expected: ['ADR-0037'],
    },
    {
      // ADR must not match as a suffix of a longer token.
      label: 'comment: ADR embedded in a longer word is ignored',
      source: '// The LOADR-1 register and CADR-2 macro',
      raw: '// The LOADR-1 register and CADR-2 macro',
      expected: [],
    },
    {
      label: 'comment: lowercase lookalike is ignored',
      source: '// the ec-1 selector and ac-2 class',
      raw: '// the ec-1 selector and ac-2 class',
      expected: [],
    },
    {
      label: 'comment: hyphenless text short-circuits',
      source: '// No identifiers here at all',
      raw: '// No identifiers here at all',
      expected: [],
    },
    {
      label: 'comment: block comment body is scanned',
      source: '/**\n * - IR-4: component properties\n */',
      raw: '/**\n * - IR-4: component properties\n */',
      expected: ['IR-4'],
    },
  ];

  for (const testCase of commentCases) {
    const comment = commentNode(testCase.source, testCase.raw);
    const context = makeContext(testCase.source, [comment]);
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(testCase.expected),
      testCase.label,
      `expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(found)}`
    );
  }

  // ---- reported location points at the id, not the enclosing comment ----
  {
    const source = '// Negative n halts (EC-1).';
    const comment = commentNode(source, source);
    const context = makeContext(source, [comment]);
    noSpecIdReference.create(context).Program();

    const loc = context.reports.length === 1 ? context.reports[0].loc : null;
    const column = source.indexOf('EC-1');
    check(
      loc !== null &&
        loc.start.line === 1 &&
        loc.start.column === column &&
        loc.end.column === column + 'EC-1'.length,
      'comment: report loc spans exactly the id',
      `expected columns ${column}..${column + 4}, got ${JSON.stringify(loc)}`
    );
  }

  // ---- multi-line block comment reports the id's own line ----
  {
    const source = '/**\n * Reshapes input.\n * - IR-4: properties\n */';
    const comment = commentNode(source, source);
    const context = makeContext(source, [comment]);
    noSpecIdReference.create(context).Program();

    const loc = context.reports.length === 1 ? context.reports[0].loc : null;
    check(
      loc !== null && loc.start.line === 3 && loc.start.column === 5,
      'comment: multi-line block comment reports the id line',
      `expected line 3 column 5, got ${JSON.stringify(loc)}`
    );
  }

  // ---- string literals ----
  {
    const source = "it('AC-49: range produces RILL-R001', fn)";
    const context = makeContext(source);
    const handlers = noSpecIdReference.create(context);
    handlers.Literal(
      literalNode(source, "'AC-49: range produces RILL-R001'").node
    );

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['AC-49']),
      'literal: spec id in a test title is reported, error code is not',
      `expected ["AC-49"], got ${JSON.stringify(found)}`
    );
  }

  // ---- non-string literals are skipped ----
  {
    const source = 'const n = 42;';
    const context = makeContext(source);
    noSpecIdReference.create(context).Literal({
      type: 'Literal',
      value: 42,
      // A range covering text with an id would still report if the typeof
      // guard were dropped, which is what this case pins.
      range: [0, source.length],
    });
    check(
      context.reports.length === 0,
      'literal: non-string literal is skipped',
      `expected 0 reports, got ${context.reports.length}`
    );
  }

  // ---- template-literal chunks ----
  {
    const source = 'const msg = `EC-2 path: ${p}`;';
    const context = makeContext(source);
    const range = findRange(source, 'EC-2 path: ');
    noSpecIdReference.create(context).TemplateElement({
      type: 'TemplateElement',
      range,
      value: { cooked: 'EC-2 path: ', raw: 'EC-2 path: ' },
    });

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['EC-2']),
      'template: chunk between substitutions is scanned',
      `expected ["EC-2"], got ${JSON.stringify(found)}`
    );
  }

  // ---- JSX text ----
  {
    const source = '<p>Output panel (UXT-LOOP-1)</p>';
    const context = makeContext(source);
    const range = findRange(source, 'Output panel (UXT-LOOP-1)');
    noSpecIdReference
      .create(context)
      .JSXText({ type: 'JSXText', range, value: source.slice(...range) });

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['UXT-LOOP-1']),
      'jsx: text node is scanned',
      `expected ["UXT-LOOP-1"], got ${JSON.stringify(found)}`
    );
  }

  // ---- the module-level /g regex must not carry lastIndex between scans ----
  {
    const source = '// EC-1 here\n// EC-2 there';
    const first = commentNode(source, '// EC-1 here');
    const second = commentNode(source, '// EC-2 there');
    const context = makeContext(source, [first, second]);
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['EC-1', 'EC-2']),
      'state: consecutive scans both report (regex lastIndex is reset)',
      `expected ["EC-1","EC-2"], got ${JSON.stringify(found)}`
    );
  }

  // ---- messageId is stable ----
  {
    const source = '// AC-1';
    const context = makeContext(source, [commentNode(source, source)]);
    noSpecIdReference.create(context).Program();
    check(
      context.reports.length === 1 &&
        context.reports[0].messageId === 'specIdReference',
      'meta: reports use the specIdReference messageId',
      `got ${JSON.stringify(context.reports.map((r) => r.messageId))}`
    );
  }

  // ---- options: ignore list whitelists exact-match incidental ids ----
  {
    const source =
      '// Written as DD-MM-YYYY, tracked as TC-39, resolved OK-1 (see EC-1 and AC-16)';
    const context = makeContext(
      source,
      [commentNode(source, source)],
      [{ ignore: ['DD-MM-YYYY', 'TC-39', 'OK-1'] }]
    );
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['EC-1', 'AC-16']),
      'options: ignored ids are not reported, others still are',
      `expected ["EC-1","AC-16"], got ${JSON.stringify(found)}`
    );
  }

  // ---- options: without ignore, the same incidental ids still report ----
  {
    const source = '// Written as DD-MM-YYYY, tracked as TC-39, resolved OK-1';
    const context = makeContext(source, [commentNode(source, source)]);
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['DD-MM-YYYY', 'TC-39', 'OK-1']),
      'options: absent ignore option reports every matched id',
      `expected ["DD-MM-YYYY","TC-39","OK-1"], got ${JSON.stringify(found)}`
    );
  }

  // ---- options: ignore is an exact-match whitelist, not a prefix filter ----
  {
    const source = '// LOG-LEVEL is set, but LOG-9 is not';
    const context = makeContext(
      source,
      [commentNode(source, source)],
      [{ ignore: ['LOG-LEVEL'] }]
    );
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['LOG-9']),
      'options: ignore matches the full id only, siblings still report',
      `expected ["LOG-9"], got ${JSON.stringify(found)}`
    );
  }

  // ---- options: ignore:['TC-39'] suppresses only TC-39, EC-1 still fires ----
  {
    const source = '// TC-39 filed alongside EC-1';
    const context = makeContext(
      source,
      [commentNode(source, source)],
      [{ ignore: ['TC-39'] }]
    );
    noSpecIdReference.create(context).Program();

    const found = context.reports.map((r) => r.data.specId);
    check(
      JSON.stringify(found) === JSON.stringify(['EC-1']),
      'options: ignore:["TC-39"] suppresses TC-39 while EC-1 still fires',
      `expected ["EC-1"], got ${JSON.stringify(found)}`
    );
  }
}

module.exports = { name: 'no-spec-id-reference', run: runSpecIdReferenceTests };
