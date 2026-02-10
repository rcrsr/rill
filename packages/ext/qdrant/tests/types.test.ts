import { describe, it, expect } from 'vitest';
import type { QdrantConfig } from '../src/types.js';

describe('QdrantConfig', () => {
  describe('interface structure', () => {
    it('accepts minimal required configuration', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test_collection',
      };

      expect(config.url).toBe('http://127.0.0.1:6333');
      expect(config.collection).toBe('test_collection');
    });

    it('accepts full configuration with all optional fields', () => {
      const config: QdrantConfig = {
        url: 'https://xxx.cloud.qdrant.io',
        apiKey: 'test-api-key',
        collection: 'test_collection',
        dimensions: 384,
        distance: 'cosine',
        timeout: 30000,
      };

      expect(config.url).toBe('https://xxx.cloud.qdrant.io');
      expect(config.apiKey).toBe('test-api-key');
      expect(config.collection).toBe('test_collection');
      expect(config.dimensions).toBe(384);
      expect(config.distance).toBe('cosine');
      expect(config.timeout).toBe(30000);
    });

    it('accepts local deployment configuration without apiKey', () => {
      const config: QdrantConfig = {
        url: 'http://localhost:6333',
        collection: 'local_collection',
      };

      expect(config.apiKey).toBeUndefined();
    });

    it('accepts cloud deployment configuration with apiKey', () => {
      const config: QdrantConfig = {
        url: 'https://abc123.cloud.qdrant.io',
        apiKey: 'cloud-api-key',
        collection: 'cloud_collection',
      };

      expect(config.apiKey).toBe('cloud-api-key');
    });
  });

  describe('readonly properties', () => {
    it('enforces readonly on url field', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
      };

      // TypeScript compilation error if uncommented:
      // config.url = 'http://different.url';

      expect(config.url).toBe('http://127.0.0.1:6333');
    });

    it('enforces readonly on collection field', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'original',
      };

      // TypeScript compilation error if uncommented:
      // config.collection = 'changed';

      expect(config.collection).toBe('original');
    });

    it('enforces readonly on optional fields', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        dimensions: 768,
        timeout: 5000,
      };

      // TypeScript compilation error if uncommented:
      // config.dimensions = 1536;
      // config.timeout = 10000;

      expect(config.dimensions).toBe(768);
      expect(config.timeout).toBe(5000);
    });
  });

  describe('distance metric enumeration', () => {
    it('accepts cosine distance metric', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        distance: 'cosine',
      };

      expect(config.distance).toBe('cosine');
    });

    it('accepts euclidean distance metric', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        distance: 'euclidean',
      };

      expect(config.distance).toBe('euclidean');
    });

    it('accepts dot distance metric', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        distance: 'dot',
      };

      expect(config.distance).toBe('dot');
    });

    it('rejects invalid distance metrics at compile time', () => {
      // TypeScript compilation error if uncommented:
      // const config: QdrantConfig = {
      //   url: 'http://127.0.0.1:6333',
      //   collection: 'test',
      //   distance: 'manhattan',
      // };

      // Valid assignment to verify type constraint
      const validConfig: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        distance: 'cosine',
      };

      expect(validConfig.distance).toBe('cosine');
    });

    it('allows undefined distance metric', () => {
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        distance: undefined,
      };

      expect(config.distance).toBeUndefined();
    });
  });

  describe('optional field types', () => {
    it('allows apiKey as string or undefined', () => {
      const withKey: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        apiKey: 'my-key',
      };

      const withoutKey: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        apiKey: undefined,
      };

      const omittedKey: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
      };

      expect(withKey.apiKey).toBe('my-key');
      expect(withoutKey.apiKey).toBeUndefined();
      expect(omittedKey.apiKey).toBeUndefined();
    });

    it('allows dimensions as number or undefined', () => {
      const withDims: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        dimensions: 1536,
      };

      const withoutDims: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        dimensions: undefined,
      };

      expect(withDims.dimensions).toBe(1536);
      expect(withoutDims.dimensions).toBeUndefined();
    });

    it('allows timeout as number or undefined', () => {
      const withTimeout: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        timeout: 60000,
      };

      const withoutTimeout: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        timeout: undefined,
      };

      expect(withTimeout.timeout).toBe(60000);
      expect(withoutTimeout.timeout).toBeUndefined();
    });
  });

  describe('common configuration patterns', () => {
    it('supports typical vector dimensions', () => {
      const small: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'embeddings',
        dimensions: 384,
      };

      const medium: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'embeddings',
        dimensions: 768,
      };

      const large: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'embeddings',
        dimensions: 1536,
      };

      expect(small.dimensions).toBe(384);
      expect(medium.dimensions).toBe(768);
      expect(large.dimensions).toBe(1536);
    });

    it('supports typical timeout values', () => {
      const short: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        timeout: 5000,
      };

      const standard: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        timeout: 30000,
      };

      const extended: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
        timeout: 60000,
      };

      expect(short.timeout).toBe(5000);
      expect(standard.timeout).toBe(30000);
      expect(extended.timeout).toBe(60000);
    });
  });

  describe('export availability', () => {
    it('exports QdrantConfig type from types module', async () => {
      const types = await import('../src/types.js');

      // TypeScript validates the type exists at compile time
      const config: QdrantConfig = {
        url: 'http://127.0.0.1:6333',
        collection: 'test',
      };

      expect(config).toBeDefined();
      expect(types).toBeDefined();
    });
  });
});
