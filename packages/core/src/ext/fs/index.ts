/**
 * fs Extension Factory
 *
 * Provides sandboxed filesystem operations via mount-based access control.
 * All 12 functions implement path validation, permission checks, and glob filtering.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from '../../error-classes.js';
import type { ExtensionResult } from '../../runtime/ext/extensions.js';
import type { RillValue } from '../../runtime/core/values.js';
import {
  type MountConfig,
  resolvePath,
  matchesGlob,
  initializeMount,
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
 * @returns ExtensionResult with 12 filesystem functions
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
export function createFsExtension(config: FsConfig): ExtensionResult {
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
    args: RillValue[]
    // ctx and location not used but required by CallableFn signature
  ): Promise<string> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;

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
  const write = async (args: RillValue[]): Promise<string> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;
    const content = args[2] as string;

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
  const append = async (args: RillValue[]): Promise<string> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;
    const content = args[2] as string;

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
  const list = async (args: RillValue[]): Promise<RillValue[]> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const dirPath = (args[1] as string | undefined) ?? '';

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
  const find = async (args: RillValue[]): Promise<RillValue[]> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const pattern = (args[1] as string | undefined) ?? '*';

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      throw new RuntimeError(
        'RILL-R004',
        `mount "${mountName}" not configured`,
        undefined,
        { mountName }
      );
    }

    const basePath = mount.resolvedPath;
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
          const relativePath = path.relative(basePath, fullPath);
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
  const exists = async (args: RillValue[]): Promise<boolean> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;

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
  const remove = async (args: RillValue[]): Promise<boolean> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;

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
    args: RillValue[]
  ): Promise<Record<string, RillValue>> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const filePath = args[1] as string;

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
  const mkdir = async (args: RillValue[]): Promise<boolean> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const dirPath = args[1] as string;

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
  const copy = async (args: RillValue[]): Promise<boolean> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const srcPath = args[1] as string;
    const destPath = args[2] as string;

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
  const move = async (args: RillValue[]): Promise<boolean> => {
    await ensureInitialized();

    const mountName = args[0] as string;
    const srcPath = args[1] as string;
    const destPath = args[2] as string;

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
      description: 'Read file contents',
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
      description: 'Write file, replacing if exists',
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
      description: 'Append content to file',
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
      description: 'List directory contents',
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
      description: 'Recursive file search',
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
      description: 'Check file existence',
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
      description: 'Delete file',
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
      description: 'Get file metadata',
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
      description: 'Create directory',
      returnType: 'bool',
    },
    copy: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'src', type: 'string', description: 'Source file path' },
        { name: 'dest', type: 'string', description: 'Destination file path' },
      ],
      fn: copy,
      description: 'Copy file within mount',
      returnType: 'bool',
    },
    move: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'src', type: 'string', description: 'Source file path' },
        { name: 'dest', type: 'string', description: 'Destination file path' },
      ],
      fn: move,
      description: 'Move file within mount',
      returnType: 'bool',
    },
    mounts: {
      params: [],
      fn: mountsList,
      description: 'List configured mounts',
      returnType: 'list',
    },
  };
}
