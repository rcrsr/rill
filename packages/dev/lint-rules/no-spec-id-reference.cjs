/**
 * ESLint Rule: no-spec-id-reference
 *
 * Rejects internal workflow-artifact identifiers in shipped source. The IDs
 * (`AC-*`, `EC-*`, `IR-*`, `IC-*`, `FR-*`, `NFR-*`, `DEC-*`, `BC-*`, and the
 * UX/debt prefixes) point at planning documents that are never published, so
 * they are unresolvable for anyone reading the code.
 *
 * Out of reach by design: `§` section anchors. The tree mixes internal ones
 * (`§NOD.10.4`) with legitimate external citations (`RFC 4648 §5`) and cites of
 * published rill doc sections (`see § Error Handling`), and no pattern
 * separates them. The internal ones were removed by hand.
 *
 * Scanned surfaces (comments and text, never executable syntax):
 * - line and block comments, including JSDoc
 * - string literals
 * - template-literal chunks
 * - JSX text
 *
 * Not auto-fixable. Most occurrences pair a real fact with an opaque reference,
 * so the fix is to keep the fact and drop the reference:
 *
 *   Before: // Negative n halts with #INVALID_INPUT (EC-1).
 *   After:  // Negative n halts with #INVALID_INPUT.
 *
 * A comment that is only a reference carries no independent information and
 * needs a rewrite that states what the grouping is, or deletion.
 *
 * rill's own error codes are out of scope by construction: `RILL-R010`,
 * `RILL-P007`, `#TYPE_MISMATCH`, and `#INVALID_INPUT` never match the pattern,
 * because every prefix below is anchored on a word boundary.
 *
 * Escape hatch: `// oxlint-disable-next-line rill/no-spec-id-reference`.
 */

'use strict';

// Prefix vocabulary, by family:
//   requirements   FR, NFR, IR, IC, EC, AC
//   decisions      DEC, DR, DD, BC
//   UX             UXC, UXI, UXS, UXT
//   work items     TC, TD, DEBT, RI, GF, LOG, OK
// Prefixes with zero current occurrences are listed deliberately: they cost
// nothing to match and close the door before the first one lands.
//
// Deliberately absent: ERR, TEST, and COMM. `errorId: 'ERR-001'` and
// `'TEST-001'` are fabricated error IDs that fiddle's tests feed in as fixture
// data, not references to anything, and matching them would be a false positive.
const PREFIX =
  '(?:FR|NFR|IR|IC|EC|AC|DEC|DR|DD|BC|UXC|UXI|UXS|UXT|TC|TD|DEBT|RI|GF|LOG|OK)';

// `\b` on both ends. The leading boundary is what keeps `SPEC-1` and `RILL-R010`
// out: the character before the prefix must be a non-word character.
const SPEC_ID = new RegExp(`\\b${PREFIX}-[A-Z0-9][A-Z0-9-]*\\b`, 'g');

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow internal workflow-artifact ID references in source comments and strings',
      recommended: true,
    },
    schema: [],
    messages: {
      specIdReference:
        "'{{specId}}' references an internal planning document that is not published. Keep the fact the comment states and drop the reference.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /**
     * Reports every spec-ID match inside the source range [start, end).
     *
     * Scans `sourceCode.text` directly instead of slicing: the shared regex
     * is seeded at `start` via `lastIndex` and walked forward, stopping once
     * a match starts at or past `end`. Delimiter characters bound every
     * scanned surface (comment markers, quotes, template `` ` ``/`${`/`}`,
     * JSX `<`/`>`) and are all non-word, so `\b` behaves the same at a range
     * edge whether or not the neighboring character is part of the range.
     *
     * @param {number} start - Absolute source index where the range begins
     * @param {number} end - Absolute source index where the range ends
     */
    function scanRange(start, end) {
      SPEC_ID.lastIndex = start;
      let match;
      while ((match = SPEC_ID.exec(sourceCode.text)) !== null) {
        if (match.index >= end) break;
        context.report({
          loc: {
            start: sourceCode.getLocFromIndex(match.index),
            end: sourceCode.getLocFromIndex(match.index + match[0].length),
          },
          messageId: 'specIdReference',
          data: { specId: match[0] },
        });
      }
    }

    return {
      // Comments are not AST nodes, so they are collected once per file rather
      // than visited. Program fires exactly once, which makes this the only
      // place the sweep can live without repeating itself.
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          scanRange(comment.range[0], comment.range[1]);
        }
      },

      Literal(node) {
        // Numbers, booleans, regexes, and `null` cannot carry an ID.
        if (typeof node.value !== 'string') return;
        scanRange(node.range[0], node.range[1]);
      },

      TemplateElement(node) {
        scanRange(node.range[0], node.range[1]);
      },

      JSXText(node) {
        scanRange(node.range[0], node.range[1]);
      },
    };
  },
};
