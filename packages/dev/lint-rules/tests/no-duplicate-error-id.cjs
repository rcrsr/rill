/**
 * Unit tests for the `no-duplicate-error-id` lint rule. Run by `../rule-unit-test.cjs`.
 */

'use strict';

const noDuplicateErrorId = require('../no-duplicate-error-id.cjs');
const {
  check,
  literalNode,
  identifierNode,
  templateLiteralNode,
  memberExpressionNode,
  makeContext,
  fixer,
  applyFixes,
} = require('./harness.cjs');

/**
 * @typedef {import('./harness.cjs').ValidCase} ValidCase
 * @typedef {import('./harness.cjs').InvalidCase} InvalidCase
 */

function runDuplicateErrorIdTests() {
  const visitors = noDuplicateErrorId.create(makeContext(''));
  void visitors; // built per-case below (context depends on source)

  // ---- valid cases (no report expected) ----

  /** @type {ValidCase[]} */
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

  /** @type {InvalidCase[]} */
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

module.exports = {
  name: 'no-duplicate-error-id',
  run: runDuplicateErrorIdTests,
};
