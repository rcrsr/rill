/**
 * Unit tests for error mapping functions
 *
 * Tests mapProviderError with detector returning status+message, null, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { mapProviderError } from './errors.js';
import type { ProviderErrorDetector } from './types.js';

// ============================================================
// MAP PROVIDER ERROR
// ============================================================

describe('mapProviderError', () => {
  describe('detector returns non-null', () => {
    it('formats with HTTP status code and message', () => {
      // EC-12: Detector returns non-null → RuntimeError with HTTP format
      const detector: ProviderErrorDetector = () => ({
        status: 401,
        message: 'Invalid API key',
      });

      const originalError = new Error('API Error');
      const result = mapProviderError('Anthropic', originalError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(
        'Anthropic API error (HTTP 401): Invalid API key'
      );
    });

    it('formats with message only when status is undefined', () => {
      // EC-12 edge case: Detector returns message without status
      const detector: ProviderErrorDetector = () => ({
        message: 'Rate limit exceeded',
      });

      const originalError = new Error('Rate Limit');
      const result = mapProviderError('OpenAI', originalError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('OpenAI API error: Rate limit exceeded');
    });

    it('handles different provider names', () => {
      // EC-12: Provider name appears in formatted message
      const detector: ProviderErrorDetector = () => ({
        status: 500,
        message: 'Internal server error',
      });

      const error = new Error('Server Error');
      const result = mapProviderError('CustomProvider', error, detector);

      expect(result.message).toContain('CustomProvider API error');
      expect(result.message).toContain('HTTP 500');
    });

    it('handles different HTTP status codes', () => {
      // EC-12: Different status codes format correctly
      const detector: ProviderErrorDetector = () => ({
        status: 403,
        message: 'Forbidden',
      });

      const originalError = new Error('Original');
      const result = mapProviderError('Provider', originalError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toContain('HTTP 403');
      expect(result.message).toContain('Forbidden');
    });
  });

  describe('detector returns null', () => {
    it('formats with generic error message for Error instance', () => {
      // EC-13: Detector returns null → RuntimeError with generic format
      const detector: ProviderErrorDetector = () => null;

      const originalError = new Error('Network timeout');
      const result = mapProviderError('OpenAI', originalError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('OpenAI error: Network timeout');
    });

    it('uses "Unknown error" for non-Error objects', () => {
      // EC-13 edge case: Unknown error type
      const detector: ProviderErrorDetector = () => null;

      const unknownError = { code: 'UNKNOWN' };
      const result = mapProviderError('Provider', unknownError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('Provider error: Unknown error');
    });

    it('handles string error values', () => {
      // EC-13 edge case: Error is a string
      const detector: ProviderErrorDetector = () => null;

      const stringError = 'Connection failed';
      const result = mapProviderError('Provider', stringError, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe('Provider error: Unknown error');
    });

    it('handles null error values', () => {
      // EC-13 edge case: Error is null
      const detector: ProviderErrorDetector = () => null;

      const result = mapProviderError('Provider', null, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe('Provider error: Unknown error');
    });

    it('handles undefined error values', () => {
      // EC-13 edge case: Error is undefined
      const detector: ProviderErrorDetector = () => null;

      const result = mapProviderError('Provider', undefined, detector);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe('Provider error: Unknown error');
    });
  });

  describe('edge cases', () => {
    it('handles detector returning empty message', () => {
      const detector: ProviderErrorDetector = () => ({
        status: 404,
        message: '',
      });

      const result = mapProviderError('Provider', new Error(), detector);

      expect(result.message).toBe('Provider API error (HTTP 404): ');
    });

    it('handles detector returning status 0', () => {
      const detector: ProviderErrorDetector = () => ({
        status: 0,
        message: 'Connection error',
      });

      const result = mapProviderError('Provider', new Error(), detector);

      // Status 0 is still a defined number, so it formats with HTTP prefix
      expect(result.message).toBe(
        'Provider API error (HTTP 0): Connection error'
      );
    });

    it('handles Error with empty message', () => {
      const detector: ProviderErrorDetector = () => null;

      const emptyError = new Error('');
      const result = mapProviderError('Provider', emptyError, detector);

      expect(result.message).toBe('Provider error: ');
    });
  });
});
