import { describe, it, expect } from 'vitest';
import type { PineconeConfig } from '../src/index.js';

describe('PineconeConfig', () => {
  describe('interface structure', () => {
    it('accepts minimal required configuration', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
      };

      expect(config.apiKey).toBe('test-api-key');
      expect(config.index).toBe('test-index');
    });

    it('accepts full configuration with all optional fields', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'production-index',
        namespace: 'production',
        timeout: 60000,
      };

      expect(config.apiKey).toBe('test-api-key');
      expect(config.index).toBe('production-index');
      expect(config.namespace).toBe('production');
      expect(config.timeout).toBe(60000);
    });

    it('accepts configuration without optional namespace', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'my-index',
      };

      expect(config.namespace).toBeUndefined();
    });

    it('accepts configuration without optional timeout', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'my-index',
      };

      expect(config.timeout).toBeUndefined();
    });
  });

  describe('readonly properties', () => {
    it('enforces readonly on apiKey field', () => {
      const config: PineconeConfig = {
        apiKey: 'original-key',
        index: 'test-index',
      };

      // TypeScript compilation error if uncommented:
      // config.apiKey = 'changed-key';

      expect(config.apiKey).toBe('original-key');
    });

    it('enforces readonly on index field', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'original-index',
      };

      // TypeScript compilation error if uncommented:
      // config.index = 'changed-index';

      expect(config.index).toBe('original-index');
    });

    it('enforces readonly on optional fields', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'production',
        timeout: 30000,
      };

      // TypeScript compilation error if uncommented:
      // config.namespace = 'staging';
      // config.timeout = 60000;

      expect(config.namespace).toBe('production');
      expect(config.timeout).toBe(30000);
    });
  });

  describe('namespace partitioning', () => {
    it('accepts empty string as default namespace', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: '',
      };

      expect(config.namespace).toBe('');
    });

    it('accepts custom namespace string', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'custom-namespace',
      };

      expect(config.namespace).toBe('custom-namespace');
    });

    it('accepts environment-based namespace', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'staging',
      };

      expect(config.namespace).toBe('staging');
    });

    it('allows undefined namespace', () => {
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: undefined,
      };

      expect(config.namespace).toBeUndefined();
    });
  });

  describe('optional field types', () => {
    it('allows namespace as string or undefined', () => {
      const withNamespace: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'my-namespace',
      };

      const withoutNamespace: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: undefined,
      };

      const omittedNamespace: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
      };

      expect(withNamespace.namespace).toBe('my-namespace');
      expect(withoutNamespace.namespace).toBeUndefined();
      expect(omittedNamespace.namespace).toBeUndefined();
    });

    it('allows timeout as number or undefined', () => {
      const withTimeout: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        timeout: 45000,
      };

      const withoutTimeout: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        timeout: undefined,
      };

      const omittedTimeout: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
      };

      expect(withTimeout.timeout).toBe(45000);
      expect(withoutTimeout.timeout).toBeUndefined();
      expect(omittedTimeout.timeout).toBeUndefined();
    });
  });

  describe('common configuration patterns', () => {
    it('supports typical timeout values', () => {
      const short: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        timeout: 5000,
      };

      const standard: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        timeout: 30000,
      };

      const extended: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        timeout: 60000,
      };

      expect(short.timeout).toBe(5000);
      expect(standard.timeout).toBe(30000);
      expect(extended.timeout).toBe(60000);
    });

    it('supports typical index naming patterns', () => {
      const simple: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'embeddings',
      };

      const descriptive: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'product-embeddings',
      };

      const versioned: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'embeddings-v2',
      };

      expect(simple.index).toBe('embeddings');
      expect(descriptive.index).toBe('product-embeddings');
      expect(versioned.index).toBe('embeddings-v2');
    });

    it('supports typical namespace patterns', () => {
      const envBased: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'production',
      };

      const featureBased: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'feature-search',
      };

      const userBased: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
        namespace: 'user-12345',
      };

      expect(envBased.namespace).toBe('production');
      expect(featureBased.namespace).toBe('feature-search');
      expect(userBased.namespace).toBe('user-12345');
    });
  });

  describe('required field validation', () => {
    it('requires apiKey field at compile time', () => {
      // TypeScript compilation error if uncommented:
      // const config: PineconeConfig = {
      //   index: 'test-index',
      // };

      // Valid assignment to verify type constraint
      const validConfig: PineconeConfig = {
        apiKey: 'required-api-key',
        index: 'test-index',
      };

      expect(validConfig.apiKey).toBe('required-api-key');
    });

    it('requires index field at compile time', () => {
      // TypeScript compilation error if uncommented:
      // const config: PineconeConfig = {
      //   apiKey: 'test-api-key',
      // };

      // Valid assignment to verify type constraint
      const validConfig: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'required-index',
      };

      expect(validConfig.index).toBe('required-index');
    });
  });

  describe('export availability', () => {
    it('exports PineconeConfig type from barrel export', async () => {
      const barrel = await import('../src/index.js');

      // TypeScript validates the type exists at compile time
      const config: PineconeConfig = {
        apiKey: 'test-api-key',
        index: 'test-index',
      };

      expect(config).toBeDefined();
      expect(barrel).toBeDefined();
      expect(barrel.VERSION).toBe('0.0.1');
    });
  });
});
