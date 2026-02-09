/**
 * Tests for Google extension scaffolding (Task 4.1).
 * Validates package structure, types, and barrel exports.
 */

import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';
import type { LLMExtensionConfig, GeminiExtensionConfig } from './types.js';

describe('Google Extension Scaffolding (Task 4.1)', () => {
  describe('IC-24: Barrel exports VERSION, types, factory', () => {
    it('exports VERSION constant', () => {
      expect(VERSION).toBe('0.7.2');
    });

    it('exports type LLMExtensionConfig', () => {
      // Type-only test: validate that the type exists and compiles
      const _testConfig: LLMExtensionConfig = {
        model: 'gemini-2.0-flash',
        api_key: 'test-key',
      };
      expect(_testConfig.model).toBe('gemini-2.0-flash');
    });

    it('exports type GeminiExtensionConfig', () => {
      // Type-only test: validate that the type exists and compiles
      const _testConfig: GeminiExtensionConfig = {
        model: 'gemini-2.0-flash',
        api_key: 'test-key',
      };
      expect(_testConfig.model).toBe('gemini-2.0-flash');
    });
  });

  describe('IC-26: GeminiExtensionConfig extends LLMExtensionConfig', () => {
    it('accepts base LLMExtensionConfig fields', () => {
      const config: GeminiExtensionConfig = {
        model: 'gemini-2.0-flash',
        api_key: 'test-api-key',
        temperature: 0.7,
        base_url: 'https://custom.api.google.com',
        embed_model: 'text-embedding-004',
      };

      expect(config.model).toBe('gemini-2.0-flash');
      expect(config.api_key).toBe('test-api-key');
      expect(config.temperature).toBe(0.7);
      expect(config.base_url).toBe('https://custom.api.google.com');
      expect(config.embed_model).toBe('text-embedding-004');
    });

    it('accepts Google-specific fields', () => {
      const config: GeminiExtensionConfig = {
        model: 'gemini-2.0-flash',
        api_key: 'test-api-key',
        max_retries: 3,
        timeout: 60000,
        max_tokens: 8192,
        system: 'You are a helpful assistant.',
      };

      expect(config.max_retries).toBe(3);
      expect(config.timeout).toBe(60000);
      expect(config.max_tokens).toBe(8192);
      expect(config.system).toBe('You are a helpful assistant.');
    });

    it('requires only model and api_key fields', () => {
      const config: GeminiExtensionConfig = {
        model: 'gemini-2.0-flash',
        api_key: 'test-api-key',
      };

      expect(config.model).toBe('gemini-2.0-flash');
      expect(config.api_key).toBe('test-api-key');
      expect(config.temperature).toBeUndefined();
      expect(config.base_url).toBeUndefined();
      expect(config.max_retries).toBeUndefined();
    });
  });
});
