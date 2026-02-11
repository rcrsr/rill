/**
 * fs Extension Sandbox Tests
 *
 * Tests for path resolution, validation, and security enforcement.
 * Covers all error contracts and acceptance criteria from spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  resolvePath,
  matchesGlob,
  checkMode,
  initializeMount,
  type MountConfig,
} from '../../../src/ext/fs/sandbox.js';
import { RuntimeError } from '../../../src/error-classes.js';

// ============================================================
// TEST FIXTURES
// ============================================================

let tempDir: string;
let mounts: Record<string, MountConfig>;

beforeEach(async () => {
  // Create temporary directory for test files
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-sandbox-test-'));

  // Create test directory structure
  await fs.mkdir(path.join(tempDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'readonly'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'writeonly'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'csv_only'), { recursive: true });

  // Create test files
  await fs.writeFile(path.join(tempDir, 'data', 'test.txt'), 'content');
  await fs.writeFile(path.join(tempDir, 'data', 'test.csv'), 'csv,data');
  await fs.writeFile(path.join(tempDir, 'readonly', 'file.txt'), 'readonly');
  await fs.writeFile(path.join(tempDir, 'csv_only', 'data.csv'), 'csv');
  await fs.writeFile(path.join(tempDir, 'csv_only', 'data.json'), '{}');

  // Create subdirectory
  await fs.mkdir(path.join(tempDir, 'data', 'subdir'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'data', 'subdir', 'nested.txt'),
    'nested'
  );

  // Initialize mounts
  mounts = {
    data: {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
      resolvedPath: await fs.realpath(path.join(tempDir, 'data')),
    },
    readonly: {
      path: path.join(tempDir, 'readonly'),
      mode: 'read',
      resolvedPath: await fs.realpath(path.join(tempDir, 'readonly')),
    },
    writeonly: {
      path: path.join(tempDir, 'writeonly'),
      mode: 'write',
      resolvedPath: await fs.realpath(path.join(tempDir, 'writeonly')),
    },
    csv_only: {
      path: path.join(tempDir, 'csv_only'),
      mode: 'read-write',
      glob: '*.csv',
      resolvedPath: await fs.realpath(path.join(tempDir, 'csv_only')),
    },
    json_yaml: {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
      glob: '*.{json,yaml}',
      resolvedPath: await fs.realpath(path.join(tempDir, 'data')),
    },
  };
});

afterEach(async () => {
  // Clean up temporary directory
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ============================================================
// IC-2: PATH RESOLUTION SEQUENCE
// ============================================================

describe('resolvePath - 9-step path resolution sequence', () => {
  it('resolves simple path within mount', async () => {
    const resolved = await resolvePath('data', 'test.txt', mounts, 'read');
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('resolves nested path with subdirectories', async () => {
    const resolved = await resolvePath(
      'data',
      'subdir/nested.txt',
      mounts,
      'read'
    );
    expect(resolved).toBe(path.join(tempDir, 'data', 'subdir', 'nested.txt'));
  });

  it('collapses .. segments with path.resolve()', async () => {
    const resolved = await resolvePath(
      'data',
      'subdir/../test.txt',
      mounts,
      'read'
    );
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('resolves path for write operation (existing file)', async () => {
    const resolved = await resolvePath('data', 'test.txt', mounts, 'write');
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('handles createMode for new file write', async () => {
    const resolved = await resolvePath(
      'data',
      'newfile.txt',
      mounts,
      'write',
      true
    );
    expect(resolved).toBe(path.join(tempDir, 'data', 'newfile.txt'));
  });
});

// ============================================================
// EC-1: UNKNOWN MOUNT NAME
// ============================================================

describe('resolvePath - EC-1: unknown mount name', () => {
  it('throws RuntimeError for unknown mount', async () => {
    await expect(
      resolvePath('unknown', 'file.txt', mounts, 'read')
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('unknown', 'file.txt', mounts, 'read')
    ).rejects.toThrow('mount "unknown" not configured');
  });

  it('throws RILL-R017 error code', async () => {
    try {
      await resolvePath('unknown', 'file.txt', mounts, 'read');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R017');
    }
  });
});

// ============================================================
// EC-2: PATH ESCAPES BOUNDARY
// ============================================================

describe('resolvePath - EC-2: path escapes mount boundary', () => {
  it('throws RuntimeError for path traversal with ..', async () => {
    await expect(
      resolvePath('data', '../../etc/passwd', mounts, 'read')
    ).rejects.toThrow(RuntimeError);
  });

  it('throws RILL-R018 error code', async () => {
    try {
      await resolvePath('data', '../../outside.txt', mounts, 'read');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R018');
    }
  });

  it('throws error message "path escapes mount boundary"', async () => {
    await expect(
      resolvePath('data', '../../../outside.txt', mounts, 'read')
    ).rejects.toThrow('path escapes mount boundary');
  });
});

// ============================================================
// EC-3: GLOB MISMATCH
// ============================================================

describe('resolvePath - EC-3: glob mismatch', () => {
  it('allows matching file extension', async () => {
    const resolved = await resolvePath('csv_only', 'data.csv', mounts, 'read');
    expect(resolved).toBe(path.join(tempDir, 'csv_only', 'data.csv'));
  });

  it('throws RuntimeError for non-matching extension', async () => {
    await expect(
      resolvePath('csv_only', 'data.json', mounts, 'read')
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('csv_only', 'data.json', mounts, 'read')
    ).rejects.toThrow('file type not permitted in mount "csv_only"');
  });

  it('throws RILL-R019 error code', async () => {
    try {
      await resolvePath('csv_only', 'data.json', mounts, 'read');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R019');
    }
  });
});

// ============================================================
// EC-4: MODE VIOLATION
// ============================================================

describe('resolvePath - EC-4: mode violation', () => {
  it('allows read on read-only mount', async () => {
    const resolved = await resolvePath('readonly', 'file.txt', mounts, 'read');
    expect(resolved).toBe(path.join(tempDir, 'readonly', 'file.txt'));
  });

  it('throws RuntimeError for write to read-only mount', async () => {
    await expect(
      resolvePath('readonly', 'file.txt', mounts, 'write')
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('readonly', 'file.txt', mounts, 'write')
    ).rejects.toThrow('mount "readonly" does not permit write');
  });

  it('throws RuntimeError for read from write-only mount', async () => {
    await fs.writeFile(path.join(tempDir, 'writeonly', 'file.txt'), 'data');

    await expect(
      resolvePath('writeonly', 'file.txt', mounts, 'read')
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('writeonly', 'file.txt', mounts, 'read')
    ).rejects.toThrow('mount "writeonly" does not permit read');
  });

  it('throws RILL-R020 error code', async () => {
    try {
      await resolvePath('readonly', 'file.txt', mounts, 'write');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R020');
    }
  });

  it('allows both read and write on read-write mount', async () => {
    const readResolved = await resolvePath('data', 'test.txt', mounts, 'read');
    expect(readResolved).toBe(path.join(tempDir, 'data', 'test.txt'));

    const writeResolved = await resolvePath(
      'data',
      'test.txt',
      mounts,
      'write'
    );
    expect(writeResolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });
});

// ============================================================
// EC-7: PERMISSION DENIED
// ============================================================

describe('resolvePath - EC-7: permission denied', () => {
  it('throws RuntimeError for non-existent file in read mode', async () => {
    await expect(
      resolvePath('data', 'nonexistent.txt', mounts, 'read')
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('data', 'nonexistent.txt', mounts, 'read')
    ).rejects.toThrow('file not found');
  });

  it('throws RILL-R021 error code', async () => {
    try {
      await resolvePath('data', 'nonexistent.txt', mounts, 'read');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R021');
    }
  });

  it('throws RuntimeError for missing parent directory in createMode', async () => {
    await expect(
      resolvePath('data', 'missing_dir/newfile.txt', mounts, 'write', true)
    ).rejects.toThrow(RuntimeError);

    await expect(
      resolvePath('data', 'missing_dir/newfile.txt', mounts, 'write', true)
    ).rejects.toThrow('parent directory does not exist');
  });
});

// ============================================================
// AC-3: SYMLINK DEFENSE
// ============================================================

describe('resolvePath - AC-3: symlink cannot escape sandbox', () => {
  it('detects symlink pointing outside mount', async () => {
    // Create symlink pointing outside mount
    const symlinkPath = path.join(tempDir, 'data', 'escape_link');
    const outsidePath = path.join(tempDir, 'outside.txt');
    await fs.writeFile(outsidePath, 'escape');
    await fs.symlink(outsidePath, symlinkPath);

    // Should throw because realpath() resolves to outside mount
    await expect(
      resolvePath('data', 'escape_link', mounts, 'read')
    ).rejects.toThrow('path escapes mount boundary');
  });

  it('allows symlink pointing inside mount', async () => {
    // Create symlink pointing inside mount
    const symlinkPath = path.join(tempDir, 'data', 'internal_link');
    const targetPath = path.join(tempDir, 'data', 'test.txt');
    await fs.symlink(targetPath, symlinkPath);

    // Should succeed because realpath() stays within mount
    const resolved = await resolvePath('data', 'internal_link', mounts, 'read');
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });
});

// ============================================================
// GLOB MATCHING
// ============================================================

describe('matchesGlob - glob pattern matching', () => {
  it('matches * (all files)', () => {
    expect(matchesGlob('any.txt', '*')).toBe(true);
    expect(matchesGlob('file.csv', '*')).toBe(true);
    expect(matchesGlob('no_extension', '*')).toBe(true);
  });

  it('matches *.ext (single extension)', () => {
    expect(matchesGlob('data.csv', '*.csv')).toBe(true);
    expect(matchesGlob('file.txt', '*.txt')).toBe(true);
    expect(matchesGlob('data.json', '*.csv')).toBe(false);
  });

  it('matches *.{ext1,ext2} (multiple extensions)', () => {
    expect(matchesGlob('config.json', '*.{json,yaml}')).toBe(true);
    expect(matchesGlob('config.yaml', '*.{json,yaml}')).toBe(true);
    expect(matchesGlob('config.yml', '*.{json,yaml}')).toBe(false);
    expect(matchesGlob('config.txt', '*.{json,yaml}')).toBe(false);
  });

  it('matches **/*.ext (recursive, any depth)', () => {
    expect(matchesGlob('data.csv', '**/*.csv')).toBe(true);
    expect(matchesGlob('nested.csv', '**/*.csv')).toBe(true);
    expect(matchesGlob('data.json', '**/*.csv')).toBe(false);
  });

  it('returns false for unknown pattern', () => {
    expect(matchesGlob('file.txt', 'complex[pattern]')).toBe(false);
    expect(matchesGlob('file.txt', '??.txt')).toBe(false);
  });
});

// ============================================================
// MODE VALIDATION
// ============================================================

describe('checkMode - mode validation', () => {
  it('allows read on read mode', () => {
    expect(checkMode('read', 'read')).toBe(true);
  });

  it('denies write on read mode', () => {
    expect(checkMode('read', 'write')).toBe(false);
  });

  it('allows write on write mode', () => {
    expect(checkMode('write', 'write')).toBe(true);
  });

  it('denies read on write mode', () => {
    expect(checkMode('write', 'read')).toBe(false);
  });

  it('allows both operations on read-write mode', () => {
    expect(checkMode('read-write', 'read')).toBe(true);
    expect(checkMode('read-write', 'write')).toBe(true);
  });
});

// ============================================================
// MOUNT INITIALIZATION
// ============================================================

describe('initializeMount - mount initialization', () => {
  it('resolves mount path with fs.realpath()', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
    };

    await initializeMount(mount);

    expect(mount.resolvedPath).toBeDefined();
    expect(mount.resolvedPath).toBe(await fs.realpath(mount.path));
  });

  it('throws RuntimeError for non-existent mount path', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'nonexistent'),
      mode: 'read-write',
    };

    await expect(initializeMount(mount)).rejects.toThrow(RuntimeError);
    await expect(initializeMount(mount)).rejects.toThrow(
      'mount path does not exist'
    );
  });

  it('throws RILL-R017 error code for non-existent path', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'nonexistent'),
      mode: 'read-write',
    };

    try {
      await initializeMount(mount);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R017');
    }
  });
});
