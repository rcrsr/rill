/**
 * Tests for S3 fs extension factory.
 * Validates configuration, S3 client initialization, and function exports.
 */

import { describe, it, expect } from 'vitest';
import { createS3FsExtension } from '../src/index.js';
import type { S3FsConfig } from '../src/types.js';

describe('createS3FsExtension', () => {
  describe('configuration validation', () => {
    it('throws for missing region', () => {
      const config = {
        mounts: {
          test: {
            mode: 'read-write' as const,
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      } as S3FsConfig;

      expect(() => createS3FsExtension(config)).toThrow('region');
    });

    it('throws for empty region', () => {
      const config: S3FsConfig = {
        region: '',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config)).toThrow('region');
    });

    it('throws for whitespace-only region', () => {
      const config: S3FsConfig = {
        region: '   ',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config)).toThrow('region');
    });

    it('throws for missing mounts', () => {
      const config = {
        region: 'us-west-2',
      } as S3FsConfig;

      expect(() => createS3FsExtension(config)).toThrow('at least one mount');
    });

    it('throws for empty mounts object', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        mounts: {},
      };

      expect(() => createS3FsExtension(config)).toThrow('at least one mount');
    });

    it('throws for invalid endpoint (empty string)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: '',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config)).toThrow('non-empty string');
    });

    it('throws for invalid endpoint (whitespace only)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: '   ',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config)).toThrow('non-empty string');
    });

    it('throws for invalid endpoint (malformed URL)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: 'not-a-url',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config)).toThrow('valid URL');
    });
  });

  describe('valid configuration acceptance', () => {
    it('accepts minimal AWS S3 configuration', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts S3-compatible service configuration (MinIO)', () => {
      const config: S3FsConfig = {
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
        },
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        mounts: {
          local: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts Cloudflare R2 configuration', () => {
      const config: S3FsConfig = {
        region: 'auto',
        credentials: {
          accessKeyId: 'r2-key',
          secretAccessKey: 'r2-secret',
        },
        endpoint: 'https://account123.r2.cloudflarestorage.com',
        mounts: {
          storage: {
            mode: 'read-write',
            bucket: 'my-r2-bucket',
            prefix: 'app-data/',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts configuration without credentials (uses default provider chain)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts multiple mounts', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'uploads-bucket',
            prefix: 'user-files/',
          },
          backups: {
            mode: 'read',
            bucket: 'backups-bucket',
            prefix: 'database/',
          },
          logs: {
            mode: 'write',
            bucket: 'logs-bucket',
            prefix: 'app-logs/',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts mount with glob pattern', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          images: {
            mode: 'read-write',
            bucket: 'assets-bucket',
            prefix: 'images/',
            glob: '*.{jpg,png,gif}',
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });

    it('accepts mount with custom maxFileSize', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'uploads-bucket',
            prefix: 'files/',
            maxFileSize: 5242880, // 5 MB
          },
        },
      };

      const ext = createS3FsExtension(config);
      expect(ext).toBeDefined();
      expect(ext.read).toBeDefined();
      ext.dispose?.();
    });
  });

  describe('function exports', () => {
    it('exports all 12 filesystem functions', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);

      // Verify all 12 functions exist
      expect(ext.read).toBeDefined();
      expect(ext.write).toBeDefined();
      expect(ext.append).toBeDefined();
      expect(ext.list).toBeDefined();
      expect(ext.find).toBeDefined();
      expect(ext.exists).toBeDefined();
      expect(ext.remove).toBeDefined();
      expect(ext.stat).toBeDefined();
      expect(ext.mkdir).toBeDefined();
      expect(ext.copy).toBeDefined();
      expect(ext.move).toBeDefined();
      expect(ext.mounts).toBeDefined();

      ext.dispose?.();
    });

    it('all functions have correct HostFunctionDefinition structure', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);

      // Verify structure for read function (all follow same pattern)
      expect(ext.read.params).toBeDefined();
      expect(Array.isArray(ext.read.params)).toBe(true);
      expect(ext.read.params.length).toBeGreaterThan(0);
      expect(ext.read.fn).toBeTypeOf('function');
      expect(ext.read.description).toBeTypeOf('string');
      expect(ext.read.returnType).toBe('string');

      // Verify structure for write function
      expect(ext.write.params).toBeDefined();
      expect(Array.isArray(ext.write.params)).toBe(true);
      expect(ext.write.fn).toBeTypeOf('function');
      expect(ext.write.description).toBeTypeOf('string');
      expect(ext.write.returnType).toBe('string');

      // Verify structure for mounts function (no params)
      expect(ext.mounts.params).toBeDefined();
      expect(Array.isArray(ext.mounts.params)).toBe(true);
      expect(ext.mounts.params.length).toBe(0);
      expect(ext.mounts.fn).toBeTypeOf('function');
      expect(ext.mounts.description).toBeTypeOf('string');
      expect(ext.mounts.returnType).toBe('list');

      ext.dispose?.();
    });

    it('exports dispose function', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);

      expect(ext.dispose).toBeDefined();
      expect(ext.dispose).toBeTypeOf('function');

      ext.dispose?.();
    });
  });

  describe('dispose lifecycle', () => {
    it('handles dispose without error', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);

      expect(() => {
        ext.dispose?.();
      }).not.toThrow();
    });

    it('is idempotent (can call dispose multiple times)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config);

      expect(() => {
        ext.dispose?.();
        ext.dispose?.();
        ext.dispose?.();
      }).not.toThrow();
    });
  });
});
