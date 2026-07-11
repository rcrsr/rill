/**
 * Rill Parser Recovery Tests
 * Tests for parseWithRecovery error handling
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, ParseError, parseWithRecovery } from '@rcrsr/rill';
import { ERROR_IDS } from '../../src/error-registry.js';

/**
 * Hoisted mutable slot backing the mocked lexer `tokenize` export below.
 * Tests that need `tokenize()` to throw a specific (possibly synthetic)
 * error set `tokenizeOverride.impl`; all other tests leave it `null`, in
 * which case the mock delegates to the real tokenizer.
 */
const tokenizeOverride = vi.hoisted(() => ({
  impl: null as ((...args: unknown[]) => unknown) | null,
}));

vi.mock('../../src/lexer/index.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/lexer/index.js')>();
  return {
    ...actual,
    tokenize: (...args: unknown[]) =>
      tokenizeOverride.impl
        ? tokenizeOverride.impl(...args)
        : actual.tokenize(...(args as Parameters<typeof actual.tokenize>)),
  };
});

/**
 * Recursively walks an AST (or any parse-result value) collecting every
 * node whose `.type` matches `nodeType`. Used to locate recovery nodes
 * regardless of where they surface (top-level statement vs. nested).
 */
function findNodesByType(
  root: unknown,
  nodeType: string,
  seen: Set<unknown> = new Set()
): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (record['type'] === nodeType) found.push(record);
    for (const propertyValue of Object.values(record)) visit(propertyValue);
  };
  visit(root);
  return found;
}

describe('Parser Recovery', () => {
  describe('LexerError recovery', () => {
    it('recovers from LexerError in string interpolation', () => {
      // Single quotes are invalid in rill strings, triggers LexerError
      const source = `"hello {'world'}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/Unexpected character|'/);
      expect(result.ast.statements.length).toBeGreaterThan(0);
      expect(result.ast.statements[0]?.type).toBe('RecoveryError');
    });

    it('recovers from multiple LexerErrors in interpolations', () => {
      const source = `"first {'bad'}"
"second {'also bad'}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(2);
      expect(result.ast.statements.length).toBe(2);
      expect(result.ast.statements[0]?.type).toBe('RecoveryError');
      expect(result.ast.statements[1]?.type).toBe('RecoveryError');
    });

    it('recovers from LexerError in triple-quote interpolation', () => {
      const source = `"""hello {'world'}"""`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.ast.statements.length).toBeGreaterThan(0);
      expect(result.ast.statements[0]?.type).toBe('RecoveryError');
    });

    it('recovers from nested triple-quotes in interpolation', () => {
      // Triple-quotes not allowed in interpolation
      const source = `"""{"""nested"""}"""`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(
        /Triple-quotes not allowed in interpolation/
      );
    });
  });

  describe('ParseError recovery', () => {
    it('recovers from ParseError (empty interpolation)', () => {
      const source = `"{   }"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/Empty string interpolation/);
    });

    it('recovers from unterminated interpolation', () => {
      const source = `"x" => $x
"{$x"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(
        /Unterminated string interpolation/
      );
    });
  });

  describe('Mixed error recovery', () => {
    it('recovers from both LexerError and ParseError in same source', () => {
      const source = `"first {'bad'}"
"{   }"
"valid"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(2);
      expect(result.ast.statements.length).toBe(3);
      // First two are errors, third is valid
      expect(result.ast.statements[0]?.type).toBe('RecoveryError');
      expect(result.ast.statements[1]?.type).toBe('RecoveryError');
      expect(result.ast.statements[2]?.type).toBe('Statement');
    });

    it('returns partial AST with ErrorNode entries', () => {
      const source = `1 + 2
"bad {'quote'}"
3 + 4`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(3);
      expect(result.ast.statements[0]?.type).toBe('Statement');
      expect(result.ast.statements[1]?.type).toBe('RecoveryError');
      expect(result.ast.statements[2]?.type).toBe('Statement');
    });
  });

  describe('Edge cases', () => {
    it('handles LexerError at start of file', () => {
      const source = `"{'immediate error'}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.ast.statements.length).toBeGreaterThan(0);
    });

    it('handles LexerError at end of file', () => {
      const source = `"valid"
"{'error at end'}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.ast.statements.length).toBe(2);
      expect(result.ast.statements[0]?.type).toBe('Statement');
      expect(result.ast.statements[1]?.type).toBe('RecoveryError');
    });

    it('handles multiple errors on same line', () => {
      const source = `"{'first'}" + "{'second'}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Success cases', () => {
    it('returns success for valid source', () => {
      const source = `"hello world"
1 + 2
"interpolation {1 + 1}"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.ast.statements.length).toBe(3);
      expect(result.ast.statements[0]?.type).toBe('Statement');
      expect(result.ast.statements[1]?.type).toBe('Statement');
      expect(result.ast.statements[2]?.type).toBe('Statement');
    });

    it('handles complex valid interpolations', () => {
      const source = `dict[x: 42] => $obj
"value: {$obj.x}"
"""multiline
with {$obj.x}
interpolation"""`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Depth-aware boundary recovery', () => {
    // `error` dispatches to the statement-form message parser as soon as
    // the leading token is ERROR, so `error(...)` used as a bare statement
    // fails before the opening bracket is consumed (it expects a string
    // message or a statement boundary, not `(`). That failure point is
    // exactly what exercises the depth-aware scan: the bracket is still
    // unconsumed when recovery begins, so the scan must track it through
    // interior newlines to find the real closing boundary.
    it('resyncs an unclosed multi-line paren at the matching closing paren, not the first interior newline', () => {
      const source = `error(
1 +
)
"after"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(2);
      const [first, second] = result.ast.statements;
      expect(first?.type).toBe('RecoveryError');
      expect(second?.type).toBe('Statement');
      // The recovered text spans past the interior newlines through the
      // closing paren, not stopping at the first interior NEWLINE.
      const recoveryText = (first as { text: string }).text;
      expect(recoveryText).toBe('error(\n1 +\n)');
    });

    it('resyncs an unclosed multi-line list bracket at the matching closing bracket, not the first interior newline', () => {
      const source = `error(list[
1,
2 +
])
"after"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(2);
      const [first, second] = result.ast.statements;
      expect(first?.type).toBe('RecoveryError');
      expect(second?.type).toBe('Statement');
      const recoveryText = (first as { text: string }).text;
      expect(recoveryText).toBe('error(list[\n1,\n2 +\n])');
    });

    it('resyncs an unclosed multi-line block brace at the matching closing brace, not the first interior newline', () => {
      const source = `error({
1 +
})
"after"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(2);
      const [first, second] = result.ast.statements;
      expect(first?.type).toBe('RecoveryError');
      expect(second?.type).toBe('Statement');
      const recoveryText = (first as { text: string }).text;
      expect(recoveryText).toBe('error({\n1 +\n})');
    });

    it('skips a mismatched closing bracket instead of prematurely closing the enclosing paren', () => {
      // The interior `]` does not match the open `(`, so a type-matched
      // stack must skip over it without popping and continue scanning for
      // the real matching `)`. A blind depth counter would treat any
      // closing token as decrementing depth and would wrongly stop at the
      // interior `]`, truncating the recovered span before the real
      // boundary and leaving the following `)` to be parsed as its own
      // (invalid) statement.
      const source = `error(1, 2]
)
"after"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(2);
      const [first, second] = result.ast.statements;
      expect(first?.type).toBe('RecoveryError');
      expect(second?.type).toBe('Statement');
      const recoveryText = (first as { text: string }).text;
      expect(recoveryText).toBe('error(1, 2]\n)');
      const span = (
        first as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      expect(source.slice(span.start.offset, span.end.offset)).toBe(
        recoveryText
      );
    });

    it('resyncs deeply nested unclosed brackets once at the outermost boundary, without a cascade of spurious diagnostics', () => {
      const source = `error(list[list[list[
"unterminated`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      // A single failed statement should produce a single bounded diagnostic,
      // not one error per unmatched opening bracket.
      expect(result.errors.length).toBe(1);
      expect(result.ast.statements.length).toBe(1);
      expect(result.ast.statements[0]?.type).toBe('RecoveryError');
    });
  });

  describe('RecoveryError text/span fidelity', () => {
    it('agrees on source.slice(span) === text for every RecoveryErrorNode produced', () => {
      const sources = [
        `"first {'bad'}"
"{   }"
"valid"`,
        `error(
1 +
)
"after"`,
        `error(list[list[list[
"unterminated`,
        `"{'first'}" + "{'second'}"`,
      ];

      for (const source of sources) {
        const result = parseWithRecovery(source);
        const recoveryNodes = findNodesByType(result.ast, 'RecoveryError');
        expect(recoveryNodes.length).toBeGreaterThan(0);
        for (const node of recoveryNodes) {
          const span = node['span'] as {
            start: { offset: number };
            end: { offset: number };
          };
          const text = node['text'] as string;
          expect(source.slice(span.start.offset, span.end.offset)).toBe(text);
        }
      }
    });
  });

  describe('PartialExpressionNode salvage', () => {
    // `error()` used as a bare statement fails the same way (the
    // statement-form message parser rejects `(` as neither a string nor a
    // statement boundary) but the skipped span re-parses cleanly as an
    // ordinary host call, so recovery salvages a typed HostCall child
    // instead of falling back to an opaque RecoveryErrorNode.
    it('salvages a single typed child from a bare zero-argument error() call', () => {
      const source = `error()`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.ast.statements.length).toBe(1);
      expect(result.ast.statements[0]?.type).toBe('PartialExpression');
      const partials = findNodesByType(result.ast, 'PartialExpression');
      expect(partials.length).toBe(1);
      const partial = partials[0] as {
        children: {
          span: { start: { offset: number }; end: { offset: number } };
        }[];
        span: { start: { offset: number }; end: { offset: number } };
      };
      expect(partial.children.length).toBe(1);
      expect(partial.span.start.offset).toBeLessThan(partial.span.end.offset);
      for (const child of partial.children) {
        expect(child.span.start.offset).toBeLessThan(child.span.end.offset);
      }
    });

    it('salvages a typed child and reports leftover unparseable text separately', () => {
      const source = `error(1 + 2))
"after"`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      const types = result.ast.statements.map((s) => s.type);
      expect(types).toContain('PartialExpression');
      expect(types).toContain('RecoveryError');
      expect(types).toContain('Statement');

      const partials = findNodesByType(result.ast, 'PartialExpression');
      expect(partials.length).toBeGreaterThanOrEqual(1);
      for (const partial of partials as {
        children: {
          span: { start: { offset: number }; end: { offset: number } };
        }[];
      }[]) {
        expect(partial.children.length).toBeGreaterThanOrEqual(1);
        for (const child of partial.children) {
          expect(child.span.start.offset).toBeLessThan(child.span.end.offset);
        }
      }
    });
  });

  describe('Boundary cases', () => {
    it('returns an empty valid script for empty source, with no recovery nodes', () => {
      const result = parseWithRecovery('');

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.ast.statements.length).toBe(0);
      expect(findNodesByType(result.ast, 'RecoveryError').length).toBe(0);
      expect(findNodesByType(result.ast, 'PartialExpression').length).toBe(0);
    });
  });

  describe('Tokenize failure outside a string', () => {
    it('preserves the clean-prefix partial ast, reports success:false, and does not throw', () => {
      // The backtick is not a valid start-of-token anywhere in the grammar,
      // so tokenize() fails outside any string/interpolation context, after
      // a fully valid leading statement has already been recognized.
      const source = `"valid" -> $y\n\``;

      let result: ReturnType<typeof parseWithRecovery>;
      expect(() => {
        result = parseWithRecovery(source);
      }).not.toThrow();

      expect(result!.success).toBe(false);
      expect(result!.errors.length).toBeGreaterThanOrEqual(1);
      // The partial ast keeps the clean prefix; it is not empty.
      expect(result!.ast.statements.length).toBeGreaterThan(0);
      expect(result!.ast.statements[0]?.type).toBe('Statement');
    });

    it('suppresses cascading diagnostics so a single root cause emits exactly one error', () => {
      // The unclosed `error(...)` call would independently produce its own
      // recovery diagnostic if the prefix were parsed in isolation; the
      // trailing backtick tokenize failure must still surface as the sole
      // diagnostic for the whole parse.
      const source = `"first"\nerror(\n1 +\n)\n\``;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.ast.statements.map((s) => s.type)).toEqual([
        'Statement',
        'RecoveryError',
      ]);
    });

    it('assigns RILL_P001 to the tokenize-failure diagnostic and strips the suffix to a single clean location', () => {
      const source = `"valid" -> $y\n\``;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(false);
      expect(result.errors[0]?.errorId).toBe(ERROR_IDS.RILL_P001);
      expect(result.errors[0]?.message).toBe('Unexpected character: ` at 2:1');
      // Exactly one location suffix; never a doubled one.
      expect(result.errors[0]?.message).not.toMatch(/ at \d+:\d+ at \d+:\d+$/);
      expect(result.errors[0]?.message.match(/ at \d+:\d+/g)?.length).toBe(1);
    });
  });

  describe('Tokenize failure conversion (mocked lexer)', () => {
    afterEach(() => {
      tokenizeOverride.impl = null;
      vi.restoreAllMocks();
    });

    it('defaults the diagnostic location to line 1, column 1, offset 0 when the LexerError carries no location', () => {
      tokenizeOverride.impl = () => {
        const err = new Error('synthetic lexer failure without a location');
        err.name = 'LexerError';
        throw err;
      };

      const result = parseWithRecovery('anything');

      expect(result.success).toBe(false);
      expect(result.errors[0]?.location).toEqual({
        line: 1,
        column: 1,
        offset: 0,
      });
    });

    it('re-throws a non-LexerError raised during tokenize unchanged, without converting it to a ParseError', () => {
      const original = new Error('unexpected host failure');
      tokenizeOverride.impl = () => {
        throw original;
      };

      expect.assertions(2);
      try {
        parseWithRecovery('anything');
      } catch (e) {
        expect(e).toBe(original);
        expect(e).not.toBeInstanceOf(ParseError);
      }
    });
  });

  describe('Unclosed frontmatter', () => {
    it('recovers from an unclosed frontmatter delimiter, without throwing', () => {
      const source = `---\ntitle: test\n`;

      let result: ReturnType<typeof parseWithRecovery>;
      expect(() => {
        result = parseWithRecovery(source);
      }).not.toThrow();

      expect(result!.success).toBe(false);
      expect(result!.errors[0]?.errorId).toBe(ERROR_IDS.RILL_P005);
      expect(result!.ast.frontmatter).toBe(null);
    });

    it('still throws for unclosed frontmatter in normal (non-recovery) parse mode', () => {
      const source = `---\ntitle: test\n`;

      expect(() => parse(source)).toThrow(ParseError);
    });
  });

  describe('Unclosed construct at EOF', () => {
    it('returns success:false with a RecoveryErrorNode spanning to EOF, and does not throw', () => {
      const source = `error(\n1 +`;

      let result: ReturnType<typeof parseWithRecovery>;
      expect(() => {
        result = parseWithRecovery(source);
      }).not.toThrow();

      expect(result!.success).toBe(false);
      expect(result!.errors.length).toBeGreaterThanOrEqual(1);
      expect(result!.ast.statements.length).toBe(1);
      expect(result!.ast.statements[0]?.type).toBe('RecoveryError');
      const recoveryNode = result!.ast.statements[0] as unknown as {
        span: { end: { offset: number } };
      };
      expect(recoveryNode.span.end.offset).toBe(source.length);
    });
  });
});
