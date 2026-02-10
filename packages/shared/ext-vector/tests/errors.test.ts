/**
 * Test suite for error mapping utilities.
 * Validates all error contract cases (EC-1 through EC-8).
 */

import { describe, it, expect } from 'vitest';
import { mapVectorError } from '../src/errors.js';
import { RuntimeError } from '@rcrsr/rill';

describe('mapVectorError', () => {
  const provider = 'testdb';

  describe('EC-1: Authentication failures', () => {
    it('maps 401 status code in message', () => {
      const error = new Error('HTTP 401 unauthorized');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: authentication failed (401)`);
    });

    it('maps "unauthorized" keyword (case-insensitive)', () => {
      const error = new Error('Request UNAUTHORIZED by server');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: authentication failed (401)`);
    });

    it('maps lowercase "unauthorized"', () => {
      const error = new Error('unauthorized access');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: authentication failed (401)`);
    });
  });

  describe('EC-2: Collection not found', () => {
    it('maps "collection" + "not found" keywords', () => {
      const error = new Error('collection my-collection not found');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: collection not found`);
    });

    it('matches case-insensitively', () => {
      const error = new Error('Collection NOT FOUND in database');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: collection not found`);
    });

    it('requires both keywords', () => {
      const notFoundOnly = new Error('resource not found');
      const collectionOnly = new Error('collection exists');

      expect(mapVectorError(provider, notFoundOnly).message).not.toBe(
        `${provider}: collection not found`
      );
      expect(mapVectorError(provider, collectionOnly).message).not.toBe(
        `${provider}: collection not found`
      );
    });
  });

  describe('EC-3: Rate limit exceeded', () => {
    it('maps 429 status code in message', () => {
      const error = new Error('HTTP 429 too many requests');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: rate limit exceeded`);
    });

    it('maps "rate limit" keywords (case-insensitive)', () => {
      const error = new Error('RATE LIMIT exceeded for API key');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: rate limit exceeded`);
    });
  });

  describe('EC-4: Request timeout', () => {
    it('maps AbortError by name', () => {
      const error = new Error('Operation aborted');
      error.name = 'AbortError';
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: request timeout`);
    });

    it('maps "timeout" keyword in message', () => {
      const error = new Error('Request TIMEOUT after 30s');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: request timeout`);
    });

    it('matches timeout case-insensitively', () => {
      const error = new Error('connection timeout');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: request timeout`);
    });
  });

  describe('EC-5: Dimension mismatch', () => {
    it('extracts dimensions from "expected X got Y" format', () => {
      const error = new Error('dimension mismatch: expected 384 but got 512');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(
        `${provider}: dimension mismatch (expected 384, got 512)`
      );
    });

    it('extracts dimensions from "Y dimensions, expected X" format', () => {
      const error = new Error('received 512 dimensions, expected 384');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(
        `${provider}: dimension mismatch (expected 384, got 512)`
      );
    });

    it('handles dimension keyword without numbers', () => {
      const error = new Error('dimension error occurred');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: dimension mismatch`);
    });

    it('matches dimension case-insensitively', () => {
      const error = new Error('DIMENSION mismatch: expected 128 got 256');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(
        `${provider}: dimension mismatch (expected 128, got 256)`
      );
    });
  });

  describe('EC-6: Collection already exists', () => {
    it('maps "already exists" keywords', () => {
      const error = new Error('collection my-collection already exists');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: collection already exists`);
    });

    it('matches case-insensitively', () => {
      const error = new Error('Index ALREADY EXISTS in database');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: collection already exists`);
    });
  });

  describe('EC-7: Generic Error instance', () => {
    it('returns provider-prefixed error message', () => {
      const error = new Error('Custom SDK error message');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: Custom SDK error message`);
    });

    it('handles empty error message', () => {
      const error = new Error('');
      const result = mapVectorError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: `);
    });
  });

  describe('EC-8: Non-Error values', () => {
    it('maps string throws', () => {
      const result = mapVectorError(provider, 'string error');

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: unknown error`);
    });

    it('maps number throws', () => {
      const result = mapVectorError(provider, 42);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: unknown error`);
    });

    it('maps null throws', () => {
      const result = mapVectorError(provider, null);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: unknown error`);
    });

    it('maps undefined throws', () => {
      const result = mapVectorError(provider, undefined);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: unknown error`);
    });

    it('maps object throws', () => {
      const result = mapVectorError(provider, { code: 'CUSTOM_ERROR' });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: unknown error`);
    });
  });

  describe('Error precedence', () => {
    it('prioritizes authentication over generic message', () => {
      const error = new Error('401 unauthorized: custom details');
      const result = mapVectorError(provider, error);

      expect(result.message).toBe(`${provider}: authentication failed (401)`);
    });

    it('prioritizes collection not found over generic message', () => {
      const error = new Error('collection xyz not found in system');
      const result = mapVectorError(provider, error);

      expect(result.message).toBe(`${provider}: collection not found`);
    });

    it('prioritizes rate limit over generic message', () => {
      const error = new Error('429 rate limit exceeded for user');
      const result = mapVectorError(provider, error);

      expect(result.message).toBe(`${provider}: rate limit exceeded`);
    });
  });

  describe('Provider name handling', () => {
    it('uses provided provider name in all messages', () => {
      const customProvider = 'my-custom-db';
      const error = new Error('some error');
      const result = mapVectorError(customProvider, error);

      expect(result.message).toContain(customProvider);
    });

    it('handles empty provider name', () => {
      const error = new Error('test error');
      const result = mapVectorError('', error);

      expect(result.message).toBe(': test error');
    });
  });
});
