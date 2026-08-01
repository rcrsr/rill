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
 * Run standalone: `node dev/lint-rules/rule-unit-test.cjs`
 * Wired into: the root `test:rules` script (see package.json).
 */

'use strict';

const path = require('path');

const noDuplicateErrorId = require(
  path.join(__dirname, 'no-duplicate-error-id.cjs')
);
const noSpecIdReference = require(
  path.join(__dirname, 'no-spec-id-reference.cjs')
);

const stats = { pass: 0, fail: 0 };

function fail(label, detail) {
  stats.fail++;
  console.error(`FAIL: ${label}`);
  if (detail !== undefined) console.error(`  ${detail}`);
}

function pass(label) {
  stats.pass++;
  void label;
}

function check(condition, label, detail) {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail);
  }
}

// ============================================================
// Fixture builders — minimal ESTree nodes, positioned by locating
// their literal text within the fixture source string.
// ============================================================

function findRange(source, text, from) {
  const start = source.indexOf(text, from ?? 0);
  if (start === -1) {
    throw new Error(
      `fixture text not found in source: ${JSON.stringify(text)}`
    );
  }
  return [start, start + text.length];
}

// String literal fixture. `quoted` includes the surrounding quote chars,
// e.g. "'RILL-R001'".
function literalNode(source, quoted, from) {
  const range = findRange(source, quoted, from);
  return {
    node: { type: 'Literal', value: quoted.slice(1, -1), range },
    end: range[1],
  };
}

function identifierNode(source, name, from) {
  const range = findRange(source, name, from);
  return { node: { type: 'Identifier', name, range }, end: range[1] };
}

// Template literal fixture. `raw` is the full backtick-delimited text;
// `firstQuasiCooked` is the literal prefix before the first `${`.
function templateLiteralNode(source, raw, firstQuasiCooked, from) {
  const range = findRange(source, raw, from);
  return {
    node: {
      type: 'TemplateLiteral',
      range,
      quasis: [{ value: { cooked: firstQuasiCooked, raw: firstQuasiCooked } }],
    },
    end: range[1],
  };
}

function memberExpressionNode(objectNode, propertyNode) {
  return {
    type: 'MemberExpression',
    object: objectNode,
    property: propertyNode,
    range: [objectNode.range[0], propertyNode.range[1]],
  };
}

// ============================================================
// Mock context / fixer
// ============================================================

// `comments` is the fixture comment list for rules that sweep them; rules that
// only walk the AST never call getAllComments and can omit it.
function makeContext(source, comments) {
  const reports = [];
  return {
    reports,
    report(descriptor) {
      reports.push(descriptor);
    },
    sourceCode: {
      text: source,
      getText(node) {
        return source.slice(node.range[0], node.range[1]);
      },
      getAllComments() {
        return comments ?? [];
      },
      // Real line/column arithmetic, so a rule reporting by `loc` is checked
      // against positions a reader can look up in the fixture source.
      getLocFromIndex(index) {
        const before = source.slice(0, index);
        const line = before.split('\n').length;
        return { line, column: index - (before.lastIndexOf('\n') + 1) };
      },
    },
  };
}

const fixer = {
  replaceText(node, text) {
    return { range: node.range, text };
  },
};

function applyFixes(source, edits) {
  const sorted = [...edits].sort((a, b) => b.range[0] - a.range[0]);
  let out = source;
  for (const edit of sorted) {
    out = out.slice(0, edit.range[0]) + edit.text + out.slice(edit.range[1]);
  }
  return out;
}

// ============================================================
// no-duplicate-error-id
// ============================================================

function runDuplicateErrorIdTests() {
  const visitors = noDuplicateErrorId.create(makeContext(''));
  void visitors; // built per-case below (context depends on source)

  // ---- valid cases (no report expected) ----

  const validCases = [
    {
      label: 'valid: new RuntimeError with clean message',
      build(source) {
        const errId = literalNode(source, "'RILL-R001'");
        const msg = literalNode(source, "'Variable not defined'", errId.end);
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "new RuntimeError('RILL-R001', 'Variable not defined')",
    },
    {
      label: 'valid: RuntimeError.fromNode with clean message',
      build(source) {
        const obj = identifierNode(source, 'RuntimeError');
        const prop = identifierNode(source, 'fromNode', obj.end);
        const errId = literalNode(source, "'RILL-R002'", prop.end);
        const msg = literalNode(source, "'Type mismatch'", errId.end);
        const node = identifierNode(source, 'node', msg.end);
        return {
          type: 'CallExpression',
          callee: memberExpressionNode(obj.node, prop.node),
          arguments: [errId.node, msg.node, node.node],
        };
      },
      visitorKey: 'CallExpression',
      source: "RuntimeError.fromNode('RILL-R002', 'Type mismatch', node)",
    },
    {
      // non-RuntimeError constructor: callee name gate must reject it even
      // though the message argument has a duplicate-looking ID prefix.
      label: 'valid: non-RuntimeError constructor (Error) is ignored',
      build(source) {
        const errId = literalNode(source, "'RILL-R001'");
        const msg = literalNode(source, "'RILL-R001: Some error'", errId.end);
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'Error').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "throw new Error('RILL-R001', 'RILL-R001: Some error')",
    },
    {
      // non-RuntimeError constructor: callee name gate must reject it even
      // though the message argument has a duplicate-looking ID prefix.
      label: 'valid: non-RuntimeError constructor (TypeError) is ignored',
      build(source) {
        const errId = literalNode(source, "'RILL-R002'");
        const msg = literalNode(source, "'RILL-R002: Type error'", errId.end);
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'TypeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "throw new TypeError('RILL-R002', 'RILL-R002: Type error')",
    },
    {
      // dynamic (variable) error ID: cannot be statically validated
      label: 'valid: dynamic (variable) error ID is ignored',
      build(source) {
        const errId = identifierNode(source, 'errorId');
        const msg = literalNode(source, "'RILL-R001: Message'", errId.end);
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "new RuntimeError(errorId, 'RILL-R001: Message')",
    },
    {
      // dynamic (variable) error ID, fromNode variant
      label:
        'valid: dynamic (variable) error ID is ignored (RuntimeError.fromNode)',
      build(source) {
        const obj = identifierNode(source, 'RuntimeError');
        const prop = identifierNode(source, 'fromNode', obj.end);
        const errId = identifierNode(source, 'myErrorId', prop.end);
        const msg = literalNode(source, "'RILL-R002: Message'", errId.end);
        const node = identifierNode(source, 'node', msg.end);
        return {
          type: 'CallExpression',
          callee: memberExpressionNode(obj.node, prop.node),
          arguments: [errId.node, msg.node, node.node],
        };
      },
      visitorKey: 'CallExpression',
      source: "RuntimeError.fromNode(myErrorId, 'RILL-R002: Message', node)",
    },
    {
      // template literal whose leading quasi is empty (expression comes
      // first), so the prefix cannot be determined statically.
      label: 'valid: template literal with leading expression is ignored',
      build(source) {
        const errId = literalNode(source, "'RILL-R001'");
        const msg = templateLiteralNode(
          source,
          '`${prefix}: Message`',
          '',
          errId.end
        );
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "new RuntimeError('RILL-R001', `${prefix}: Message`)",
    },
    {
      label: 'valid: template literal without duplicate prefix',
      build(source) {
        const errId = literalNode(source, "'RILL-R001'");
        const msg = templateLiteralNode(
          source,
          '`Variable ${name} not found`',
          'Variable ',
          errId.end
        );
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
      source: "new RuntimeError('RILL-R001', `Variable ${name} not found`)",
    },
  ];

  for (const testCase of validCases) {
    const context = makeContext(testCase.source);
    const handlers = noDuplicateErrorId.create(context);
    const node = testCase.build(testCase.source);
    handlers[testCase.visitorKey](node);
    check(
      context.reports.length === 0,
      testCase.label,
      `expected 0 reports, got ${context.reports.length}`
    );
  }

  // ---- invalid cases (report + auto-fix output expected) ----

  const invalidCases = [
    {
      label: 'invalid: new RuntimeError string-literal duplicate ID auto-fixed',
      source:
        "new RuntimeError('RILL-R001', 'RILL-R001: Variable not defined')",
      expectedOutput: "new RuntimeError('RILL-R001', 'Variable not defined')",
      errorId: 'RILL-R001',
      build(source) {
        const errId = literalNode(source, "'RILL-R001'");
        const msg = literalNode(
          source,
          "'RILL-R001: Variable not defined'",
          errId.end
        );
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
    },
    {
      label:
        'invalid: RuntimeError.fromNode string-literal duplicate ID auto-fixed',
      source:
        "RuntimeError.fromNode('RILL-R002', 'RILL-R002: Type mismatch', node)",
      expectedOutput:
        "RuntimeError.fromNode('RILL-R002', 'Type mismatch', node)",
      errorId: 'RILL-R002',
      build(source) {
        const obj = identifierNode(source, 'RuntimeError');
        const prop = identifierNode(source, 'fromNode', obj.end);
        const errId = literalNode(source, "'RILL-R002'", prop.end);
        const msg = literalNode(
          source,
          "'RILL-R002: Type mismatch'",
          errId.end
        );
        const node = identifierNode(source, 'node', msg.end);
        return {
          type: 'CallExpression',
          callee: memberExpressionNode(obj.node, prop.node),
          arguments: [errId.node, msg.node, node.node],
        };
      },
      visitorKey: 'CallExpression',
    },
    {
      // Template-literal auto-fix path — validates backtick-aware regex handling.
      label: 'invalid: template-literal duplicate ID auto-fixed',
      source:
        "new RuntimeError('RILL-R003', `RILL-R003: Timeout after ${ms}ms`)",
      expectedOutput: "new RuntimeError('RILL-R003', `Timeout after ${ms}ms`)",
      errorId: 'RILL-R003',
      build(source) {
        const errId = literalNode(source, "'RILL-R003'");
        const msg = templateLiteralNode(
          source,
          '`RILL-R003: Timeout after ${ms}ms`',
          'RILL-R003: Timeout after ',
          errId.end
        );
        return {
          type: 'NewExpression',
          callee: identifierNode(source, 'RuntimeError').node,
          arguments: [errId.node, msg.node],
        };
      },
      visitorKey: 'NewExpression',
    },
  ];

  for (const testCase of invalidCases) {
    const context = makeContext(testCase.source);
    const handlers = noDuplicateErrorId.create(context);
    const node = testCase.build(testCase.source);
    handlers[testCase.visitorKey](node);

    check(
      context.reports.length === 1,
      `${testCase.label} (report count)`,
      `expected 1 report, got ${context.reports.length}`
    );
    if (context.reports.length !== 1) continue;

    const report = context.reports[0];
    check(
      report.messageId === 'duplicateErrorId',
      `${testCase.label} (messageId)`,
      `expected 'duplicateErrorId', got ${JSON.stringify(report.messageId)}`
    );
    check(
      report.data && report.data.errorId === testCase.errorId,
      `${testCase.label} (data.errorId)`,
      `expected ${JSON.stringify(testCase.errorId)}, got ${JSON.stringify(report.data && report.data.errorId)}`
    );

    const edit = report.fix(fixer);
    check(
      edit !== null && edit !== undefined,
      `${testCase.label} (fix produced edit)`
    );
    if (!edit) continue;

    const output = applyFixes(testCase.source, [edit]);
    check(
      output === testCase.expectedOutput,
      `${testCase.label} (auto-fix output)`,
      `expected ${JSON.stringify(testCase.expectedOutput)}, got ${JSON.stringify(output)}`
    );
  }

  // ---- multiple violations in one source: independent fixes compose ----
  {
    const source =
      "new RuntimeError('RILL-R001', 'RILL-R001: Error 1');\n" +
      "RuntimeError.fromNode('RILL-R002', 'RILL-R002: Error 2', node);";
    const expectedOutput =
      "new RuntimeError('RILL-R001', 'Error 1');\n" +
      "RuntimeError.fromNode('RILL-R002', 'Error 2', node);";
    const context = makeContext(source);
    const handlers = noDuplicateErrorId.create(context);

    const errId1 = literalNode(source, "'RILL-R001'");
    const msg1 = literalNode(source, "'RILL-R001: Error 1'", errId1.end);
    handlers.NewExpression({
      type: 'NewExpression',
      callee: identifierNode(source, 'RuntimeError').node,
      arguments: [errId1.node, msg1.node],
    });

    const obj2 = identifierNode(source, 'RuntimeError', msg1.end);
    const prop2 = identifierNode(source, 'fromNode', obj2.end);
    const errId2 = literalNode(source, "'RILL-R002'", prop2.end);
    const msg2 = literalNode(source, "'RILL-R002: Error 2'", errId2.end);
    const nodeArg2 = identifierNode(source, 'node', msg2.end);
    handlers.CallExpression({
      type: 'CallExpression',
      callee: memberExpressionNode(obj2.node, prop2.node),
      arguments: [errId2.node, msg2.node, nodeArg2.node],
    });

    check(
      context.reports.length === 2,
      'invalid: multiple violations in one source (report count)',
      `expected 2 reports, got ${context.reports.length}`
    );
    if (context.reports.length === 2) {
      const edits = context.reports.map((r) => r.fix(fixer));
      const output = applyFixes(source, edits);
      check(
        output === expectedOutput,
        'invalid: multiple violations in one source (composed auto-fix output)',
        `expected ${JSON.stringify(expectedOutput)}, got ${JSON.stringify(output)}`
      );
    }
  }
}

// ============================================================
// no-spec-id-reference
// ============================================================

// Comment fixture: `raw` is the full comment text including `//` or the block
// delimiters, matching the range oxlint hands the rule.
function commentNode(source, raw, from) {
  const range = findRange(source, raw, from);
  return { type: raw.startsWith('//') ? 'Line' : 'Block', range };
}

function runSpecIdReferenceTests() {
  // ---- comments ----

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
}

// ============================================================
// Run
// ============================================================

runDuplicateErrorIdTests();
runSpecIdReferenceTests();

if (stats.fail > 0) {
  console.error(
    `FAIL rule-unit-test: ${stats.fail} failed, ${stats.pass} passed.`
  );
  process.exit(1);
}

console.log(
  `PASS rule-unit-test: ${stats.pass} assertions passed (no-duplicate-error-id, no-spec-id-reference).`
);
