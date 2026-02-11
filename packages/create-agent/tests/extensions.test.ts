import { describe, it, expect } from 'vitest';
import { getExtensionConfig, resolvePreset } from '../src/extensions.js';

describe('Extension Configuration', () => {
  describe('getExtensionConfig', () => {
    describe('LLM extensions', () => {
      it('returns valid config for anthropic', () => {
        const config = getExtensionConfig('anthropic');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('anthropic');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-anthropic');
        expect(config?.factoryName).toBe('createAnthropicExtension');
        expect(config?.namespace).toBe('anthropic');
        expect(config?.envVars).toContain('ANTHROPIC_API_KEY');
        expect(config?.configShape).toHaveProperty('api_key', 'string');
        expect(config?.configShape).toHaveProperty('model', 'string');
      });

      it('returns valid config for openai', () => {
        const config = getExtensionConfig('openai');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('openai');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-openai');
        expect(config?.factoryName).toBe('createOpenAIExtension');
        expect(config?.namespace).toBe('openai');
        expect(config?.envVars).toContain('OPENAI_API_KEY');
      });

      it('returns valid config for gemini', () => {
        const config = getExtensionConfig('gemini');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('gemini');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-gemini');
        expect(config?.factoryName).toBe('createGeminiExtension');
        expect(config?.namespace).toBe('gemini');
        expect(config?.envVars).toContain('GEMINI_API_KEY');
      });

      it('returns valid config for claude-code', () => {
        const config = getExtensionConfig('claude-code');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('claude-code');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-claude-code');
        expect(config?.factoryName).toBe('createClaudeCodeExtension');
        expect(config?.namespace).toBe('claude-code');
        expect(config?.envVars).toEqual([]);
        expect(config?.configShape).toHaveProperty('binaryPath', 'string');
        expect(config?.configShape).toHaveProperty('defaultTimeout', 'number');
      });
    });

    describe('Vector database extensions', () => {
      it('returns valid config for qdrant', () => {
        const config = getExtensionConfig('qdrant');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('qdrant');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-qdrant');
        expect(config?.factoryName).toBe('createQdrantExtension');
        expect(config?.namespace).toBe('qdrant');
        expect(config?.envVars).toEqual([]);
        expect(config?.configShape).toHaveProperty('url', 'string');
        expect(config?.configShape).toHaveProperty('collection', 'string');
      });

      it('returns valid config for pinecone', () => {
        const config = getExtensionConfig('pinecone');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('pinecone');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-pinecone');
        expect(config?.factoryName).toBe('createPineconeExtension');
        expect(config?.namespace).toBe('pinecone');
        expect(config?.envVars).toContain('PINECONE_API_KEY');
        expect(config?.configShape).toHaveProperty('apiKey', 'string');
        expect(config?.configShape).toHaveProperty('index', 'string');
      });

      it('returns valid config for chroma', () => {
        const config = getExtensionConfig('chroma');

        expect(config).not.toBeNull();
        expect(config?.name).toBe('chroma');
        expect(config?.npmPackage).toBe('@rcrsr/rill-ext-chroma');
        expect(config?.factoryName).toBe('createChromaExtension');
        expect(config?.namespace).toBe('chroma');
        expect(config?.envVars).toEqual([]);
        expect(config?.configShape).toHaveProperty('collection', 'string');
      });
    });

    describe('case-insensitive lookup', () => {
      it('returns same config for uppercase name', () => {
        const lowercase = getExtensionConfig('anthropic');
        const uppercase = getExtensionConfig('ANTHROPIC');

        expect(uppercase).toEqual(lowercase);
      });

      it('returns same config for mixed case name', () => {
        const lowercase = getExtensionConfig('qdrant');
        const mixedCase = getExtensionConfig('QdRaNt');

        expect(mixedCase).toEqual(lowercase);
      });
    });

    describe('unknown extensions', () => {
      it('returns null for unknown extension', () => {
        const config = getExtensionConfig('unknown');

        expect(config).toBeNull();
      });

      it('returns null for empty string', () => {
        const config = getExtensionConfig('');

        expect(config).toBeNull();
      });
    });

    describe('all extensions have required fields', () => {
      const extensionNames = [
        'anthropic',
        'openai',
        'gemini',
        'claude-code',
        'qdrant',
        'pinecone',
        'chroma',
      ];

      extensionNames.forEach((name) => {
        it(`${name} has all required fields`, () => {
          const config = getExtensionConfig(name);

          expect(config).not.toBeNull();
          expect(config?.name).toBe(name);
          expect(config?.npmPackage).toMatch(/^@rcrsr\/rill-ext-/);
          expect(config?.factoryName).toMatch(/^create.*Extension$/);
          expect(config?.namespace).toBeTruthy();
          expect(Array.isArray(config?.envVars)).toBe(true);
          expect(typeof config?.configShape).toBe('object');
          expect(config?.configShape).not.toBeNull();
        });
      });
    });
  });

  describe('resolvePreset', () => {
    describe('valid presets', () => {
      it('returns anthropic + qdrant with search-focused pattern for rag preset', () => {
        const result = resolvePreset('rag');

        expect(result.extensions).toEqual(['anthropic', 'qdrant']);
        expect(result.starterPattern).toBe('search-focused');
      });

      it('returns anthropic with conversation-loop pattern for chatbot preset', () => {
        const result = resolvePreset('chatbot');

        expect(result.extensions).toEqual(['anthropic']);
        expect(result.starterPattern).toBe('conversation-loop');
      });
    });

    describe('case-insensitive lookup', () => {
      it('resolves uppercase preset name', () => {
        const result = resolvePreset('RAG');

        expect(result.extensions).toEqual(['anthropic', 'qdrant']);
        expect(result.starterPattern).toBe('search-focused');
      });

      it('resolves mixed case preset name', () => {
        const result = resolvePreset('ChAtBoT');

        expect(result.extensions).toEqual(['anthropic']);
        expect(result.starterPattern).toBe('conversation-loop');
      });
    });

    describe('error handling', () => {
      it('throws ValidationError for unknown preset', () => {
        expect(() => resolvePreset('unknown')).toThrow(
          'Unknown preset: unknown. Valid: rag, chatbot'
        );
      });

      it('throws ValidationError with correct message for empty string', () => {
        expect(() => resolvePreset('')).toThrow(
          'Unknown preset: . Valid: rag, chatbot'
        );
      });

      it('thrown error is instance of ValidationError', () => {
        let error: unknown;
        try {
          resolvePreset('invalid');
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe('ValidationError');
      });
    });
  });
});
