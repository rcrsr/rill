/**
 * S3 file system extension for rill.
 * Provides file system operations backed by S3-compatible storage.
 */

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { S3FsConfig, S3FsMountConfig } from './types.js';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// PUBLIC TYPES
// ============================================================
export type { S3FsMountConfig, S3Credentials, S3FsConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create S3 filesystem extension with S3-compatible storage backend.
 *
 * Initializes one S3Client shared across all mounts.
 * Returns 12 functions: read, write, append, list, find, exists, remove, stat, mkdir, copy, move, mounts.
 *
 * @param config - S3 client and mount configuration
 * @returns ExtensionResult with 12 filesystem functions and dispose handler
 * @throws Error if configuration is invalid (missing region, empty mounts)
 *
 * @example
 * ```typescript
 * // AWS S3 configuration
 * const fsExt = createS3FsExtension({
 *   region: 'us-west-2',
 *   credentials: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
 *   },
 *   mounts: {
 *     uploads: {
 *       mode: 'read-write',
 *       bucket: 'my-uploads',
 *       prefix: 'user-files/'
 *     }
 *   }
 * });
 *
 * // MinIO (S3-compatible service)
 * const fsExt = createS3FsExtension({
 *   region: 'us-east-1',
 *   credentials: {
 *     accessKeyId: 'minioadmin',
 *     secretAccessKey: 'minioadmin'
 *   },
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   mounts: {
 *     local: {
 *       mode: 'read-write',
 *       bucket: 'test-bucket',
 *       prefix: ''
 *     }
 *   }
 * });
 * ```
 */
export function createS3FsExtension(config: S3FsConfig) {
  // AC-10: Configuration validation - region required
  if (!config.region || config.region.trim() === '') {
    throw new Error('S3 configuration requires non-empty region');
  }

  // AC-10: Configuration validation - mounts required
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new Error('S3 configuration requires at least one mount');
  }

  // AC-10: Configuration validation - endpoint format if provided
  if (config.endpoint !== undefined) {
    if (typeof config.endpoint !== 'string' || config.endpoint.trim() === '') {
      throw new Error('S3 endpoint must be a non-empty string');
    }

    // Basic URL validation
    try {
      new URL(config.endpoint);
    } catch {
      throw new Error(`S3 endpoint must be a valid URL: ${config.endpoint}`);
    }
  }

  // AC-5: Initialize S3Client with configuration
  // One client shared across all mounts per spec
  // Build config object conditionally to satisfy exactOptionalPropertyTypes
  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
    endpoint?: string;
    forcePathStyle?: boolean;
  } = {
    region: config.region,
  };

  if (config.credentials !== undefined) {
    clientConfig.credentials = config.credentials;
  }
  if (config.endpoint !== undefined) {
    clientConfig.endpoint = config.endpoint;
  }
  if (config.forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = config.forcePathStyle;
  }

  const s3Client = new S3Client(clientConfig);

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Get mount configuration by name.
   * EC-13: Throws for unknown mount names.
   */
  const getMount = (mountName: string): S3FsMountConfig => {
    const mount = config.mounts[mountName];
    if (!mount) {
      throw new Error(`mount "${mountName}" not configured`);
    }
    return mount;
  };

  /**
   * Map file path to S3 object key.
   * Combines mount prefix with file path.
   */
  const mapPath = (mount: S3FsMountConfig, filePath: string): string => {
    // Remove leading slash if present
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return mount.prefix + normalized;
  };

  /**
   * Check if mount mode permits operation.
   * EC-10: Throws for read-only mounts on write operations.
   */
  const checkMode = (
    mount: S3FsMountConfig,
    operation: 'read' | 'write'
  ): void => {
    if (mount.mode === 'read-write') return;
    if (mount.mode === 'read' && operation === 'read') return;
    if (mount.mode === 'write' && operation === 'write') return;

    throw new Error(
      `mount does not permit ${operation} operations (mode: ${mount.mode})`
    );
  };

  /**
   * Check file size against limit.
   * EC-9: Throws when file exceeds maxFileSize.
   */
  const checkFileSize = (
    size: number,
    mount: S3FsMountConfig,
    key: string
  ): void => {
    const max = mount.maxFileSize ?? 10485760; // 10MB default
    if (size > max) {
      throw new Error(
        `file exceeds size limit (${size} > ${max} bytes): ${key}`
      );
    }
  };

  /**
   * Match filename against glob pattern.
   * Simple glob implementation for file filtering.
   */
  const matchesGlob = (filename: string, pattern: string): boolean => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.') && !pattern.includes('{')) {
      const ext = pattern.slice(1);
      return filename.endsWith(ext);
    }
    if (pattern.startsWith('*.{') && pattern.endsWith('}')) {
      const extensionsStr = pattern.slice(3, -1);
      const extensions = extensionsStr.split(',').map((e) => `.${e.trim()}`);
      return extensions.some((ext) => filename.endsWith(ext));
    }
    if (pattern.startsWith('**/')) {
      const subPattern = pattern.slice(3);
      return matchesGlob(filename, subPattern);
    }
    return false;
  };

  /**
   * Extract filename from S3 key.
   */
  const getFilename = (key: string): string => {
    const parts = key.split('/');
    return parts[parts.length - 1] ?? '';
  };

  /**
   * Read S3 stream to string.
   * Handles stream consumption to free socket connections.
   */
  const streamToString = async (
    output: GetObjectCommandOutput
  ): Promise<string> => {
    if (!output.Body) {
      throw new Error('S3 response body is empty');
    }
    return await output.Body.transformToString();
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  /**
   * Read file contents from S3.
   * IR-12, EC-8 (not found), EC-9 (size limit)
   */
  const read = async (args: RillValue[]): Promise<string> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'read');

    const key = mapPath(mount, filePath);

    try {
      // Check file size before reading
      const headResult = await s3Client.send(
        new HeadObjectCommand({
          Bucket: mount.bucket,
          Key: key,
        })
      );

      const size = headResult.ContentLength ?? 0;
      checkFileSize(size, mount, key);

      // Read file content
      const getResult = await s3Client.send(
        new GetObjectCommand({
          Bucket: mount.bucket,
          Key: key,
        })
      );

      return await streamToString(getResult);
    } catch (error) {
      // EC-8: File not found
      if (error && typeof error === 'object' && 'name' in error) {
        if ((error as { name: string }).name === 'NoSuchKey') {
          throw new Error(`file not found: ${filePath}`);
        }
      }
      throw error;
    }
  };

  /**
   * Write file contents to S3.
   * IR-13, EC-10 (read-only mode)
   */
  const write = async (args: RillValue[]): Promise<string> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;
    const content = args[2] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'write'); // EC-10

    const key = mapPath(mount, filePath);
    const contentSize = Buffer.byteLength(content, 'utf-8');
    checkFileSize(contentSize, mount, key);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: mount.bucket,
        Key: key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
      })
    );

    return String(contentSize);
  };

  /**
   * Append content to file in S3.
   * IR-14: Read-then-write (not atomic)
   */
  const append = async (args: RillValue[]): Promise<string> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;
    const content = args[2] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'write');

    const key = mapPath(mount, filePath);

    // Read existing content (if file exists)
    let existingContent = '';
    try {
      const getResult = await s3Client.send(
        new GetObjectCommand({
          Bucket: mount.bucket,
          Key: key,
        })
      );
      existingContent = await streamToString(getResult);
    } catch (error) {
      // File doesn't exist - start with empty content
      if (error && typeof error === 'object' && 'name' in error) {
        if ((error as { name: string }).name !== 'NoSuchKey') {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Concatenate and write
    const newContent = existingContent + content;
    const contentSize = Buffer.byteLength(newContent, 'utf-8');
    checkFileSize(contentSize, mount, key);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: mount.bucket,
        Key: key,
        Body: newContent,
        ContentType: 'text/plain; charset=utf-8',
      })
    );

    return String(Buffer.byteLength(content, 'utf-8'));
  };

  /**
   * List objects in directory (non-recursive).
   * IR-15: Uses delimiter '/' to list directory contents
   */
  const list = async (args: RillValue[]): Promise<RillValue[]> => {
    const mountName = args[0] as string;
    const dirPath = (args[1] as string | undefined) ?? '';

    const mount = getMount(mountName);
    checkMode(mount, 'read');

    const prefix = mapPath(mount, dirPath);
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';

    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: mount.bucket,
        Prefix: normalizedPrefix,
        Delimiter: '/', // Non-recursive
      })
    );

    const items: RillValue[] = [];

    // Add files
    if (result.Contents) {
      for (const obj of result.Contents) {
        if (!obj.Key || obj.Key === normalizedPrefix) continue; // Skip directory marker

        const filename = getFilename(obj.Key);
        if (mount.glob && !matchesGlob(filename, mount.glob)) continue;

        items.push({
          name: filename,
          type: 'file',
          size: obj.Size ?? 0,
        });
      }
    }

    // Add subdirectories (common prefixes)
    if (result.CommonPrefixes) {
      for (const prefix of result.CommonPrefixes) {
        if (!prefix.Prefix) continue;

        const dirName = prefix.Prefix.slice(normalizedPrefix.length).replace(
          /\/$/,
          ''
        );
        items.push({
          name: dirName,
          type: 'directory',
          size: 0,
        });
      }
    }

    return items;
  };

  /**
   * Find files matching glob pattern (recursive).
   * IR-16: Recursive search with client-side glob filtering
   */
  const find = async (args: RillValue[]): Promise<RillValue[]> => {
    const mountName = args[0] as string;
    const pattern = (args[1] as string | undefined) ?? '*';

    const mount = getMount(mountName);
    checkMode(mount, 'read');

    const results: string[] = [];
    let continuationToken: string | undefined;

    // Recursive listing (no delimiter)
    do {
      const result = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: mount.bucket,
          Prefix: mount.prefix,
          ContinuationToken: continuationToken,
        })
      );

      if (result.Contents) {
        for (const obj of result.Contents) {
          if (!obj.Key) continue;

          const filename = getFilename(obj.Key);

          // Apply pattern matching
          if (matchesGlob(filename, pattern)) {
            // Apply mount glob filter if present
            if (!mount.glob || matchesGlob(filename, mount.glob)) {
              // Return path relative to mount prefix
              const relativePath = obj.Key.slice(mount.prefix.length);
              results.push(relativePath);
            }
          }
        }
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return results;
  };

  /**
   * Check if file exists in S3.
   * IR-17: Uses HeadObject
   */
  const exists = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'read');

    const key = mapPath(mount, filePath);

    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: mount.bucket,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error) {
        if ((error as { name: string }).name === 'NotFound') {
          return false;
        }
      }
      return false;
    }
  };

  /**
   * Delete file from S3.
   * IR-18: Uses DeleteObject
   */
  const remove = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'write');

    const key = mapPath(mount, filePath);

    // Check if file exists before deleting
    const fileExists = await exists([mountName, filePath]);
    if (!fileExists) {
      return false;
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: mount.bucket,
        Key: key,
      })
    );

    return true;
  };

  /**
   * Get file metadata from S3.
   * IR-19: Uses HeadObject, returns size and modified
   */
  const stat = async (
    args: RillValue[]
  ): Promise<Record<string, RillValue>> => {
    const mountName = args[0] as string;
    const filePath = args[1] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'read');

    const key = mapPath(mount, filePath);

    try {
      const result = await s3Client.send(
        new HeadObjectCommand({
          Bucket: mount.bucket,
          Key: key,
        })
      );

      const filename = getFilename(key);

      return {
        name: filename,
        type: 'file',
        size: result.ContentLength ?? 0,
        modified: result.LastModified?.toISOString() ?? '',
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error) {
        if ((error as { name: string }).name === 'NotFound') {
          throw new Error(`file not found: ${filePath}`);
        }
      }
      throw error;
    }
  };

  /**
   * Create directory (no-op for S3).
   * IR-20, EC-12: S3 has no directories, returns true
   */
  const mkdir = async (args: RillValue[]): Promise<boolean> => {
    // Validate mount exists (for consistency with other functions)
    const mountName = args[0] as string;
    getMount(mountName);

    // S3 has no directories - this is a no-op
    return true;
  };

  /**
   * Copy file within S3.
   * IR-21: Uses CopyObject
   */
  const copy = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const srcPath = args[1] as string;
    const destPath = args[2] as string;

    const mount = getMount(mountName);
    checkMode(mount, 'read'); // Need read for source
    checkMode(mount, 'write'); // Need write for destination

    const srcKey = mapPath(mount, srcPath);
    const destKey = mapPath(mount, destPath);

    // Check source file size
    const headResult = await s3Client.send(
      new HeadObjectCommand({
        Bucket: mount.bucket,
        Key: srcKey,
      })
    );

    const size = headResult.ContentLength ?? 0;
    checkFileSize(size, mount, destKey);

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: mount.bucket,
        CopySource: `${mount.bucket}/${srcKey}`,
        Key: destKey,
      })
    );

    return true;
  };

  /**
   * Move file within S3.
   * IR-22: CopyObject + DeleteObject
   */
  const move = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const srcPath = args[1] as string;

    // Copy file
    await copy(args);

    // Delete source
    const mount = getMount(mountName);
    const srcKey = mapPath(mount, srcPath);

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: mount.bucket,
        Key: srcKey,
      })
    );

    return true;
  };

  /**
   * List configured mounts.
   * IR-23: Returns mount metadata
   */
  const mountsList = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];

    for (const [name, mount] of Object.entries(config.mounts)) {
      result.push({
        name,
        mode: mount.mode,
        glob: mount.glob ?? '',
        bucket: mount.bucket,
        prefix: mount.prefix,
      });
    }

    return result;
  };

  // ============================================================
  // DISPOSE
  // ============================================================

  /**
   * Clean up S3 client resources.
   * IC-6: Dispose cleans up S3 client properly.
   */
  const dispose = async (): Promise<void> => {
    // AWS SDK v3 S3Client has destroy() method for cleanup
    s3Client.destroy();
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  return {
    read: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
      ],
      fn: read,
      description: 'Read file contents from S3',
      returnType: 'string',
    },
    write: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
        { name: 'content', type: 'string', description: 'Content to write' },
      ],
      fn: write,
      description: 'Write file to S3, replacing if exists',
      returnType: 'string',
    },
    append: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
        { name: 'content', type: 'string', description: 'Content to append' },
      ],
      fn: append,
      description: 'Append content to file in S3',
      returnType: 'string',
    },
    list: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'Directory path relative to mount',
          defaultValue: '',
        },
      ],
      fn: list,
      description: 'List directory contents in S3',
      returnType: 'list',
    },
    find: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'pattern',
          type: 'string',
          description: 'Glob pattern for filtering',
          defaultValue: '*',
        },
      ],
      fn: find,
      description: 'Recursive file search in S3',
      returnType: 'list',
    },
    exists: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
      ],
      fn: exists,
      description: 'Check if file exists in S3',
      returnType: 'bool',
    },
    remove: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
      ],
      fn: remove,
      description: 'Delete file from S3',
      returnType: 'bool',
    },
    stat: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
      ],
      fn: stat,
      description: 'Get file metadata from S3',
      returnType: 'dict',
    },
    mkdir: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'Directory path relative to mount',
        },
      ],
      fn: mkdir,
      description: 'Create directory (no-op for S3)',
      returnType: 'bool',
    },
    copy: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'src', type: 'string', description: 'Source file path' },
        { name: 'dest', type: 'string', description: 'Destination file path' },
      ],
      fn: copy,
      description: 'Copy file within S3',
      returnType: 'bool',
    },
    move: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'src', type: 'string', description: 'Source file path' },
        { name: 'dest', type: 'string', description: 'Destination file path' },
      ],
      fn: move,
      description: 'Move file within S3',
      returnType: 'bool',
    },
    mounts: {
      params: [],
      fn: mountsList,
      description: 'List configured S3 mounts',
      returnType: 'list',
    },
    dispose,
  };
}

// ============================================================
// VERSION
// ============================================================
export const S3_FS_EXTENSION_VERSION = '0.0.1';
