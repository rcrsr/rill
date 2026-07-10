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
 * Run standalone: `node lint-rules/rule-unit-test.cjs`
 * Wired into: packages/core `test:rules` script (see package.json).
 */

'use strict';

const path = require('path');

const noDuplicateErrorId = require(
  path.join(__dirname, 'no-duplicate-error-id.cjs')
);
const noCrossMixinAny = require(path.join(__dirname, 'no-cross-mixin-any.cjs'));

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

function makeContext(source) {
  const reports = [];
  return {
    reports,
    report(descriptor) {
      reports.push(descriptor);
    },
    sourceCode: {
      getText(node) {
        return source.slice(node.range[0], node.range[1]);
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
// no-cross-mixin-any
// ============================================================

function tsAsAnyNode(source, exprText, exprType) {
  const fullRange = findRange(source, `(${exprText} as any)`);
  const exprRange = findRange(source, exprText, fullRange[0]);
  return {
    type: 'TSAsExpression',
    range: fullRange,
    typeAnnotation: { type: 'TSAnyKeyword' },
    expression: {
      type: exprType,
      name: exprType === 'Identifier' ? exprText : undefined,
      range: exprRange,
    },
  };
}

function runCrossMixinAnyTests() {
  const validCases = [
    {
      label: 'valid: (value as any) — not this/evaluator',
      source: 'const x = (value as any)',
      exprText: 'value',
      exprType: 'Identifier',
    },
    {
      label: 'valid: (other as any) — not this/evaluator',
      source: 'const x = (other as any)',
      exprText: 'other',
      exprType: 'Identifier',
    },
  ];
  for (const testCase of validCases) {
    const context = makeContext(testCase.source);
    const handlers = noCrossMixinAny.create(context);
    handlers.TSAsExpression(
      tsAsAnyNode(testCase.source, testCase.exprText, testCase.exprType)
    );
    check(
      context.reports.length === 0,
      testCase.label,
      `expected 0 reports, got ${context.reports.length}`
    );
  }

  // Cast target is not `any` — TSAsExpression is never reached for TSAnyKeyword
  // check, so simulate a non-any type annotation directly.
  const nonAnyCases = [
    {
      label: 'valid: this as EvaluatorInterface — not any',
      exprType: 'ThisExpression',
    },
    {
      label: 'valid: evaluator as EvaluatorInterface — not any',
      exprType: 'Identifier',
    },
  ];
  for (const testCase of nonAnyCases) {
    const context = makeContext('');
    const handlers = noCrossMixinAny.create(context);
    handlers.TSAsExpression({
      type: 'TSAsExpression',
      typeAnnotation: { type: 'TSTypeReference' },
      expression: { type: testCase.exprType, name: 'evaluator' },
    });
    check(
      context.reports.length === 0,
      testCase.label,
      `expected 0 reports, got ${context.reports.length}`
    );
  }

  const invalidCases = [
    {
      label: 'invalid: (this as any) member call',
      source: 'const x = (this as any).foo()',
      exprText: 'this',
      exprType: 'ThisExpression',
    },
    {
      label: 'invalid: (this as any) property access (no call)',
      source: 'const x = (this as any).foo',
      exprText: 'this',
      exprType: 'ThisExpression',
    },
    {
      label: 'invalid: (evaluator as any) member call',
      source: 'const x = (evaluator as any).bar()',
      exprText: 'evaluator',
      exprType: 'Identifier',
    },
    {
      label: 'invalid: (this as any) inside nested await expression',
      source: 'async function f() { await (this as any).method(args) }',
      exprText: 'this',
      exprType: 'ThisExpression',
    },
  ];
  for (const testCase of invalidCases) {
    const context = makeContext(testCase.source);
    const handlers = noCrossMixinAny.create(context);
    handlers.TSAsExpression(
      tsAsAnyNode(testCase.source, testCase.exprText, testCase.exprType)
    );
    check(
      context.reports.length === 1,
      `${testCase.label} (report count)`,
      `expected 1 report, got ${context.reports.length}`
    );
    if (context.reports.length === 1) {
      check(
        context.reports[0].messageId === 'crossMixinAny',
        `${testCase.label} (messageId)`,
        `expected 'crossMixinAny', got ${JSON.stringify(context.reports[0].messageId)}`
      );
    }
  }
}

// ============================================================
// Run
// ============================================================

runDuplicateErrorIdTests();
runCrossMixinAnyTests();

if (stats.fail > 0) {
  console.error(
    `FAIL rule-unit-test: ${stats.fail} failed, ${stats.pass} passed.`
  );
  process.exit(1);
}

console.log(
  `PASS rule-unit-test: ${stats.pass} assertions passed (no-duplicate-error-id, no-cross-mixin-any).`
);
