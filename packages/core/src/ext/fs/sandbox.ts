/**
 * fs Extension Sandbox Module
 *
 * Path resolution and validation implementing 9-step security sequence.
 * Prevents path traversal and symlink attacks via realpath() defense.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from '../../error-classes.js';

// ============================================================
// TYPES
// ============================================================

/** Mount configuration defining sandbox boundaries */
export interface MountConfig {
  /** Absolute or relative path on host filesystem */
  path: string;
  /** Access mode for this mount */
  mode: 'read' | 'write' | 'read-write';
  /** Optional file pattern filter (simple glob) */
  glob?: string | undefined;
  /** Override file size limit per-mount (bytes) */
  maxFileSize?: number | undefined;
  /** Resolved canonical path (set during mount initialization) */
  resolvedPath?: string | undefined;
}

/** Operation type for mode validation */
export type Operation = 'read' | 'write';

// ============================================================
// PATH RESOLUTION
// ============================================================

/**
 * Resolves and validates path within mount boundaries.
 *
 * 9-step path resolution sequence (spec lines 331-342):
 * 1. Resolve mount name to MountConfig
 * 2. Use mount's resolved physical path (from creation time)
 * 3. Join resolved mount base with script's relative path argument
 * 4. Normalize with path.resolve() to collapse .. segments
 * 5. Resolve final path with fs.realpath() (symlink defense)
 * 6. Verify resolved path starts with mount's resolved base (startsWith())
 * 7. If glob set, verify filename matches pattern
 * 8. Check mode permits operation
 * 9. Return validated path for node:fs operation
 *
 * @param mountName - Mount identifier from script
 * @param relativePath - Script-provided path relative to mount
 * @param mounts - Mount configuration map
 * @param operation - Operation type for mode validation
 * @param createMode - For write operations creating new files (checks parent dir)
 * @returns Validated absolute path
 * @throws RuntimeError - EC-1 (unknown mount), EC-2 (path escape), EC-3 (glob), EC-4 (mode), EC-7 (permission)
 */
export async function resolvePath(
  mountName: string,
  relativePath: string,
  mounts: Record<string, MountConfig>,
  operation: Operation,
  createMode = false
): Promise<string> {
  // Step 1: Resolve mount name to MountConfig
  // EC-1: Unknown mount name
  const mount = mounts[mountName];
  if (!mount) {
    throw new RuntimeError(
      'RILL-R017',
      `mount "${mountName}" not configured`,
      undefined,
      { mountName }
    );
  }

  // Step 2: Use mount's resolved physical path (set at creation time)
  const mountBase = mount.resolvedPath;
  if (!mountBase) {
    throw new RuntimeError(
      'RILL-R017',
      `mount "${mountName}" not initialized (missing resolvedPath)`,
      undefined,
      { mountName }
    );
  }

  // Step 3: Join resolved mount base with script's relative path
  const joined = path.join(mountBase, relativePath);

  // Step 4: Normalize with path.resolve() to collapse .. segments
  const normalized = path.resolve(joined);

  // Step 6 (early check): Verify normalized path starts with mount base before realpath
  // This catches path traversal attempts even when the target doesn't exist
  // EC-2: Path escapes boundary
  if (
    !normalized.startsWith(mountBase + path.sep) &&
    normalized !== mountBase
  ) {
    throw new RuntimeError(
      'RILL-R018',
      'path escapes mount boundary',
      undefined,
      { mountName, path: relativePath, normalized, mountBase }
    );
  }

  // Step 5: Resolve final path with fs.realpath() (symlink defense)
  // For write operations creating new files, resolve parent directory instead
  let resolvedPath: string;
  try {
    if (createMode) {
      // New file write: resolve parent directory
      const parentDir = path.dirname(normalized);
      const resolvedParent = await fs.realpath(parentDir);
      const filename = path.basename(normalized);
      resolvedPath = path.join(resolvedParent, filename);
    } else {
      // Existing file: resolve full path
      resolvedPath = await fs.realpath(normalized);
    }
  } catch (error) {
    // EC-7: Permission denied or ENOENT
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'EACCES' || code === 'EPERM') {
        throw new RuntimeError(
          'RILL-R021',
          `permission denied: ${normalized}`,
          undefined,
          { path: normalized, code }
        );
      }
      // For ENOENT on createMode, this is expected (new file)
      // For ENOENT on read mode, propagate as path doesn't exist
      if (code === 'ENOENT') {
        if (createMode) {
          // Parent directory doesn't exist for new file write
          throw new RuntimeError(
            'RILL-R021',
            `parent directory does not exist: ${path.dirname(normalized)}`,
            undefined,
            { path: normalized }
          );
        } else {
          // File doesn't exist for read
          throw new RuntimeError(
            'RILL-R021',
            `file not found: ${normalized}`,
            undefined,
            { path: normalized }
          );
        }
      }
    }
    throw error;
  }

  // Step 6 (post-realpath): Verify resolved path still within mount (symlink defense)
  // EC-2: Path escapes boundary via symlink
  if (
    !resolvedPath.startsWith(mountBase + path.sep) &&
    resolvedPath !== mountBase
  ) {
    throw new RuntimeError(
      'RILL-R018',
      'path escapes mount boundary',
      undefined,
      { mountName, path: relativePath, resolvedPath, mountBase }
    );
  }

  // Step 7: If glob set, verify filename matches pattern
  // EC-3: Glob mismatch
  if (mount.glob) {
    const filename = path.basename(resolvedPath);
    if (!matchesGlob(filename, mount.glob)) {
      throw new RuntimeError(
        'RILL-R019',
        `file type not permitted in mount "${mountName}"`,
        undefined,
        { mountName, glob: mount.glob, filename }
      );
    }
  }

  // Step 8: Check mode permits operation
  // EC-4: Mode violation
  if (!checkMode(mount.mode, operation)) {
    throw new RuntimeError(
      'RILL-R020',
      `mount "${mountName}" does not permit ${operation}`,
      undefined,
      { mountName, mode: mount.mode, operation }
    );
  }

  // Step 9: Return validated path for node:fs operation
  return resolvedPath;
}

// ============================================================
// GLOB MATCHING
// ============================================================

/**
 * Simple glob pattern matching (spec lines 346-354).
 *
 * Supported patterns:
 * - *.csv - Files ending in .csv
 * - *.{json,yaml} - Files ending in .json or .yaml
 * - * - All files (default when omitted)
 * - **\/*.csv - CSV files at any depth (for find() only)
 *
 * No third-party glob library. Uses path.extname() checks.
 *
 * @param filename - Filename to match (basename only)
 * @param pattern - Glob pattern
 * @returns true if filename matches pattern
 */
export function matchesGlob(filename: string, pattern: string): boolean {
  // Pattern: * (all files)
  if (pattern === '*') {
    return true;
  }

  // Pattern: *.ext (single extension)
  if (pattern.startsWith('*.') && !pattern.includes('{')) {
    const ext = pattern.slice(1); // Remove leading *
    return filename.endsWith(ext);
  }

  // Pattern: *.{ext1,ext2} (multiple extensions)
  if (pattern.startsWith('*.{') && pattern.endsWith('}')) {
    const extensionsStr = pattern.slice(3, -1); // Extract between *.{ and }
    const extensions = extensionsStr.split(',').map((e) => `.${e.trim()}`);
    return extensions.some((ext) => filename.endsWith(ext));
  }

  // Pattern: **/*.ext (recursive, any depth)
  if (pattern.startsWith('**/')) {
    const subPattern = pattern.slice(3); // Remove leading **/
    return matchesGlob(filename, subPattern);
  }

  // Unknown pattern: no match (conservative)
  return false;
}

// ============================================================
// MODE VALIDATION
// ============================================================

/**
 * Checks if mount mode permits operation.
 *
 * @param mode - Mount access mode
 * @param operation - Operation type
 * @returns true if operation permitted
 */
export function checkMode(
  mode: 'read' | 'write' | 'read-write',
  operation: Operation
): boolean {
  if (mode === 'read-write') return true;
  if (mode === 'read' && operation === 'read') return true;
  if (mode === 'write' && operation === 'write') return true;
  return false;
}

// ============================================================
// MOUNT INITIALIZATION
// ============================================================

/**
 * Resolves mount path at creation time (Step 2 of sequence).
 *
 * Mutates MountConfig to set resolvedPath field.
 *
 * @param mount - Mount configuration
 * @throws RuntimeError - If mount path invalid or inaccessible
 */
export async function initializeMount(mount: MountConfig): Promise<void> {
  try {
    // Resolve mount path with fs.realpath() at creation time (spec line 333)
    mount.resolvedPath = await fs.realpath(mount.path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R017',
          `mount path does not exist: ${mount.path}`,
          undefined,
          { path: mount.path }
        );
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new RuntimeError(
          'RILL-R021',
          `permission denied: ${mount.path}`,
          undefined,
          { path: mount.path, code }
        );
      }
    }
    throw error;
  }
}
