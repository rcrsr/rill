/**
 * Rill Parser Recovery Tests
 * Tests for parseWithRecovery error handling
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '../../src/index.js';

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
      const source = `[x: 42] => $obj
"value: {$obj.x}"
"""multiline
with {$obj.x}
interpolation"""`;
      const result = parseWithRecovery(source);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});
