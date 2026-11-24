/**
 * Shared fixtures and assertions for the lint-rule unit tests.
 *
 * Each `tests/<rule>.cjs` file requires what it needs from here, and
 * `../rule-unit-test.cjs` runs every case file and reports `stats`.
 */

'use strict';

/**
 * Fixtures are hand-built ESTree fragments, so they are typed loosely: a
 * `type` tag, an optional source range, and whatever else a rule reads.
 *
 * @typedef {[number, number]} Range
 * @typedef {{ line: number, column: number }} Position
 * @typedef {{ type?: string, range?: Range, [key: string]: unknown }} FixtureNode
 * @typedef {{ range: Range, text: string }} Edit
 * @typedef {{ node: FixtureNode, end: number }} Located
 * @typedef {{ label: string, source: string, visitorKey: 'NewExpression' | 'CallExpression', build: (source: string) => FixtureNode }} ValidCase
 * @typedef {ValidCase & { expectedOutput: string, errorId: string }} InvalidCase
 * @typedef {{ replaceText: (node: FixtureNode, text: string) => Edit }} Fixer
 * @typedef {{ node?: FixtureNode, messageId?: string, data?: Record<string, string>, loc?: { start: Position, end: Position }, fix?: (fixer: Fixer) => Edit | null }} Report
 * @typedef {{ reports: Report[], options: unknown[], filename?: string, report: (descriptor: Report) => void, sourceCode: object }} MockContext
 */

const stats = { pass: 0, fail: 0 };

/**
 * @param {string} label
 * @param {string} [detail]
 * @returns {void}
 */
function fail(label, detail) {
  stats.fail++;
  console.error(`FAIL: ${label}`);
  if (detail !== undefined) console.error(`  ${detail}`);
}

/**
 * @param {string} label
 * @returns {void}
 */
function pass(label) {
  stats.pass++;
  void label;
}

/**
 * @param {boolean} condition
 * @param {string} label
 * @param {string} [detail]
 * @returns {void}
 */
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

/**
 * @param {string} source
 * @param {string} text
 * @param {number} [from]
 * @returns {Range}
 */
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
/**
 * @param {string} source
 * @param {string} quoted
 * @param {number} [from]
 * @returns {Located}
 */
function literalNode(source, quoted, from) {
  const range = findRange(source, quoted, from);
  return {
    node: { type: 'Literal', value: quoted.slice(1, -1), range },
    end: range[1],
  };
}

/**
 * @param {string} source
 * @param {string} name
 * @param {number} [from]
 * @returns {Located}
 */
function identifierNode(source, name, from) {
  const range = findRange(source, name, from);
  return { node: { type: 'Identifier', name, range }, end: range[1] };
}

// Template literal fixture. `raw` is the full backtick-delimited text;
// `firstQuasiCooked` is the literal prefix before the first `${`.
/**
 * @param {string} source
 * @param {string} raw
 * @param {string} firstQuasiCooked
 * @param {number} [from]
 * @returns {Located}
 */
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

/**
 * @param {FixtureNode} objectNode
 * @param {FixtureNode} propertyNode
 * @returns {FixtureNode}
 */
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
// only walk the AST never call getAllComments and can omit it. `options` is
// the rule-options array (`context.options`), e.g. `[{ ignore: [...] }]`.
/**
 * @param {string} source
 * @param {FixtureNode[]} [comments]
 * @param {unknown[]} [options]
 * @returns {MockContext}
 */
function makeContext(source, comments, options) {
  /** @type {Report[]} */
  const reports = [];
  return {
    reports,
    options: options ?? [],
    /** @param {Report} descriptor */
    report(descriptor) {
      reports.push(descriptor);
    },
    sourceCode: {
      text: source,
      /** @param {FixtureNode} node */
      getText(node) {
        const range = node.range;
        if (range === undefined) throw new Error('fixture node has no range');
        return source.slice(range[0], range[1]);
      },
      getAllComments() {
        return comments ?? [];
      },
      // Real line/column arithmetic, so a rule reporting by `loc` is checked
      // against positions a reader can look up in the fixture source.
      /** @param {number} index */
      getLocFromIndex(index) {
        const before = source.slice(0, index);
        const line = before.split('\n').length;
        return { line, column: index - (before.lastIndexOf('\n') + 1) };
      },
    },
  };
}

/** @type {Fixer} */
const fixer = {
  replaceText(node, text) {
    return { range: node.range, text };
  },
};

/**
 * @param {string} source
 * @param {Edit[]} edits
 * @returns {string}
 */
function applyFixes(source, edits) {
  const sorted = [...edits].sort((a, b) => b.range[0] - a.range[0]);
  let out = source;
  for (const edit of sorted) {
    out = out.slice(0, edit.range[0]) + edit.text + out.slice(edit.range[1]);
  }
  return out;
}

module.exports = {
  stats,
  check,
  findRange,
  literalNode,
  identifierNode,
  templateLiteralNode,
  memberExpressionNode,
  makeContext,
  fixer,
  applyFixes,
};
