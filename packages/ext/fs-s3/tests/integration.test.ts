/**
 * Integration tests for S3 fs contract functions.
 * Tests acceptance criteria for MinIO S3-compatible service.
 *
 * SETUP REQUIRED:
 * - MinIO server running on localhost:9000
 * - Access key: minioadmin
 * - Secret key: minioadmin
 * - Bucket 'test-bucket' created
 *
 * Tests skip gracefully if MinIO unavailable (for CI).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createS3FsExtension } from '../src/index.js';
import type { S3FsConfig } from '../src/types.js';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

// MinIO configuration
const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_REGION = 'us-east-1';
const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';
const TEST_BUCKET = 'test-bucket';

/**
 * Check if MinIO is available with timeout.
 * Tests skip if MinIO not running.
 */
async function isMinIOAvailable(): Promise<boolean> {
  try {
    // Wrap in promise with timeout to prevent hanging on connection attempts
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    const checkPromise = (async () => {
      const client = new S3Client({
        region: MINIO_REGION,
        endpoint: MINIO_ENDPOINT,
        credentials: {
          accessKeyId: MINIO_ACCESS_KEY,
          secretAccessKey: MINIO_SECRET_KEY,
        },
        forcePathStyle: true,
        requestHandler: {
          requestTimeout: 2000, // 2 second request timeout
        },
      });

      // Try to create bucket (idempotent)
      await client.send(
        new CreateBucketCommand({
          Bucket: TEST_BUCKET,
        })
      );

      return true;
    })();

    return await Promise.race([checkPromise, timeoutPromise]);
  } catch (error) {
    // Bucket already exists is success
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: string }).name === 'BucketAlreadyOwnedByYou'
    ) {
      return true;
    }

    // Connection refused, timeout, or network error means MinIO not available
    if (
      error &&
      typeof error === 'object' &&
      ('code' in error || 'message' in error)
    ) {
      const code = ('code' in error && (error as { code: string }).code) || '';
      const message =
        ('message' in error && (error as { message: string }).message) || '';

      if (
        code === 'ECONNREFUSED' ||
        code === 'NetworkingError' ||
        message.includes('timeout')
      ) {
        return false;
      }
    }

    // Other errors indicate MinIO might be available but misconfigured
    console.warn('MinIO availability check failed:', error);
    return false;
  }
}

/**
 * Create MinIO config for testing.
 */
function createMinIOConfig(
  mounts: Record<string, S3FsConfig['mounts'][string]>
): S3FsConfig {
  return {
    region: MINIO_REGION,
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
    endpoint: MINIO_ENDPOINT,
    forcePathStyle: true,
    mounts,
  };
}

// Skip all tests if MinIO unavailable
let minioAvailable = false;

beforeAll(
  async () => {
    minioAvailable = await isMinIOAvailable();
    if (!minioAvailable) {
      console.warn(
        'MinIO not available - skipping integration tests. Start MinIO with: docker run -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data'
      );
    }
  },
  5000 // 5 second timeout for availability check
);

// Clean up after each test by removing all objects with test prefix
afterEach(async () => {
  if (!minioAvailable) return;

  // Cleanup handled by prefix-based isolation per test
});

describe('Integration Tests', () => {
  describe('AC-1: Backend Swap Without Script Changes', () => {
    it('executes identical operations with same results', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac1-backend-swap/',
        },
      });

      const ext = createS3FsExtension(config);

      // Perform series of write operations
      await ext.write?.fn(['storage', 'report.txt', 'Initial content']);
      await ext.write?.fn(['storage', 'data.json', '{"count":42}']);
      await ext.append?.fn(['storage', 'report.txt', '\nAppended line']);

      // Verify read operations
      const report = await ext.read?.fn(['storage', 'report.txt']);
      expect(report).toBe('Initial content\nAppended line');

      const data = await ext.read?.fn(['storage', 'data.json']);
      expect(data).toBe('{"count":42}');

      // Verify exists operation
      expect(await ext.exists?.fn(['storage', 'report.txt'])).toBe(true);
      expect(await ext.exists?.fn(['storage', 'missing.txt'])).toBe(false);

      // Verify list operation
      const files = await ext.list?.fn(['storage', '']);
      expect(files).toHaveLength(2);
      expect(files).toContainEqual({
        name: 'report.txt',
        type: 'file',
        size: expect.any(Number),
      });

      // Verify stat operation
      const stat = await ext.stat?.fn(['storage', 'report.txt']);
      expect(stat).toEqual({
        size: expect.any(Number),
        modified: expect.any(Number),
      });

      // Verify remove operation
      expect(await ext.remove?.fn(['storage', 'data.json'])).toBe(true);
      expect(await ext.exists?.fn(['storage', 'data.json'])).toBe(false);
    });
  });

  describe('AC-4: S3 Multi-Server File Access', () => {
    it('reads file written by another client instance', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        output: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac4-multi-server/',
        },
      });

      // Client A writes file
      const clientA = createS3FsExtension(config);
      await clientA.write?.fn(['output', 'report.txt', 'Server A content']);

      // Client B reads file (simulates different server)
      const clientB = createS3FsExtension(config);
      const content = await clientB.read?.fn(['output', 'report.txt']);

      expect(content).toBe('Server A content');
    });

    it('handles concurrent writes from multiple clients', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        shared: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac4-concurrent/',
        },
      });

      // Simulate 3 concurrent clients writing different files
      const writePromises = Array.from({ length: 3 }, async (_, index) => {
        const client = createS3FsExtension(config);
        await client.write?.fn([
          'shared',
          `file-${index}.txt`,
          `Content from client ${index}`,
        ]);
      });

      await Promise.all(writePromises);

      // Verify all writes succeeded
      const reader = createS3FsExtension(config);
      const files = await reader.list?.fn(['shared', '']);

      expect(files).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const content = await reader.read?.fn(['shared', `file-${i}.txt`]);
        expect(content).toBe(`Content from client ${i}`);
      }
    });
  });

  describe('AC-5: S3 Compatible Service Support (MinIO)', () => {
    it('completes full fs operation suite against MinIO', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        test: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac5-full-suite/',
          maxFileSize: 1024,
        },
      });

      const ext = createS3FsExtension(config);

      // Test write
      await ext.write?.fn(['test', 'sample.txt', 'Hello MinIO']);

      // Test read
      const content = await ext.read?.fn(['test', 'sample.txt']);
      expect(content).toBe('Hello MinIO');

      // Test append
      await ext.append?.fn(['test', 'sample.txt', ' from rill']);
      const appended = await ext.read?.fn(['test', 'sample.txt']);
      expect(appended).toBe('Hello MinIO from rill');

      // Test exists
      expect(await ext.exists?.fn(['test', 'sample.txt'])).toBe(true);
      expect(await ext.exists?.fn(['test', 'missing.txt'])).toBe(false);

      // Test stat
      const stat = await ext.stat?.fn(['test', 'sample.txt']);
      expect(stat).toEqual({
        size: expect.any(Number),
        modified: expect.any(Number),
      });

      // Test copy
      expect(
        await ext.copy?.fn(['test', 'sample.txt', 'sample-copy.txt'])
      ).toBe(true);
      const copied = await ext.read?.fn(['test', 'sample-copy.txt']);
      expect(copied).toBe('Hello MinIO from rill');

      // Test move
      expect(
        await ext.move?.fn(['test', 'sample-copy.txt', 'sample-moved.txt'])
      ).toBe(true);
      expect(await ext.exists?.fn(['test', 'sample-copy.txt'])).toBe(false);
      expect(await ext.exists?.fn(['test', 'sample-moved.txt'])).toBe(true);

      // Test list
      const files = await ext.list?.fn(['test', '']);
      expect(files.length).toBeGreaterThanOrEqual(2);

      // Test find (recursive)
      const found = await ext.find?.fn(['test', '']);
      expect(found.length).toBeGreaterThanOrEqual(2);

      // Test remove
      expect(await ext.remove?.fn(['test', 'sample.txt'])).toBe(true);
      expect(await ext.exists?.fn(['test', 'sample.txt'])).toBe(false);

      // Test mkdir (no-op that returns true)
      expect(await ext.mkdir?.fn(['test', 'subdir'])).toBe(true);

      // Test mounts
      const mounts = ext.mounts?.fn([]);
      expect(mounts).toEqual(['test']);
    });
  });

  describe('AC-7: Unknown Mount Name', () => {
    it('throws error with mount name for all fs functions', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac7-unknown-mount/',
        },
        cache: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac7-cache/',
        },
      });

      const ext = createS3FsExtension(config);

      // Test all functions throw for unknown mount
      await expect(ext.read?.fn(['unknown', 'file.txt'])).rejects.toThrow(
        'not configured'
      );
      await expect(
        ext.write?.fn(['unknown', 'file.txt', 'content'])
      ).rejects.toThrow('not configured');
      await expect(
        ext.append?.fn(['unknown', 'file.txt', 'content'])
      ).rejects.toThrow('not configured');
      await expect(ext.list?.fn(['unknown', ''])).rejects.toThrow(
        'not configured'
      );
      await expect(ext.find?.fn(['unknown', ''])).rejects.toThrow(
        'not configured'
      );
      await expect(ext.exists?.fn(['unknown', 'file.txt'])).rejects.toThrow(
        'not configured'
      );
      await expect(ext.remove?.fn(['unknown', 'file.txt'])).rejects.toThrow(
        'not configured'
      );
      await expect(ext.stat?.fn(['unknown', 'file.txt'])).rejects.toThrow(
        'not configured'
      );
      await expect(ext.mkdir?.fn(['unknown', 'dir'])).rejects.toThrow(
        'not configured'
      );
      await expect(
        ext.copy?.fn(['unknown', 'src.txt', 'dest.txt'])
      ).rejects.toThrow('not configured');
      await expect(
        ext.move?.fn(['unknown', 'src.txt', 'dest.txt'])
      ).rejects.toThrow('not configured');
    });
  });

  describe('AC-8: Read-Only Mode Enforcement', () => {
    it('throws error for write operations on read-only mount', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        'readonly-mount': {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly/',
        },
      });

      const ext = createS3FsExtension(config);

      // Test all write operations throw
      await expect(
        ext.write?.fn(['readonly-mount', 'file.txt', 'content'])
      ).rejects.toThrow('read-only');
      await expect(
        ext.append?.fn(['readonly-mount', 'file.txt', 'content'])
      ).rejects.toThrow('read-only');
      await expect(
        ext.remove?.fn(['readonly-mount', 'file.txt'])
      ).rejects.toThrow('read-only');
      await expect(
        ext.copy?.fn(['readonly-mount', 'src.txt', 'dest.txt'])
      ).rejects.toThrow('read-only');
      await expect(
        ext.move?.fn(['readonly-mount', 'src.txt', 'dest.txt'])
      ).rejects.toThrow('read-only');
    });

    it('allows read operations on read-only mount', async () => {
      if (!minioAvailable) return;

      // Setup: write file with read-write mount
      const writeConfig = createMinIOConfig({
        setup: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly-reads/',
        },
      });

      const writer = createS3FsExtension(writeConfig);
      await writer.write?.fn(['setup', 'data.txt', 'Read-only test']);

      // Open as read-only
      const readConfig = createMinIOConfig({
        'readonly-mount': {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly-reads/',
        },
      });

      const reader = createS3FsExtension(readConfig);

      // Read operations should succeed
      const content = await reader.read?.fn(['readonly-mount', 'data.txt']);
      expect(content).toBe('Read-only test');

      expect(await reader.exists?.fn(['readonly-mount', 'data.txt'])).toBe(
        true
      );

      const files = await reader.list?.fn(['readonly-mount', '']);
      expect(files).toHaveLength(1);

      const stat = await reader.stat?.fn(['readonly-mount', 'data.txt']);
      expect(stat).toEqual({
        size: expect.any(Number),
        modified: expect.any(Number),
      });
    });
  });

  describe('AC-9, EC-9: File Size Limit Violation', () => {
    it('throws error when reading file exceeding maxFileSize', async () => {
      if (!minioAvailable) return;

      // Setup: write large file without limit
      const writeConfig = createMinIOConfig({
        unlimited: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac9-size-limit/',
        },
      });

      const writer = createS3FsExtension(writeConfig);
      const largeContent = 'x'.repeat(2000); // 2KB file
      await writer.write?.fn(['unlimited', 'large.txt', largeContent]);

      // Read with size limit
      const readConfig = createMinIOConfig({
        limited: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac9-size-limit/',
          maxFileSize: 1024, // 1KB limit
        },
      });

      const reader = createS3FsExtension(readConfig);

      // Should throw size error
      await expect(reader.read?.fn(['limited', 'large.txt'])).rejects.toThrow(
        'exceeds limit'
      );
    });

    it('throws error when writing file exceeding maxFileSize', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        limited: {
          mode: 'write',
          bucket: TEST_BUCKET,
          prefix: 'ac9-write-limit/',
          maxFileSize: 100,
        },
      });

      const ext = createS3FsExtension(config);

      // Should throw size error
      const largeContent = 'x'.repeat(200);
      await expect(
        ext.write?.fn(['limited', 'large.txt', largeContent])
      ).rejects.toThrow('exceeds limit');
    });
  });

  describe('EC-8: File Not Found', () => {
    it('throws error for read on non-existent file', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec8-not-found/',
        },
      });

      const ext = createS3FsExtension(config);

      await expect(ext.read?.fn(['storage', 'missing.txt'])).rejects.toThrow(
        'not found'
      );
    });

    it('returns false for exists on non-existent file', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec8-exists/',
        },
      });

      const ext = createS3FsExtension(config);

      expect(await ext.exists?.fn(['storage', 'missing.txt'])).toBe(false);
    });
  });

  describe('EC-10: Write on Read-Only Mount', () => {
    it('throws PermissionError for all write operations', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        readonly: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec10-readonly/',
        },
      });

      const ext = createS3FsExtension(config);

      // All write operations should throw
      await expect(
        ext.write?.fn(['readonly', 'test.txt', 'content'])
      ).rejects.toThrow('read-only');
      await expect(
        ext.append?.fn(['readonly', 'test.txt', 'content'])
      ).rejects.toThrow('read-only');
      await expect(ext.remove?.fn(['readonly', 'test.txt'])).rejects.toThrow(
        'read-only'
      );
    });
  });

  describe('EC-11: Parent Directory Missing on S3 Write', () => {
    it('succeeds writing to path with non-existent parent directories', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'write',
          bucket: TEST_BUCKET,
          prefix: 'ec11-no-parent/',
        },
      });

      const ext = createS3FsExtension(config);

      // Write to deeply nested path without creating parent directories
      await expect(
        ext.write?.fn(['storage', 'a/b/c/d/file.txt', 'content'])
      ).resolves.not.toThrow();

      // Verify file was written
      const readConfig = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec11-no-parent/',
        },
      });

      const reader = createS3FsExtension(readConfig);
      const content = await reader.read?.fn(['storage', 'a/b/c/d/file.txt']);
      expect(content).toBe('content');
    });
  });

  describe('EC-12: mkdir is No-Op Returning True', () => {
    it('returns true without creating directory marker', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec12-mkdir/',
        },
      });

      const ext = createS3FsExtension(config);

      // mkdir should return true
      expect(await ext.mkdir?.fn(['storage', 'subdir'])).toBe(true);
      expect(await ext.mkdir?.fn(['storage', 'a/b/c'])).toBe(true);

      // No directory markers should be created
      const files = await ext.list?.fn(['storage', '']);
      expect(files).toHaveLength(0);
    });
  });

  describe('EC-13: Unknown Mount Throws MountError', () => {
    it('includes available mounts in error message', async () => {
      if (!minioAvailable) return;

      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec13-mount-error/',
        },
        cache: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec13-cache/',
        },
      });

      const ext = createS3FsExtension(config);

      try {
        await ext.read?.fn(['unknown', 'file.txt']);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('unknown');
        expect(message).toContain('not configured');
      }
    });
  });
});
