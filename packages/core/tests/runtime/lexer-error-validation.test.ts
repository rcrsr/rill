/**
 * Rill Runtime Tests: LexerError Constructor Validation
 * Tests for IR-7, EC-5, EC-6 (Task 1.5)
 */

import { describe, expect, it } from 'vitest';

import {
  ERROR_REGISTRY,
  LexerError,
  type SourceLocation,
} from '@rcrsr/rill';

describe('LexerError Constructor Validation (Task 1.5)', () => {
  describe('IR-7: LexerError constructor signature', () => {
    it('accepts errorId as first parameter', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const error = new LexerError('RILL-L001', 'Test lexer error', location);

      expect(error).toBeInstanceOf(LexerError);
      expect(error.errorId).toBe('RILL-L001');
      expect(error.message).toBe('Test lexer error at 1:5');
      expect(error.location).toEqual(location);
    });

    it('accepts optional context parameter', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const context = { char: '\\', sequence: '\\x' };
      const error = new LexerError(
        'RILL-L005',
        'Invalid escape sequence',
        location,
        context
      );

      expect(error.context).toEqual(context);
    });

    it('requires location parameter', () => {
      const location: SourceLocation = { line: 2, column: 10, offset: 25 };
      const error = new LexerError('RILL-L001', 'Test error', location);

      expect(error.location).toEqual(location);
    });
  });

  describe('EC-5: Unknown errorId throws TypeError', () => {
    it('throws TypeError for unknown errorId', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('RILL-X999', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('RILL-X999', 'Test error', location);
      }).toThrow('Unknown error ID: RILL-X999');
    });

    it('throws TypeError for invalid errorId format', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('INVALID', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('INVALID', 'Test error', location);
      }).toThrow('Unknown error ID: INVALID');
    });
  });

  describe('EC-6: Wrong category throws TypeError', () => {
    it('throws TypeError for runtime error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('RILL-R001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('RILL-R001', 'Test error', location);
      }).toThrow('Expected lexer error ID, got: RILL-R001');
    });

    it('throws TypeError for parse error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('RILL-P001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('RILL-P001', 'Test error', location);
      }).toThrow('Expected lexer error ID, got: RILL-P001');
    });

    it('throws TypeError for check error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('RILL-C001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('RILL-C001', 'Test error', location);
      }).toThrow('Expected lexer error ID, got: RILL-C001');
    });

    it('accepts valid lexer error IDs', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      // Get all lexer error IDs from registry
      const lexerErrorIds = Array.from(ERROR_REGISTRY.entries())
        .filter(([, def]) => def.category === 'lexer')
        .map(([id]) => id);

      // Test each valid lexer error ID
      for (const errorId of lexerErrorIds) {
        expect(() => {
          new LexerError(errorId, 'Test error', location);
        }).not.toThrow();
      }
    });
  });
});
