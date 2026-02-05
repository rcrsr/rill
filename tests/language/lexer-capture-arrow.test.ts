/**
 * Lexer Tests: Capture Arrow Token Emission
 * Tests for `=>` token emission and boundary conditions
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/index.js';
import { TOKEN_TYPES } from '../../src/types.js';

describe('Lexer: Capture Arrow Token Emission', () => {
  describe('Basic Token Emission', () => {
    it('emits CAPTURE_ARROW token for => (AC-1)', () => {
      const tokens = tokenize('=>');
      expect(tokens).toHaveLength(2); // CAPTURE_ARROW + EOF
      expect(tokens[0]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[0]!.value).toBe('=>');
      expect(tokens[1]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits STRING, CAPTURE_ARROW, DOLLAR, IDENTIFIER for "value" => $x (AC-2)', () => {
      const tokens = tokenize('"value" => $x');
      expect(tokens).toHaveLength(5); // STRING, CAPTURE_ARROW, DOLLAR, IDENTIFIER, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.STRING);
      expect(tokens[0]!.value).toBe('value');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[1]!.value).toBe('=>');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.DOLLAR);
      expect(tokens[2]!.value).toBe('$');

      expect(tokens[3]!.type).toBe(TOKEN_TYPES.IDENTIFIER);
      expect(tokens[3]!.value).toBe('x');

      expect(tokens[4]!.type).toBe(TOKEN_TYPES.EOF);
    });
  });

  describe('Boundary Conditions with Similar Operators', () => {
    it('emits ASSIGN, GT tokens for = > with space (AC-3)', () => {
      const tokens = tokenize('= >');
      expect(tokens).toHaveLength(3); // ASSIGN, GT, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.ASSIGN);
      expect(tokens[0]!.value).toBe('=');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.GT);
      expect(tokens[1]!.value).toBe('>');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits COLON, GT tokens for :> (AC-4)', () => {
      const tokens = tokenize(':>');
      expect(tokens).toHaveLength(3); // COLON, GT, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.COLON);
      expect(tokens[0]!.value).toBe(':');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.GT);
      expect(tokens[1]!.value).toBe('>');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits COLON, GE tokens for :>= (AC-5)', () => {
      const tokens = tokenize(':>=');
      expect(tokens).toHaveLength(3); // COLON, GE, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.COLON);
      expect(tokens[0]!.value).toBe(':');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.GE);
      expect(tokens[1]!.value).toBe('>=');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits valid slice tokens for /<2:> (AC-6)', () => {
      const tokens = tokenize('/<2:>');
      expect(tokens).toHaveLength(5); // SLASH_LT, NUMBER, COLON, GT, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.SLASH_LT);
      expect(tokens[0]!.value).toBe('/<');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.NUMBER);
      expect(tokens[1]!.value).toBe('2');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.COLON);
      expect(tokens[2]!.value).toBe(':');

      expect(tokens[3]!.type).toBe(TOKEN_TYPES.GT);
      expect(tokens[3]!.value).toBe('>');

      expect(tokens[4]!.type).toBe(TOKEN_TYPES.EOF);
    });
  });

  describe('Edge Cases', () => {
    it('emits only EOF for empty input (AC-10)', () => {
      const tokens = tokenize('');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits CAPTURE_ARROW for => at file start (AC-11)', () => {
      const tokens = tokenize('=> $x');
      expect(tokens).toHaveLength(4); // CAPTURE_ARROW, DOLLAR, IDENTIFIER, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[0]!.value).toBe('=>');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.DOLLAR);
      expect(tokens[2]!.type).toBe(TOKEN_TYPES.IDENTIFIER);
      expect(tokens[3]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits CAPTURE_ARROW, EOF for => at file end (AC-12)', () => {
      const tokens = tokenize('$x =>');
      expect(tokens).toHaveLength(4); // DOLLAR, IDENTIFIER, CAPTURE_ARROW, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.DOLLAR);
      expect(tokens[1]!.type).toBe(TOKEN_TYPES.IDENTIFIER);

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[2]!.value).toBe('=>');

      expect(tokens[3]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('emits CAPTURE_ARROW for each => in chain (AC-13)', () => {
      const tokens = tokenize('"a" => $x => $y');

      let captureArrowCount = 0;
      for (const token of tokens) {
        if (token.type === TOKEN_TYPES.CAPTURE_ARROW) {
          captureArrowCount++;
        }
      }

      expect(captureArrowCount).toBe(2);

      // Verify token sequence
      expect(tokens[0]!.type).toBe(TOKEN_TYPES.STRING);
      expect(tokens[1]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[2]!.type).toBe(TOKEN_TYPES.DOLLAR);
      expect(tokens[3]!.type).toBe(TOKEN_TYPES.IDENTIFIER);
      expect(tokens[4]!.type).toBe(TOKEN_TYPES.CAPTURE_ARROW);
      expect(tokens[5]!.type).toBe(TOKEN_TYPES.DOLLAR);
      expect(tokens[6]!.type).toBe(TOKEN_TYPES.IDENTIFIER);
      expect(tokens[7]!.type).toBe(TOKEN_TYPES.EOF);
    });
  });

  describe('String and Comment Context', () => {
    it('emits STRING token for => inside string (AC-14)', () => {
      const tokens = tokenize('"=>"');
      expect(tokens).toHaveLength(2); // STRING, EOF

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.STRING);
      expect(tokens[0]!.value).toBe('=>');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.EOF);
    });

    it('skips => in comment (AC-15)', () => {
      const tokens = tokenize('# => $x\n42');
      // Comment is skipped, NEWLINE, NUMBER and EOF remain
      expect(tokens).toHaveLength(3);

      expect(tokens[0]!.type).toBe(TOKEN_TYPES.NEWLINE);
      expect(tokens[0]!.value).toBe('\n');

      expect(tokens[1]!.type).toBe(TOKEN_TYPES.NUMBER);
      expect(tokens[1]!.value).toBe('42');

      expect(tokens[2]!.type).toBe(TOKEN_TYPES.EOF);
    });
  });
});
