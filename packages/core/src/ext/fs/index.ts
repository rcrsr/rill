/**
 * fs Extension Factory
 *
 * Provides sandboxed filesystem operations via mount-based access control.
 * All 12 functions implement path validation, permission checks, and glob filtering.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from '../../error-classes.js';
import type {
  ExtensionFactoryResult,
  ExtensionConfigSchema,
  ExtensionManifest,
} from '../../runtime/ext/extensions.js';
import { toCallable } from '../../runtime/core/callable.js';
import type { RillValue } from '../../runtime/core/types/structures.js';
import { structureToTypeValue } from '../../runtime/core/values.js';
import {
  type MountConfig,
  resolvePath,
  matchesGlob,
  initializeMount,
  parseMountPath,
} from './sandbox.js';

// ============================================================
// TYPES
// ============================================================

/** Filesystem extension configuration */
export interface FsConfig {
  /** Mount definitions keyed by mount name */
  mounts: Record<string, MountConfig>;
  /** Global file size limit in bytes (default: 10485760 = 10MB) */
  maxFileSize?: number | undefined;
  /** Text encoding for file operations (default: 'utf-8') */
  encoding?: 'utf-8' | 'utf8' | 'ascii' | undefined;
}

// Re-export MountConfig for consumers
export type { MountConfig };

export const configSchema: ExtensionConfigSchema = {
  mounts: { type: 'string', required: true },
};

// ============================================================
// FACTORY
// ============================================================

/**
 * Create filesystem extension with sandboxed operations.
 *
 * Initializes all mounts by resolving paths at creation time.
 * Returns 12 functions: read, write, append, list, find, exists, remove, stat, mkdir, copy, move, mounts.
 *
 * @param config - Mount configuration and defaults
 * @returns ExtensionFactoryResult with 12 filesystem functions
 * @throws RuntimeError if mount initialization fails
 *
 * @example
 * ```typescript
 * const fsExt = createFsExtension({
 *   mounts: {
 *     workspace: { path: '/home/user/project', mode: 'read-write' }
 *   }
 * });
 * ```
 */
export function createFsExtension(config: FsConfig): ExtensionFactoryResult {
  // Apply defaults
  const maxFileSize = config.maxFileSize ?? 10485760; // 10MB
  const encoding = config.encoding ?? 'utf-8';

  // Initialize all mounts (resolve paths at creation time)
  const mounts = { ...config.mounts };
  const initPromises = Object.values(mounts).map((mount) =>
    initializeMount(mount)
  );

  // Block on initialization to catch config errors early
  // This is a sync factory, so we use a promise wrapper pattern
  let initError: Error | undefined;
  Promise.all(initPromises).catch((err) => {
    initError = err as Error;
  });

  // Helper: check for initialization errors before operations
  const ensureInitialized = async (): Promise<void> => {
    if (initError) throw initError;
    await Promise.all(initPromises); // Wait for completion
  };

  // Helper: get effective max file size (mount-specific or global)
  const getMaxFileSize = (mountName: string): number => {
    const mount = mounts[mountName];
    return mount?.maxFileSize ?? maxFileSize;
  };

  // Helper: check file size against limit
  const checkFileSize = (size: number, max: number, filePath: string): void => {
    if (size > max) {
      throw new RuntimeError(
        'RILL-R004',
        `file exceeds size limit (${size} > ${max})`,
        undefined,
        { path: filePath, size, max }
      );
    }
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  /**
   * Read file contents.
   * IR-1, EC-5 (file not found), EC-6 (size limit)
   */
  const read = async (
    args: Record<string, RillValue>
    // ctx and location not used but required by CallableFn signature
  ): Promise<string> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    // EC-5: Catch file not found from resolvePath
    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'read');
    } catch (error) {
      if (error instanceof RuntimeError) {
        // Convert RILL-R021 (sandbox error) to RILL-R004 (extension error)
        throw new RuntimeError(
          'RILL-R004',
          `file not found: ${filePath}`,
          undefined,
          { path: filePath }
        );
      }
      throw error;
    }

    // Check file size before reading
    const stats = await fs.stat(resolvedPath);
    const max = getMaxFileSize(mountName);
    checkFileSize(stats.size, max, resolvedPath);

    return await fs.readFile(resolvedPath, encoding);
  };

  /**
   * Write file contents, replacing if exists.
   * IR-2
   */
  const write = async (args: Record<string, RillValue>): Promise<string> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const content = args['content'] as string;

    const resolvedPath = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      true // createMode: resolve parent directory
    );

    // Check content size before writing
    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);
    checkFileSize(contentSize, max, resolvedPath);

    await fs.writeFile(resolvedPath, content, encoding);

    // Return bytes written as string
    return String(contentSize);
  };

  /**
   * Append content to file.
   * IR-3
   */
  const append = async (args: Record<string, RillValue>): Promise<string> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const content = args['content'] as string;

    const resolvedPath = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      true // createMode: allow new files
    );

    // Check content size before appending
    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);

    // Check total size after append (current + new content)
    try {
      const stats = await fs.stat(resolvedPath);
      checkFileSize(stats.size + contentSize, max, resolvedPath);
    } catch (error) {
      // File doesn't exist yet - just check new content size
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          checkFileSize(contentSize, max, resolvedPath);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    await fs.appendFile(resolvedPath, content, encoding);

    // Return bytes written as string
    return String(contentSize);
  };

  /**
   * List directory contents.
   * IR-4, returns list of dicts with name, type, size.
   */
  const list = async (
    args: Record<string, RillValue>
  ): Promise<RillValue[]> => {
    await ensureInitialized();

    const { mountName, relativePath: dirPath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    const resolvedPath = await resolvePath(mountName, dirPath, mounts, 'read');

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    const result: RillValue[] = [];
    for (const entry of entries) {
      const fullPath = path.join(resolvedPath, entry.name);
      const stats = await fs.stat(fullPath);

      result.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
      });
    }

    return result;
  };

  /**
   * Recursive file search with optional glob pattern.
   * IR-5
   */
  const find = async (
    args: Record<string, RillValue>
  ): Promise<RillValue[]> => {
    await ensureInitialized();

    const { mountName, relativePath: searchBase } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const pattern = (args['pattern'] as string | undefined) ?? '*';

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      throw new RuntimeError(
        'RILL-R004',
        `mount "${mountName}" not configured`,
        undefined,
        { mountName }
      );
    }

    let basePath: string;
    if (searchBase) {
      // Validate searchBase through sandbox resolver to prevent path traversal
      basePath = await resolvePath(mountName, searchBase, mounts, 'read');
    } else {
      basePath = mount.resolvedPath;
    }
    const results: string[] = [];

    // Recursive directory traversal
    const traverse = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (matchesGlob(entry.name, pattern)) {
          // Return path relative to mount base
          const relativePath = path.relative(mount.resolvedPath!, fullPath);
          results.push(relativePath);
        }
      }
    };

    await traverse(basePath);
    return results;
  };

  /**
   * Check file existence.
   * IR-6
   */
  const exists = async (args: Record<string, RillValue>): Promise<boolean> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    try {
      await resolvePath(mountName, filePath, mounts, 'read');
      return true;
    } catch (error) {
      if (error instanceof RuntimeError) {
        // File not found or path escape - return false
        return false;
      }
      throw error;
    }
  };

  /**
   * Delete file.
   * IR-7
   */
  const remove = async (args: Record<string, RillValue>): Promise<boolean> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    // Catch file not found from resolvePath
    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'write');
    } catch (error) {
      if (error instanceof RuntimeError) {
        // File not found - return false
        return false;
      }
      throw error;
    }

    try {
      await fs.rm(resolvedPath);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          return false;
        }
      }
      throw error;
    }
  };

  /**
   * Get file metadata.
   * IR-8, returns dict with name, type, size, created, modified (ISO 8601).
   */
  const stat = async (
    args: Record<string, RillValue>
  ): Promise<Record<string, RillValue>> => {
    await ensureInitialized();

    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    // Catch file not found from resolvePath
    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'read');
    } catch (error) {
      if (error instanceof RuntimeError) {
        // Convert RILL-R021 to RILL-R004
        throw new RuntimeError(
          'RILL-R004',
          `file not found: ${filePath}`,
          undefined,
          { path: filePath }
        );
      }
      throw error;
    }

    const stats = await fs.stat(resolvedPath);
    const filename = path.basename(resolvedPath);

    return {
      name: filename,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
    };
  };

  /**
   * Create directory.
   * IR-9
   */
  const mkdir = async (args: Record<string, RillValue>): Promise<boolean> => {
    await ensureInitialized();

    const { mountName, relativePath: dirPath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      throw new RuntimeError(
        'RILL-R004',
        `mount "${mountName}" not configured`,
        undefined,
        { mountName }
      );
    }

    // For mkdir, build path manually to avoid parent directory checks
    const mountBase = mount.resolvedPath;
    const joined = path.join(mountBase, dirPath);
    const normalized = path.resolve(joined);

    // Verify path is within mount boundary
    if (
      !normalized.startsWith(mountBase + path.sep) &&
      normalized !== mountBase
    ) {
      throw new RuntimeError(
        'RILL-R004',
        'path escapes mount boundary',
        undefined,
        { mountName, path: dirPath, normalized, mountBase }
      );
    }

    // Check if already exists
    try {
      const stats = await fs.stat(normalized);
      if (stats.isDirectory()) {
        return false; // Already exists
      }
    } catch (error) {
      // ENOENT is expected - directory doesn't exist yet
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    try {
      await fs.mkdir(normalized, { recursive: true });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'EEXIST') {
          return false;
        }
      }
      throw error;
    }
  };

  /**
   * Copy file within mount.
   * IR-10
   */
  const copy = async (args: Record<string, RillValue>): Promise<boolean> => {
    await ensureInitialized();

    const { mountName: srcMountName, relativePath: srcPath } = parseMountPath(
      args['src'] as string,
      mounts
    );
    const { mountName: destMountName, relativePath: destPath } = parseMountPath(
      args['dest'] as string,
      mounts
    );
    const mountName = srcMountName;

    // Verify same mount
    if (srcMountName !== destMountName) {
      throw new RuntimeError(
        'RILL-R004',
        `copy requires same mount for src and dest`,
        undefined,
        { src: args['src'], dest: args['dest'] }
      );
    }

    const resolvedSrc = await resolvePath(mountName, srcPath, mounts, 'read');
    const resolvedDest = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      true // createMode
    );

    // Check file size before copying
    const stats = await fs.stat(resolvedSrc);
    const max = getMaxFileSize(mountName);
    checkFileSize(stats.size, max, resolvedDest);

    try {
      await fs.copyFile(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          throw new RuntimeError(
            'RILL-R004',
            `file not found: ${srcPath}`,
            undefined,
            { path: resolvedSrc }
          );
        }
      }
      throw error;
    }
  };

  /**
   * Move file within mount.
   * IR-11
   */
  const move = async (args: Record<string, RillValue>): Promise<boolean> => {
    await ensureInitialized();

    const { mountName: srcMountName, relativePath: srcPath } = parseMountPath(
      args['src'] as string,
      mounts
    );
    const { mountName: destMountName, relativePath: destPath } = parseMountPath(
      args['dest'] as string,
      mounts
    );
    const mountName = srcMountName;

    // Verify same mount
    if (srcMountName !== destMountName) {
      throw new RuntimeError(
        'RILL-R004',
        `move requires same mount for src and dest`,
        undefined,
        { src: args['src'], dest: args['dest'] }
      );
    }

    const resolvedSrc = await resolvePath(mountName, srcPath, mounts, 'read');
    const resolvedDest = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      true // createMode
    );

    try {
      await fs.rename(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          throw new RuntimeError(
            'RILL-R004',
            `file not found: ${srcPath}`,
            undefined,
            { path: resolvedSrc }
          );
        }
      }
      throw error;
    }
  };

  /**
   * List configured mounts.
   * IR-12, returns list of dicts with name, mode, glob.
   */
  const mountsList = async (): Promise<RillValue[]> => {
    await ensureInitialized();

    const result: RillValue[] = [];

    for (const [name, mount] of Object.entries(mounts)) {
      result.push({
        name,
        mode: mount.mode,
        glob: mount.glob ?? '',
      });
    }

    return result;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  return {
    value: {
      read: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
        ],
        fn: read,
        annotations: { description: 'Read file contents' },
        returnType: structureToTypeValue({ kind: 'string' }),
      }),
      write: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
          {
            name: 'content',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Content to write' },
          },
        ],
        fn: write,
        annotations: { description: 'Write file, replacing if exists' },
        returnType: structureToTypeValue({ kind: 'string' }),
      }),
      append: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
          {
            name: 'content',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Content to append' },
          },
        ],
        fn: append,
        annotations: { description: 'Append content to file' },
        returnType: structureToTypeValue({ kind: 'string' }),
      }),
      list: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description:
                'Mount-prefixed directory path (e.g. "/mount/subdir")',
            },
          },
        ],
        fn: list,
        annotations: { description: 'List directory contents' },
        returnType: structureToTypeValue({
          kind: 'list',
          element: {
            kind: 'dict',
            fields: {
              name: { type: { kind: 'string' } },
              type: { type: { kind: 'string' } },
              size: { type: { kind: 'number' } },
            },
          },
        }),
      }),
      find: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description:
                'Mount-prefixed base path (e.g. "/mount" or "/mount/subdir")',
            },
          },
          {
            name: 'pattern',
            type: { kind: 'string' },
            defaultValue: '*',
            annotations: { description: 'Glob pattern for filtering' },
          },
        ],
        fn: find,
        annotations: { description: 'Recursive file search' },
        returnType: structureToTypeValue({
          kind: 'list',
          element: { kind: 'string' },
        }),
      }),
      exists: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
        ],
        fn: exists,
        annotations: { description: 'Check file existence' },
        returnType: structureToTypeValue({ kind: 'bool' }),
      }),
      remove: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
        ],
        fn: remove,
        annotations: { description: 'Delete file' },
        returnType: structureToTypeValue({ kind: 'bool' }),
      }),
      stat: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
            },
          },
        ],
        fn: stat,
        annotations: { description: 'Get file metadata' },
        returnType: structureToTypeValue({
          kind: 'dict',
          fields: {
            name: { type: { kind: 'string' } },
            type: { type: { kind: 'string' } },
            size: { type: { kind: 'number' } },
            created: { type: { kind: 'string' } },
            modified: { type: { kind: 'string' } },
          },
        }),
      }),
      mkdir: toCallable({
        params: [
          {
            name: 'path',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {
              description:
                'Mount-prefixed directory path (e.g. "/mount/subdir")',
            },
          },
        ],
        fn: mkdir,
        annotations: { description: 'Create directory' },
        returnType: structureToTypeValue({ kind: 'bool' }),
      }),
      copy: toCallable({
        params: [
          {
            name: 'src',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Mount-prefixed source path' },
          },
          {
            name: 'dest',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Mount-prefixed destination path' },
          },
        ],
        fn: copy,
        annotations: { description: 'Copy file within mount' },
        returnType: structureToTypeValue({ kind: 'bool' }),
      }),
      move: toCallable({
        params: [
          {
            name: 'src',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Mount-prefixed source path' },
          },
          {
            name: 'dest',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Mount-prefixed destination path' },
          },
        ],
        fn: move,
        annotations: { description: 'Move file within mount' },
        returnType: structureToTypeValue({ kind: 'bool' }),
      }),
      mounts: toCallable({
        params: [],
        fn: mountsList,
        annotations: { description: 'List configured mounts' },
        returnType: structureToTypeValue({ kind: 'list' }),
      }),
    },
  };
}

// ============================================================
// MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: createFsExtension,
  configSchema,
};
