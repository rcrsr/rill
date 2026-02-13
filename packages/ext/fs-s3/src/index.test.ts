import { describe, it, expect } from 'vitest';
import { S3_FS_EXTENSION_VERSION, createS3FsExtension } from './index.js';
import type { S3FsMountConfig, S3Credentials, S3FsConfig } from './index.js';

describe('S3 FS Extension', () => {
  describe('package exports', () => {
    it('exports version constant', () => {
      expect(S3_FS_EXTENSION_VERSION).toBe('0.0.1');
    });
  });

  describe('type definitions', () => {
    it('accepts valid S3FsMountConfig', () => {
      const mountConfig: S3FsMountConfig = {
        mode: 'read-write',
        bucket: 'test-bucket',
        prefix: 'uploads/',
        glob: '*.json',
        maxFileSize: 5242880,
      };
      expect(mountConfig.mode).toBe('read-write');
      expect(mountConfig.bucket).toBe('test-bucket');
      expect(mountConfig.prefix).toBe('uploads/');
      expect(mountConfig.glob).toBe('*.json');
      expect(mountConfig.maxFileSize).toBe(5242880);
    });

    it('accepts S3FsMountConfig without optional fields', () => {
      const mountConfig: S3FsMountConfig = {
        mode: 'read',
        bucket: 'test-bucket',
        prefix: '',
      };
      expect(mountConfig.mode).toBe('read');
      expect(mountConfig.glob).toBeUndefined();
      expect(mountConfig.maxFileSize).toBeUndefined();
    });

    it('accepts valid S3Credentials', () => {
      const credentials: S3Credentials = {
        accessKeyId: 'test-key-id',
        secretAccessKey: 'test-secret-key',
      };
      expect(credentials.accessKeyId).toBe('test-key-id');
      expect(credentials.secretAccessKey).toBe('test-secret-key');
    });

    it('accepts valid S3FsConfig with credentials', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: 'files/',
          },
        },
      };
      expect(config.region).toBe('us-west-2');
      expect(config.credentials?.accessKeyId).toBe('test-key');
      expect(config.mounts.uploads.bucket).toBe('test-bucket');
    });

    it('accepts S3FsConfig without credentials (uses default chain)', () => {
      const config: S3FsConfig = {
        region: 'eu-west-1',
        mounts: {
          data: {
            mode: 'read',
            bucket: 'data-bucket',
            prefix: 'exports/',
          },
        },
      };
      expect(config.credentials).toBeUndefined();
    });

    it('accepts S3FsConfig with endpoint for S3-compatible services', () => {
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
            bucket: 'test',
            prefix: '',
          },
        },
      };
      expect(config.endpoint).toBe('http://localhost:9000');
      expect(config.forcePathStyle).toBe(true);
    });

    it('accepts S3FsConfig with multiple mounts', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'write',
            bucket: 'uploads-bucket',
            prefix: 'user-files/',
            glob: '*.{jpg,png,pdf}',
            maxFileSize: 10485760,
          },
          downloads: {
            mode: 'read',
            bucket: 'downloads-bucket',
            prefix: 'public/',
          },
          cache: {
            mode: 'read-write',
            bucket: 'cache-bucket',
            prefix: 'temp/',
            maxFileSize: 1048576,
          },
        },
      };
      expect(Object.keys(config.mounts)).toHaveLength(3);
      expect(config.mounts.uploads.mode).toBe('write');
      expect(config.mounts.downloads.mode).toBe('read');
      expect(config.mounts.cache.mode).toBe('read-write');
    });
  });

  describe('createS3FsExtension factory', () => {
    describe('AC-10: configuration validation', () => {
      it('throws error when region is missing', () => {
        expect(() =>
          createS3FsExtension({
            region: '',
            mounts: {
              test: {
                mode: 'read',
                bucket: 'test-bucket',
                prefix: '',
              },
            },
          })
        ).toThrow('S3 configuration requires non-empty region');
      });

      it('throws error when mounts is empty', () => {
        expect(() =>
          createS3FsExtension({
            region: 'us-west-2',
            mounts: {},
          })
        ).toThrow('S3 configuration requires at least one mount');
      });

      it('throws error when endpoint is empty string', () => {
        expect(() =>
          createS3FsExtension({
            region: 'us-west-2',
            endpoint: '',
            mounts: {
              test: {
                mode: 'read',
                bucket: 'test-bucket',
                prefix: '',
              },
            },
          })
        ).toThrow('S3 endpoint must be a non-empty string');
      });

      it('throws error when endpoint is invalid URL', () => {
        expect(() =>
          createS3FsExtension({
            region: 'us-west-2',
            endpoint: 'not-a-valid-url',
            mounts: {
              test: {
                mode: 'read',
                bucket: 'test-bucket',
                prefix: '',
              },
            },
          })
        ).toThrow('S3 endpoint must be a valid URL: not-a-valid-url');
      });
    });

    describe('AC-5: S3-compatible configuration', () => {
      it('accepts endpoint and forcePathStyle config', () => {
        const ext = createS3FsExtension({
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
        });

        expect(ext).toBeDefined();
        expect(ext.dispose).toBeDefined();
      });

      it('accepts valid endpoint URL formats', () => {
        const ext = createS3FsExtension({
          region: 'auto',
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test',
          },
          endpoint: 'https://account.r2.cloudflarestorage.com',
          mounts: {
            r2: {
              mode: 'read-write',
              bucket: 'my-bucket',
              prefix: 'data/',
            },
          },
        });

        expect(ext).toBeDefined();
        expect(ext.dispose).toBeDefined();
      });
    });

    describe('IC-6: ExtensionResult structure', () => {
      it('returns object with dispose function', () => {
        const ext = createS3FsExtension({
          region: 'us-west-2',
          credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
          },
          mounts: {
            uploads: {
              mode: 'read-write',
              bucket: 'test-bucket',
              prefix: 'files/',
            },
          },
        });

        expect(ext).toBeDefined();
        expect(typeof ext.dispose).toBe('function');
      });

      it('dispose is async function', async () => {
        const ext = createS3FsExtension({
          region: 'us-west-2',
          credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
          },
          mounts: {
            test: {
              mode: 'read',
              bucket: 'test-bucket',
              prefix: '',
            },
          },
        });

        expect(ext.dispose).toBeDefined();
        const result = ext.dispose!();
        expect(result).toBeInstanceOf(Promise);
        await result; // Should complete without error
      });
    });

    describe('IC-6: dispose cleanup', () => {
      it('dispose cleans up S3 client without throwing', async () => {
        const ext = createS3FsExtension({
          region: 'us-west-2',
          credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
          },
          mounts: {
            test: {
              mode: 'read',
              bucket: 'test-bucket',
              prefix: '',
            },
          },
        });

        expect(ext.dispose).toBeDefined();
        await expect(ext.dispose!()).resolves.toBeUndefined();
      });

      it('dispose can be called multiple times', async () => {
        const ext = createS3FsExtension({
          region: 'us-west-2',
          credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
          },
          mounts: {
            test: {
              mode: 'read',
              bucket: 'test-bucket',
              prefix: '',
            },
          },
        });

        await ext.dispose!();
        await expect(ext.dispose!()).resolves.toBeUndefined();
      });
    });
  });
});
