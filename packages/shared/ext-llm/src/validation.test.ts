/**
 * Unit tests for validation functions
 *
 * Tests all validation functions with success, error, and boundary cases.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import {
  validateApiKey,
  validateModel,
  validateTemperature,
  validateMessages,
  validateEmbedText,
  validateEmbedBatch,
  validateEmbedModel,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
} from './validation.js';

// ============================================================
// API KEY VALIDATION
// ============================================================

describe('validateApiKey', () => {
  it('passes with valid key', () => {
    expect(() => validateApiKey('valid-key')).not.toThrow();
  });

  it('throws for undefined key', () => {
    // EC-1, AC-7: key is undefined → Error: "api_key is required"
    expect(() => validateApiKey(undefined)).toThrow('api_key is required');
  });

  it('throws for empty string key', () => {
    // EC-2, AC-15: key is empty string → Error: "api_key cannot be empty"
    expect(() => validateApiKey('')).toThrow('api_key cannot be empty');
  });
});

// ============================================================
// MODEL VALIDATION
// ============================================================

describe('validateModel', () => {
  it('passes with valid model', () => {
    expect(() => validateModel('gpt-4')).not.toThrow();
  });

  it('throws for undefined model', () => {
    // EC-3: model is undefined → Error: "model is required"
    expect(() => validateModel(undefined)).toThrow('model is required');
  });

  it('throws for empty string model', () => {
    // EC-3: model is empty string → Error: "model is required"
    expect(() => validateModel('')).toThrow('model is required');
  });
});

// ============================================================
// TEMPERATURE VALIDATION
// ============================================================

describe('validateTemperature', () => {
  it('passes for minimum boundary 0.0', () => {
    // AC-13: Temperature exactly 0.0 - boundary case
    expect(() => validateTemperature(MIN_TEMPERATURE)).not.toThrow();
    expect(() => validateTemperature(0.0)).not.toThrow();
  });

  it('passes for maximum boundary 2.0', () => {
    // AC-14: Temperature exactly 2.0 - boundary case
    expect(() => validateTemperature(MAX_TEMPERATURE)).not.toThrow();
    expect(() => validateTemperature(2.0)).not.toThrow();
  });

  it('passes for values in valid range', () => {
    expect(() => validateTemperature(0.5)).not.toThrow();
    expect(() => validateTemperature(1.0)).not.toThrow();
    expect(() => validateTemperature(1.5)).not.toThrow();
  });

  it('skips validation for undefined', () => {
    expect(() => validateTemperature(undefined)).not.toThrow();
  });

  it('throws for value above maximum', () => {
    // EC-4, AC-8: temperature > 2.0 → Error
    expect(() => validateTemperature(3.0)).toThrow(
      'temperature must be between 0 and 2'
    );
    expect(() => validateTemperature(2.1)).toThrow(
      'temperature must be between 0 and 2'
    );
  });

  it('throws for value below minimum', () => {
    // EC-4: temperature < 0.0 → Error
    expect(() => validateTemperature(-0.1)).toThrow(
      'temperature must be between 0 and 2'
    );
    expect(() => validateTemperature(-1.0)).toThrow(
      'temperature must be between 0 and 2'
    );
  });
});

// ============================================================
// MESSAGES VALIDATION
// ============================================================

describe('validateMessages', () => {
  it('passes for single-element array', () => {
    // AC-16: Boundary case - single-element message array
    const messages = [{ role: 'user', content: 'Hello' }];
    expect(() => validateMessages(messages)).not.toThrow();
  });

  it('passes for multiple valid messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    expect(() => validateMessages(messages)).not.toThrow();
  });

  it('throws for empty array', () => {
    // EC-5, AC-9: Messages array empty → RuntimeError
    expect(() => validateMessages([])).toThrow(RuntimeError);
    expect(() => validateMessages([])).toThrow('messages list cannot be empty');
  });

  it('throws for message missing role', () => {
    // EC-6: Message lacks `role` → RuntimeError
    const messages = [{ content: 'Hello' }];
    expect(() => validateMessages(messages)).toThrow(RuntimeError);
    expect(() => validateMessages(messages)).toThrow(
      "message missing required 'role' field"
    );
  });

  it('throws for message with empty role', () => {
    // EC-6: Message has empty role → RuntimeError
    const messages = [{ role: '', content: 'Hello' }];
    expect(() => validateMessages(messages)).toThrow(RuntimeError);
    expect(() => validateMessages(messages)).toThrow(
      "message missing required 'role' field"
    );
  });

  it('throws for message missing content', () => {
    // EC-7: Message lacks `content` → RuntimeError
    const messages = [{ role: 'user' }];
    expect(() => validateMessages(messages)).toThrow(RuntimeError);
    expect(() => validateMessages(messages)).toThrow(
      "user message requires 'content'"
    );
  });

  it('throws for message with undefined content', () => {
    // EC-7: Message has undefined content → RuntimeError
    const messages = [{ role: 'assistant', content: undefined }];
    expect(() => validateMessages(messages)).toThrow(RuntimeError);
    expect(() => validateMessages(messages)).toThrow(
      "assistant message requires 'content'"
    );
  });

  it('throws for message with null content', () => {
    // EC-7: Message has null content → RuntimeError
    const messages = [{ role: 'system', content: null }];
    expect(() => validateMessages(messages)).toThrow(RuntimeError);
    expect(() => validateMessages(messages)).toThrow(
      "system message requires 'content'"
    );
  });

  it('includes role name in error message', () => {
    // EC-7: Error message includes role name
    const messages = [{ role: 'custom-role', content: undefined }];
    expect(() => validateMessages(messages)).toThrow(
      "custom-role message requires 'content'"
    );
  });
});

// ============================================================
// EMBED TEXT VALIDATION
// ============================================================

describe('validateEmbedText', () => {
  it('passes for non-empty text', () => {
    expect(() => validateEmbedText('valid text')).not.toThrow();
    expect(() => validateEmbedText(' ')).not.toThrow();
  });

  it('throws for empty string', () => {
    // EC-8: Embed text empty → RuntimeError
    expect(() => validateEmbedText('')).toThrow(RuntimeError);
    expect(() => validateEmbedText('')).toThrow('embed text cannot be empty');
  });
});

// ============================================================
// EMBED BATCH VALIDATION
// ============================================================

describe('validateEmbedBatch', () => {
  it('passes for single-string array', () => {
    // AC-17: Boundary case - single-string array
    const result = validateEmbedBatch(['text']);
    expect(result).toEqual(['text']);
  });

  it('returns string array for valid input', () => {
    const result = validateEmbedBatch(['text1', 'text2', 'text3']);
    expect(result).toEqual(['text1', 'text2', 'text3']);
  });

  it('throws for non-string element', () => {
    // EC-9, AC-10: Batch contains non-string → RuntimeError
    expect(() => validateEmbedBatch([123 as any])).toThrow(RuntimeError);
    expect(() => validateEmbedBatch([123 as any])).toThrow(
      'embed_batch requires list of strings'
    );
  });

  it('throws for mixed types array', () => {
    // AC-10: Batch with mixed types → RuntimeError
    expect(() => validateEmbedBatch(['valid', 42 as any, 'text'])).toThrow(
      RuntimeError
    );
    expect(() => validateEmbedBatch(['valid', 42 as any, 'text'])).toThrow(
      'embed_batch requires list of strings'
    );
  });

  it('throws for array with object', () => {
    // EC-9: Non-string element (object) → RuntimeError
    expect(() => validateEmbedBatch([{} as any])).toThrow(RuntimeError);
    expect(() => validateEmbedBatch([{} as any])).toThrow(
      'embed_batch requires list of strings'
    );
  });

  it('throws for empty string in array', () => {
    // EC-10: Batch contains empty string → RuntimeError
    expect(() => validateEmbedBatch(['valid', '', 'text'])).toThrow(
      RuntimeError
    );
    expect(() => validateEmbedBatch(['valid', '', 'text'])).toThrow(
      'embed text cannot be empty at index 1'
    );
  });

  it('includes correct index in error message', () => {
    // EC-10: Error message includes index
    expect(() => validateEmbedBatch(['a', 'b', ''])).toThrow(
      'embed text cannot be empty at index 2'
    );
  });

  it('throws on first empty string encountered', () => {
    // EC-10: First empty string triggers error
    expect(() => validateEmbedBatch(['', 'valid'])).toThrow(
      'embed text cannot be empty at index 0'
    );
  });
});

// ============================================================
// EMBED MODEL VALIDATION
// ============================================================

describe('validateEmbedModel', () => {
  it('passes for valid model', () => {
    expect(() => validateEmbedModel('text-embedding-3-small')).not.toThrow();
  });

  it('throws for undefined model', () => {
    // EC-11: Embed model falsy → RuntimeError
    expect(() => validateEmbedModel(undefined)).toThrow(RuntimeError);
    expect(() => validateEmbedModel(undefined)).toThrow(
      'embed_model not configured'
    );
  });

  it('throws for empty string model', () => {
    // EC-11: Embed model empty string (falsy) → RuntimeError
    expect(() => validateEmbedModel('')).toThrow(RuntimeError);
    expect(() => validateEmbedModel('')).toThrow('embed_model not configured');
  });
});
