/**
 * CLI LSP Diagnostic Tests
 * Test LSP diagnostic conversion from RillError
 */

import { describe, it, expect } from 'vitest';
import { toLspDiagnostic } from '../src/cli-lsp-diagnostic.js';
import { RillError, RuntimeError } from '@rcrsr/rill';

describe('CLI LSP Diagnostic', () => {
  describe('toLspDiagnostic', () => {
    // IR-9: Convert RillError with span to LspDiagnostic with zero-based positions
    it('converts RillError with location to LspDiagnostic', () => {
      const error = new RuntimeError(
        'RILL-R005',
        'Variable foo is not defined',
        { line: 5, column: 10, offset: 42 },
        { name: 'foo' }
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic).toEqual({
        range: {
          start: { line: 4, character: 9 }, // 1-based line 5, column 10 -> 0-based line 4, character 9
          end: { line: 4, character: 9 },
        },
        severity: 1, // Error
        code: 'RILL-R005',
        source: 'rill',
        message: 'Variable foo is not defined',
      });
    });

    // EC-11: Missing span returns diagnostic with null range
    it('converts RillError without location to diagnostic with null range', () => {
      const error = new RuntimeError(
        'RILL-R010',
        'Iteration limit of 1000 exceeded',
        undefined,
        { limit: 1000 }
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic).toEqual({
        range: null,
        severity: 1, // Error
        code: 'RILL-R010',
        source: 'rill',
        message: 'Iteration limit of 1000 exceeded',
      });
    });

    it('converts zero-based positions correctly', () => {
      const error = new RuntimeError(
        'RILL-R005',
        'Variable x is not defined',
        { line: 1, column: 1, offset: 0 }, // First line, first column
        { name: 'x' }
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.range).toEqual({
        start: { line: 0, character: 0 }, // 1-based line 1, column 1 -> 0-based line 0, character 0
        end: { line: 0, character: 0 },
      });
    });

    it('strips location suffix from message', () => {
      const error = new RuntimeError(
        'RILL-R005',
        'Variable foo is not defined',
        { line: 10, column: 5, offset: 100 }
      );

      const diagnostic = toLspDiagnostic(error);

      // Message should not include " at 10:5" suffix
      expect(diagnostic.message).toBe('Variable foo is not defined');
      expect(diagnostic.message).not.toContain(' at 10:5');
    });

    it('always sets source to rill', () => {
      const error = new RuntimeError('RILL-R001', 'Type error', {
        line: 1,
        column: 1,
        offset: 0,
      });

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.source).toBe('rill');
    });

    it('maps error severity to LSP severity 1', () => {
      const error = new RuntimeError(
        'RILL-R005',
        'Variable foo is not defined',
        { line: 1, column: 1, offset: 0 }
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.severity).toBe(1); // Error
    });

    it('includes suggestions when present in context', () => {
      const error = new RillError({
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location: { line: 1, column: 1, offset: 0 },
        context: {
          name: 'foo',
          suggestions: ['foobar', 'food', 'foot'],
        },
      });

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.suggestions).toEqual(['foobar', 'food', 'foot']);
    });

    it('limits suggestions to max 3 entries', () => {
      const error = new RillError({
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location: { line: 1, column: 1, offset: 0 },
        context: {
          name: 'foo',
          suggestions: ['a', 'b', 'c', 'd', 'e'],
        },
      });

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.suggestions).toEqual(['a', 'b', 'c']);
      expect(diagnostic.suggestions?.length).toBe(3);
    });

    it('omits suggestions field when not present', () => {
      const error = new RuntimeError(
        'RILL-R005',
        'Variable foo is not defined',
        { line: 1, column: 1, offset: 0 },
        { name: 'foo' } // No suggestions in context
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic).not.toHaveProperty('suggestions');
    });

    it('omits suggestions field when empty array', () => {
      const error = new RillError({
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location: { line: 1, column: 1, offset: 0 },
        context: {
          name: 'foo',
          suggestions: [],
        },
      });

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic).not.toHaveProperty('suggestions');
    });

    it('filters out empty suggestion strings', () => {
      const error = new RillError({
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location: { line: 1, column: 1, offset: 0 },
        context: {
          name: 'foo',
          suggestions: ['valid', '', 'also-valid'],
        },
      });

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.suggestions).toEqual(['valid', 'also-valid']);
    });

    it('handles multi-line spans by using start location', () => {
      const error = new RuntimeError(
        'RILL-R002',
        'Operator type mismatch',
        { line: 5, column: 10, offset: 42 } // Only start location available
      );

      const diagnostic = toLspDiagnostic(error);

      expect(diagnostic.range).toEqual({
        start: { line: 4, character: 9 },
        end: { line: 4, character: 9 },
      });
    });
  });
});
