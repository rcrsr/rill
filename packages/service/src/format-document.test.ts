import { describe, expect, it } from 'vitest';
import { parse, parseWithRecovery } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { formatDocument } from './format-document.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

describe('formatDocument', () => {
  describe('well-formed input', () => {
    it('returns exactly one TextEdit covering the whole document', () => {
      const source = '1 => $a\n2 => $b\n';
      const parsed = toParseResult(source);

      const edits = formatDocument(parsed, source);

      expect(edits).toHaveLength(1);
      const [edit] = edits;
      expect(edit?.range.start).toEqual({ line: 0, character: 0 });
      expect(edit?.range.end).toEqual({ line: 2, character: 0 });
    });

    it('trims trailing per-line whitespace and normalizes CRLF to LF', () => {
      const source = '1 => $a  \r\n2 => $b\t\r\n';
      const parsed = toParseResult(source);

      const [edit] = formatDocument(parsed, source);

      expect(edit?.newText).toBe('1 => $a\n2 => $b\n');
    });

    it('is idempotent: formatting the output of formatDocument is byte-identical', () => {
      const source = '1 => $a  \n|x| ($x * 2) => $double  \n5 -> $double\n';
      const parsed = toParseResult(source);

      const [firstEdit] = formatDocument(parsed, source);
      const firstText = firstEdit?.newText ?? '';

      const reparsed = toParseResult(firstText);
      const [secondEdit] = formatDocument(reparsed, firstText);
      const secondText = secondEdit?.newText ?? '';

      expect(secondText).toBe(firstText);
    });
  });

  describe('malformed input passthrough', () => {
    it('preserves a whole-document RecoveryErrorNode verbatim', () => {
      const source = 'foo(1\nbar(2\n\n"after"\n';
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      expect(parsed.ast.statements[0]?.type).toBe('RecoveryError');

      const [edit] = formatDocument(parsed, source);

      expect(edit?.newText).toBe(source);
    });

    it('preserves a PartialExpressionNode region verbatim in a bare error() call', () => {
      const source = 'error()';
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      expect(parsed.ast.statements[0]?.type).toBe('PartialExpression');

      const [edit] = formatDocument(parsed, source);

      expect(edit?.newText).toBe(source);
    });

    it('preserves malformed regions while reformatting the well-formed statement around them', () => {
      const source = 'error(1 + 2))  \n"after"  \n';
      const parsed = parseWithRecovery(source);
      expect(parsed.success).toBe(false);
      const types = parsed.ast.statements.map((statement) => statement.type);
      expect(types).toContain('PartialExpression');
      expect(types).toContain('Statement');

      const [edit] = formatDocument(parsed, source);
      const newText = edit?.newText ?? '';

      // The malformed prefix is untouched, including its trailing spaces.
      expect(newText.startsWith('error(1 + 2))  \n')).toBe(true);
      // The well-formed statement that follows has its trailing spaces trimmed.
      expect(newText).toContain('"after"\n');
      expect(newText).not.toContain('"after"  \n');
    });

    it('is idempotent over malformed input: format(format(x)) equals format(x)', () => {
      const source = 'error(1 + 2))  \n"after"  \n';
      const parsed = parseWithRecovery(source);

      const [firstEdit] = formatDocument(parsed, source);
      const firstText = firstEdit?.newText ?? '';

      const reparsed = parseWithRecovery(firstText);
      const [secondEdit] = formatDocument(reparsed, firstText);
      const secondText = secondEdit?.newText ?? '';

      expect(secondText).toBe(firstText);
    });

    it('never drops content across a corpus of malformed samples', () => {
      const corpus = [
        'foo(1\nbar(2\n\n"after"\n',
        'error()',
        'error(1 + 2))\n"after"',
        'guard<on: list[#X_bad]> { "ok" }',
      ];

      for (const source of corpus) {
        const parsed = parseWithRecovery(source);
        const [edit] = formatDocument(parsed, source);
        const newText = edit?.newText ?? '';

        // Every non-whitespace character of the original survives formatting.
        const stripWhitespace = (text: string): string =>
          text.replace(/\s+/g, '');
        expect(stripWhitespace(newText)).toBe(stripWhitespace(source));
      }
    });
  });

  describe('boundary cases', () => {
    it('formats an empty document to a single empty-range edit', () => {
      const source = '';
      const parsed = toParseResult(source);

      const edits = formatDocument(parsed, source);

      expect(edits).toHaveLength(1);
      expect(edits[0]?.range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      });
      expect(edits[0]?.newText).toBe('');
    });
  });
});
