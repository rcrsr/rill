/**
 * Factory validation tests
 * Validates config validation and lifecycle management
 */

import { describe, it, expect } from 'vitest';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';

// ============================================================
// VALIDATION TESTS
// ============================================================

describe('createAnthropicExtension', () => {
  describe('configuration validation', () => {
    // EC-1: Missing api_key
    it('throws when api_key is missing', () => {
      const config = {
        model: 'claude-sonnet-4-5-20250929',
      } as AnthropicExtensionConfig;

      expect(() => createAnthropicExtension(config)).toThrow(
        'api_key is required'
      );
    });

    // EC-3: Empty api_key
    it('throws when api_key is empty', () => {
      const config: AnthropicExtensionConfig = {
        api_key: '',
        model: 'claude-sonnet-4-5-20250929',
      };

      expect(() => createAnthropicExtension(config)).toThrow(
        'api_key cannot be empty'
      );
    });

    // EC-2: Missing model
    it('throws when model is missing', () => {
      const config = {
        api_key: 'test-key',
      } as AnthropicExtensionConfig;

      expect(() => createAnthropicExtension(config)).toThrow(
        'model is required'
      );
    });

    // EC-2: Empty model
    it('throws when model is empty', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: '',
      };

      expect(() => createAnthropicExtension(config)).toThrow(
        'model is required'
      );
    });

    // EC-4: Invalid temperature (below range)
    it('throws when temperature is below 0', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: -0.1,
      };

      expect(() => createAnthropicExtension(config)).toThrow(
        'temperature must be between 0 and 2'
      );
    });

    // EC-4: Invalid temperature (above range)
    it('throws when temperature is above 2', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 2.1,
      };

      expect(() => createAnthropicExtension(config)).toThrow(
        'temperature must be between 0 and 2'
      );
    });

    // Valid temperature at lower bound
    it('accepts temperature of 0', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.0,
      };

      expect(() => createAnthropicExtension(config)).not.toThrow();
    });

    // Valid temperature at upper bound
    it('accepts temperature of 2', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 2.0,
      };

      expect(() => createAnthropicExtension(config)).not.toThrow();
    });

    // Valid temperature in middle of range
    it('accepts temperature of 0.7', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
      };

      expect(() => createAnthropicExtension(config)).not.toThrow();
    });

    // Omitted temperature (should be valid)
    it('accepts omitted temperature', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      expect(() => createAnthropicExtension(config)).not.toThrow();
    });
  });

  // AC-1: Factory returns ExtensionResult with 5 functions
  describe('extension result structure', () => {
    it('returns object with 5 function definitions', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      // Verify all 5 functions exist
      expect(result.message).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.embed).toBeDefined();
      expect(result.embed_batch).toBeDefined();
      expect(result.tool_loop).toBeDefined();

      // Verify dispose exists
      expect(result.dispose).toBeDefined();
    });

    it('message has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      expect(result.message).toMatchObject({
        params: [
          { name: 'text', type: 'string' },
          { name: 'options', type: 'dict', defaultValue: {} },
        ],
        fn: expect.any(Function),
        description: expect.any(String),
        returnType: 'dict',
      });
    });

    it('messages has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      expect(result.messages).toMatchObject({
        params: [
          { name: 'messages', type: 'list' },
          { name: 'options', type: 'dict', defaultValue: {} },
        ],
        fn: expect.any(Function),
        description: expect.any(String),
        returnType: 'dict',
      });
    });

    it('embed has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      expect(result.embed).toMatchObject({
        params: [{ name: 'text', type: 'string' }],
        fn: expect.any(Function),
        description: expect.any(String),
      });
    });

    it('embed_batch has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      expect(result.embed_batch).toMatchObject({
        params: [{ name: 'texts', type: 'list' }],
        fn: expect.any(Function),
        description: expect.any(String),
      });
    });

    it('tool_loop has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      expect(result.tool_loop).toMatchObject({
        params: [
          { name: 'prompt', type: 'string' },
          { name: 'options', type: 'dict' },
        ],
        fn: expect.any(Function),
        description: expect.any(String),
      });
    });
  });

  // AC-28: dispose() called twice does not throw
  describe('dispose lifecycle', () => {
    it('dispose can be called successfully', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      await expect(result.dispose?.()).resolves.not.toThrow();
    });

    it('dispose can be called multiple times (idempotent)', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);

      // Call dispose twice
      await expect(result.dispose?.()).resolves.not.toThrow();
      await expect(result.dispose?.()).resolves.not.toThrow();
    });
  });
});
