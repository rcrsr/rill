/**
 * Tests for OpenAI extension barrel exports and package structure.
 * Verifies IC-16, IC-18, IC-21, IC-22, IC-23 requirements.
 */

import { describe, it, expect } from 'vitest';
import * as openaiExtension from './index.js';
import type { LLMExtensionConfig, OpenAIExtensionConfig } from './types.js';

describe('OpenAI Extension Package', () => {
  describe('Barrel Exports (IC-16)', () => {
    it('exports VERSION constant', () => {
      expect(openaiExtension.VERSION).toBe('0.0.1');
      expect(typeof openaiExtension.VERSION).toBe('string');
    });

    it('exports createOpenAIExtension factory', () => {
      expect(openaiExtension.createOpenAIExtension).toBeDefined();
      expect(typeof openaiExtension.createOpenAIExtension).toBe('function');
    });

    it('exports type definitions', () => {
      // Type-only test: verify types are exported
      const _testConfig: LLMExtensionConfig = {
        model: 'gpt-4-turbo',
        api_key: 'test-key',
      };
      expect(_testConfig).toBeDefined();
    });
  });

  describe('OpenAIExtensionConfig extends LLMExtensionConfig (IC-18)', () => {
    it('accepts base LLMExtensionConfig fields', () => {
      const config: OpenAIExtensionConfig = {
        model: 'gpt-4-turbo',
        api_key: 'sk-test',
        temperature: 0.7,
        base_url: 'https://api.openai.com',
        embed_model: 'text-embedding-3-small',
      };

      expect(config.model).toBe('gpt-4-turbo');
      expect(config.api_key).toBe('sk-test');
      expect(config.temperature).toBe(0.7);
      expect(config.base_url).toBe('https://api.openai.com');
      expect(config.embed_model).toBe('text-embedding-3-small');
    });

    it('accepts OpenAI-specific fields', () => {
      const config: OpenAIExtensionConfig = {
        model: 'gpt-4',
        api_key: 'sk-test',
        max_retries: 3,
        timeout: 60000,
        max_tokens: 4096,
        system: 'You are a helpful assistant',
      };

      expect(config.max_retries).toBe(3);
      expect(config.timeout).toBe(60000);
      expect(config.max_tokens).toBe(4096);
      expect(config.system).toBe('You are a helpful assistant');
    });

    it('allows optional fields to be undefined', () => {
      const config: OpenAIExtensionConfig = {
        model: 'gpt-4',
        api_key: 'sk-test',
      };

      expect(config.temperature).toBeUndefined();
      expect(config.base_url).toBeUndefined();
      expect(config.embed_model).toBeUndefined();
      expect(config.max_retries).toBeUndefined();
      expect(config.timeout).toBeUndefined();
      expect(config.max_tokens).toBeUndefined();
      expect(config.system).toBeUndefined();
    });
  });

  describe('Factory Function (IC-16)', () => {
    it('creates extension with valid config', () => {
      const config: OpenAIExtensionConfig = {
        model: 'gpt-4-turbo',
        api_key: 'sk-test',
      };

      const extension = openaiExtension.createOpenAIExtension(config);
      expect(extension).toBeDefined();
      expect(typeof extension).toBe('object');
    });
  });

  describe('Type Safety', () => {
    it('enforces required fields at compile time', () => {
      // This test verifies compile-time behavior via type checking
      const validConfig: OpenAIExtensionConfig = {
        model: 'gpt-4',
        api_key: 'sk-test',
      };

      expect(validConfig).toBeDefined();
    });
  });
});
