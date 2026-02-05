/**
 * Unit tests for parser helper functions
 * Tests internal parser predicates without full parsing
 */

import { describe, expect, it } from 'vitest';
import { TOKEN_TYPES } from '../../src/types.ts';
import { isIdentifierOrKeyword } from '../../src/parser/helpers.ts';

describe('isIdentifierOrKeyword', () => {
  describe('valid identifier tokens', () => {
    it('returns true for IDENTIFIER token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.IDENTIFIER };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });
  });

  describe('valid keyword tokens', () => {
    it('returns true for TRUE token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.TRUE };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for FALSE token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.FALSE };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for BREAK token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.BREAK };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for RETURN token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.RETURN };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for ASSERT token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.ASSERT };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for ERROR token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.ERROR };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for EACH token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.EACH };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for MAP token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.MAP };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for FOLD token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.FOLD };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for FILTER token (IR-1)', () => {
      const token = { type: TOKEN_TYPES.FILTER };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });

    it('returns true for PASS token (BC-1)', () => {
      const token = { type: TOKEN_TYPES.PASS };
      expect(isIdentifierOrKeyword(token)).toBe(true);
    });
  });

  describe('invalid non-keyword tokens', () => {
    it('returns false for NUMBER token (EC-1)', () => {
      const token = { type: TOKEN_TYPES.NUMBER };
      expect(isIdentifierOrKeyword(token)).toBe(false);
    });

    it('returns false for STRING token (EC-1)', () => {
      const token = { type: TOKEN_TYPES.STRING };
      expect(isIdentifierOrKeyword(token)).toBe(false);
    });

    it('returns false for LPAREN token (EC-1)', () => {
      const token = { type: TOKEN_TYPES.LPAREN };
      expect(isIdentifierOrKeyword(token)).toBe(false);
    });

    it('returns false for ARROW token (EC-1)', () => {
      const token = { type: TOKEN_TYPES.ARROW };
      expect(isIdentifierOrKeyword(token)).toBe(false);
    });

    it('returns false for EOF token (EC-1)', () => {
      const token = { type: TOKEN_TYPES.EOF };
      expect(isIdentifierOrKeyword(token)).toBe(false);
    });
  });

  describe('comprehensive coverage', () => {
    it('accepts all 12 valid token types (IR-1)', () => {
      const validTypes = [
        TOKEN_TYPES.IDENTIFIER,
        TOKEN_TYPES.TRUE,
        TOKEN_TYPES.FALSE,
        TOKEN_TYPES.BREAK,
        TOKEN_TYPES.RETURN,
        TOKEN_TYPES.ASSERT,
        TOKEN_TYPES.ERROR,
        TOKEN_TYPES.EACH,
        TOKEN_TYPES.MAP,
        TOKEN_TYPES.FOLD,
        TOKEN_TYPES.FILTER,
        TOKEN_TYPES.PASS,
      ];

      validTypes.forEach((type) => {
        expect(isIdentifierOrKeyword({ type })).toBe(true);
      });
    });
  });
});
