import { describe, it, expectTypeOf } from 'vitest';
import type { ChromaConfig } from '../src/index.js';

describe('ChromaConfig Interface', () => {
  describe('type exports', () => {
    it('exports ChromaConfig interface from barrel', () => {
      expectTypeOf<ChromaConfig>().toBeObject();
    });
  });

  describe('field types', () => {
    it('defines url as optional string', () => {
      expectTypeOf<ChromaConfig>().toHaveProperty('url');
      expectTypeOf<ChromaConfig['url']>().toEqualTypeOf<string | undefined>();
    });

    it('defines collection as required string', () => {
      expectTypeOf<ChromaConfig>().toHaveProperty('collection');
      expectTypeOf<ChromaConfig['collection']>().toBeString();
    });

    it('defines embeddingFunction as optional string', () => {
      expectTypeOf<ChromaConfig>().toHaveProperty('embeddingFunction');
      expectTypeOf<ChromaConfig['embeddingFunction']>().toEqualTypeOf<
        string | undefined
      >();
    });

    it('defines timeout as optional number', () => {
      expectTypeOf<ChromaConfig>().toHaveProperty('timeout');
      expectTypeOf<ChromaConfig['timeout']>().toEqualTypeOf<
        number | undefined
      >();
    });
  });

  describe('readonly modifiers', () => {
    it('enforces readonly on url field', () => {
      const config: ChromaConfig = {
        collection: 'test',
        url: 'http://localhost:8000',
      };

      // @ts-expect-error - url is readonly
      config.url = 'http://other:8000';
    });

    it('enforces readonly on collection field', () => {
      const config: ChromaConfig = {
        collection: 'test',
      };

      // @ts-expect-error - collection is readonly
      config.collection = 'other';
    });

    it('enforces readonly on embeddingFunction field', () => {
      const config: ChromaConfig = {
        collection: 'test',
        embeddingFunction: 'openai',
      };

      // @ts-expect-error - embeddingFunction is readonly
      config.embeddingFunction = 'cohere';
    });

    it('enforces readonly on timeout field', () => {
      const config: ChromaConfig = {
        collection: 'test',
        timeout: 30000,
      };

      // @ts-expect-error - timeout is readonly
      config.timeout = 60000;
    });
  });

  describe('configuration scenarios', () => {
    it('accepts minimal config with only collection', () => {
      const config: ChromaConfig = {
        collection: 'my_collection',
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('accepts embedded mode config (url undefined)', () => {
      const config: ChromaConfig = {
        collection: 'my_collection',
        url: undefined,
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('accepts HTTP client mode config', () => {
      const config: ChromaConfig = {
        url: 'http://localhost:8000',
        collection: 'my_collection',
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('accepts full config with all optional fields', () => {
      const config: ChromaConfig = {
        url: 'http://localhost:8000',
        collection: 'my_collection',
        embeddingFunction: 'openai',
        timeout: 30000,
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('rejects config missing required collection field', () => {
      // @ts-expect-error - collection is required
      const config: ChromaConfig = {
        url: 'http://localhost:8000',
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('rejects config with wrong type for url', () => {
      const config: ChromaConfig = {
        collection: 'test',
        // @ts-expect-error - url must be string or undefined
        url: 12345,
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('rejects config with wrong type for collection', () => {
      const config: ChromaConfig = {
        // @ts-expect-error - collection must be string
        collection: 12345,
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('rejects config with wrong type for embeddingFunction', () => {
      const config: ChromaConfig = {
        collection: 'test',
        // @ts-expect-error - embeddingFunction must be string or undefined
        embeddingFunction: 12345,
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });

    it('rejects config with wrong type for timeout', () => {
      const config: ChromaConfig = {
        collection: 'test',
        // @ts-expect-error - timeout must be number or undefined
        timeout: 'not a number',
      };

      expectTypeOf(config).toMatchTypeOf<ChromaConfig>();
    });
  });
});
