/**
 * ESLint Rule: rethrow-control-signal
 *
 * A `try` that runs rill code can raise `BreakSignal`, `ReturnSignal`, or
 * `YieldSignal`. Its `catch` must let them through, or `break` and `return`
 * are silently swallowed or turned into halts.
 *
 * A `try` block runs rill code when it calls `evaluate*(`, `invoke*(`, or
 * `.fn(`. Its `catch` passes when any of these hold:
 * - it names `ControlSignal`, a signal subclass, or `rejectBreakAsHalt`;
 * - its last statement rethrows the caught binding, directly or as the
 *   `else` branch of a trailing `if`;
 * - it calls a function listed in the `delegates` option, which handles
 *   control signals itself.
 *
 * Options: `[{ delegates: ['reshapeHostThrow'] }]`.
 *
 * Not auto-fixable: the right handling depends on what the catch does.
 */

const RUNS_RILL = /\b(?:evaluate|invoke)\w*\s*\(|\.fn\s*\(/;
const HANDLES_SIGNAL =
  /\b(?:ControlSignal|BreakSignal|ReturnSignal|YieldSignal|rejectBreakAsHalt)\b/;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endsInRethrow(statement, param) {
  if (!statement || param === null) return false;
  if (statement.type === 'ThrowStatement') {
    return (
      statement.argument?.type === 'Identifier' &&
      statement.argument.name === param
    );
  }
  if (statement.type === 'BlockStatement') {
    return endsInRethrow(statement.body[statement.body.length - 1], param);
  }
  if (statement.type === 'IfStatement') {
    return endsInRethrow(statement.alternate, param);
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require catch clauses around rill evaluation to rethrow control signals',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          delegates: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      swallowsSignal:
        'This catch can swallow BreakSignal/ReturnSignal. Rethrow ControlSignal unchanged, or call rejectBreakAsHalt.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const delegates = options.delegates ?? [];
    const delegateCall =
      delegates.length > 0
        ? new RegExp(`\\b(?:${delegates.map(escapeRegExp).join('|')})\\s*\\(`)
        : null;
    const sourceCode = context.sourceCode;

    return {
      TryStatement(node) {
        const handler = node.handler;
        if (!handler) return;
        if (!RUNS_RILL.test(sourceCode.getText(node.block))) return;

        const body = stripComments(sourceCode.getText(handler.body));
        if (HANDLES_SIGNAL.test(body)) return;
        if (delegateCall?.test(body)) return;

        const param =
          handler.param?.type === 'Identifier' ? handler.param.name : null;
        if (endsInRethrow(handler.body, param)) return;

        context.report({ node: handler, messageId: 'swallowsSignal' });
      },
    };
  },
};
