/**
 * fs Extension Tests
 *
 * Tests all 12 filesystem functions with mount-based sandboxing.
 * Covers IR-1 through IR-12, EC-5, EC-6, AC-9, AC-10.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createFsExtension,
  type FsConfig,
  type MountConfig,
} from '../../src/ext/fs/index.js';
import { RuntimeError } from '../../src/error-classes.js';

describe('fs extension', () => {
  let tempDir: string;
  let testMount: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-fs-test-'));
    testMount = path.join(tempDir, 'workspace');
    await fs.mkdir(testMount, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('factory and configuration', () => {
    it('creates extension with default config', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      expect(fsExt.read).toBeDefined();
      expect(fsExt.write).toBeDefined();
      expect(fsExt.mounts).toBeDefined();
    });

    it('applies default maxFileSize (10MB)', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      // Write content just under 10MB (should succeed)
      const content = 'x'.repeat(10485760 - 100);
      await fsExt.write.fn(['workspace', 'large.txt', content], {} as any);
      expect(true).toBe(true); // No error thrown
    });

    it('applies custom maxFileSize', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 1000, // 1KB
      });

      // EC-6: File exceeds size limit
      const content = 'x'.repeat(1001);
      await expect(
        fsExt.write.fn(['workspace', 'too-large.txt', content], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('applies custom encoding', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        encoding: 'ascii',
      });

      await fsExt.write.fn(['workspace', 'ascii.txt', 'hello'], {} as any);
      const result = await fsExt.read.fn(['workspace', 'ascii.txt'], {} as any);
      expect(result).toBe('hello');
    });

    // AC-9: Type exports
    it('exports FsConfig and MountConfig types', () => {
      const config: FsConfig = {
        mounts: {
          test: { path: '/tmp', mode: 'read' },
        },
      };

      const mountConfig: MountConfig = {
        path: '/tmp',
        mode: 'read-write',
        glob: '*.txt',
        maxFileSize: 1000,
      };

      expect(config).toBeDefined();
      expect(mountConfig).toBeDefined();
    });
  });

  describe('read function (IR-1)', () => {
    it('reads file contents', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const filePath = path.join(testMount, 'test.txt');
      await fs.writeFile(filePath, 'hello world', 'utf-8');

      const result = await fsExt.read.fn(['workspace', 'test.txt'], {} as any);
      expect(result).toBe('hello world');
    });

    it('reads UTF-8 content with special characters', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const filePath = path.join(testMount, 'unicode.txt');
      const content = 'Hello 世界 🌍';
      await fs.writeFile(filePath, content, 'utf-8');

      const result = await fsExt.read.fn(
        ['workspace', 'unicode.txt'],
        {} as any
      );
      expect(result).toBe(content);
    });

    // EC-5: File not found
    it('throws RuntimeError when file not found', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await expect(
        fsExt.read.fn(['workspace', 'nonexistent.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);

      try {
        await fsExt.read.fn(['workspace', 'nonexistent.txt'], {} as any);
      } catch (error) {
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toContain('file not found');
      }
    });

    // EC-6: File exceeds size limit
    it('throws RuntimeError when file exceeds size limit', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 100,
      });

      const filePath = path.join(testMount, 'large.txt');
      await fs.writeFile(filePath, 'x'.repeat(200), 'utf-8');

      await expect(
        fsExt.read.fn(['workspace', 'large.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);

      try {
        await fsExt.read.fn(['workspace', 'large.txt'], {} as any);
      } catch (error) {
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toContain('exceeds size limit');
      }
    });

    it('respects per-mount maxFileSize override', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: {
            path: testMount,
            mode: 'read-write',
            maxFileSize: 50, // Override: 50 bytes
          },
        },
        maxFileSize: 1000, // Global: 1000 bytes
      });

      const filePath = path.join(testMount, 'test.txt');
      await fs.writeFile(filePath, 'x'.repeat(60), 'utf-8');

      // Should fail with per-mount limit (50 bytes)
      await expect(
        fsExt.read.fn(['workspace', 'test.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.read.params).toEqual([
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
      ]);
      expect(fsExt.read.returnType).toBe('string');
      expect(fsExt.read.description).toBe('Read file contents');
    });
  });

  describe('write function (IR-2)', () => {
    it('writes file contents', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const bytesWritten = await fsExt.write.fn(
        ['workspace', 'output.txt', 'test content'],
        {} as any
      );

      expect(bytesWritten).toBe('12'); // "test content" is 12 bytes

      const filePath = path.join(testMount, 'output.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('test content');
    });

    it('replaces existing file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const filePath = path.join(testMount, 'replace.txt');
      await fs.writeFile(filePath, 'old content', 'utf-8');

      await fsExt.write.fn(
        ['workspace', 'replace.txt', 'new content'],
        {} as any
      );

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates new file if not exists', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await fsExt.write.fn(['workspace', 'new.txt', 'hello'], {} as any);

      const filePath = path.join(testMount, 'new.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello');
    });

    it('returns bytes written as string', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await fsExt.write.fn(
        ['workspace', 'bytes.txt', 'Hello 世界'],
        {} as any
      );

      // "Hello 世界" is 12 bytes in UTF-8 (5 ASCII + 1 space + 6 for 世界)
      expect(result).toBe('12');
    });

    it('throws RuntimeError when content exceeds size limit', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 50,
      });

      await expect(
        fsExt.write.fn(['workspace', 'large.txt', 'x'.repeat(100)], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'write' },
        },
      });

      expect(fsExt.write.params).toEqual([
        { name: 'mount', type: 'string', description: 'Mount name' },
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to mount',
        },
        { name: 'content', type: 'string', description: 'Content to write' },
      ]);
      expect(fsExt.write.returnType).toBe('string');
    });
  });

  describe('append function (IR-3)', () => {
    it('appends content to existing file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const filePath = path.join(testMount, 'append.txt');
      await fs.writeFile(filePath, 'line1\n', 'utf-8');

      await fsExt.append.fn(['workspace', 'append.txt', 'line2\n'], {} as any);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nline2\n');
    });

    it('creates new file if not exists', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await fsExt.append.fn(['workspace', 'new.txt', 'content'], {} as any);

      const filePath = path.join(testMount, 'new.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('content');
    });

    it('returns bytes appended as string', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await fsExt.append.fn(
        ['workspace', 'log.txt', 'new entry'],
        {} as any
      );

      expect(result).toBe('9'); // "new entry" is 9 bytes
    });

    it('throws RuntimeError when total size exceeds limit', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 100,
      });

      const filePath = path.join(testMount, 'growing.txt');
      await fs.writeFile(filePath, 'x'.repeat(80), 'utf-8');

      // Appending 30 more bytes would exceed 100 byte limit
      await expect(
        fsExt.append.fn(['workspace', 'growing.txt', 'x'.repeat(30)], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'write' },
        },
      });

      expect(fsExt.append.params).toHaveLength(3);
      expect(fsExt.append.returnType).toBe('string');
    });
  });

  describe('list function (IR-4)', () => {
    it('lists directory contents with correct shape', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      // Create test files and directories
      await fs.writeFile(path.join(testMount, 'file1.txt'), 'content', 'utf-8');
      await fs.writeFile(path.join(testMount, 'file2.txt'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'subdir'));

      const result = await fsExt.list.fn(['workspace'], {} as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);

      // Verify shape: { name, type, size }
      const file1 = result.find((item: any) => item.name === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1).toMatchObject({
        name: 'file1.txt',
        type: 'file',
        size: expect.any(Number),
      });

      const subdir = result.find((item: any) => item.name === 'subdir');
      expect(subdir).toBeDefined();
      expect(subdir).toMatchObject({
        name: 'subdir',
        type: 'directory',
        size: expect.any(Number),
      });
    });

    it('lists subdirectory contents', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.mkdir(path.join(testMount, 'subdir'));
      await fs.writeFile(
        path.join(testMount, 'subdir', 'nested.txt'),
        'data',
        'utf-8'
      );

      const result = await fsExt.list.fn(['workspace', 'subdir'], {} as any);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'nested.txt',
        type: 'file',
      });
    });

    it('uses empty string as default path', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.writeFile(path.join(testMount, 'root.txt'), 'data', 'utf-8');

      const result = await fsExt.list.fn(['workspace'], {} as any);

      expect(result.length).toBeGreaterThan(0);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.list.params).toHaveLength(2);
      expect(fsExt.list.params[1]?.defaultValue).toBe('');
      expect(fsExt.list.returnType).toBe('list');
    });
  });

  describe('find function (IR-5)', () => {
    it('recursively finds all files with default pattern', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.writeFile(path.join(testMount, 'root.txt'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'dir1'));
      await fs.writeFile(
        path.join(testMount, 'dir1', 'nested.txt'),
        'data',
        'utf-8'
      );
      await fs.mkdir(path.join(testMount, 'dir1', 'dir2'));
      await fs.writeFile(
        path.join(testMount, 'dir1', 'dir2', 'deep.txt'),
        'data',
        'utf-8'
      );

      const result = await fsExt.find.fn(['workspace'], {} as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('root.txt');
      expect(result).toContain(path.join('dir1', 'nested.txt'));
      expect(result).toContain(path.join('dir1', 'dir2', 'deep.txt'));
    });

    it('filters files by glob pattern', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.writeFile(path.join(testMount, 'doc.txt'), 'data', 'utf-8');
      await fs.writeFile(path.join(testMount, 'data.json'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'subdir'));
      await fs.writeFile(
        path.join(testMount, 'subdir', 'nested.txt'),
        'data',
        'utf-8'
      );

      const result = await fsExt.find.fn(['workspace', '*.txt'], {} as any);

      expect(result).toContain('doc.txt');
      expect(result).toContain(path.join('subdir', 'nested.txt'));
      expect(result).not.toContain('data.json');
    });

    it('returns relative paths from mount base', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.mkdir(path.join(testMount, 'a', 'b'), { recursive: true });
      await fs.writeFile(
        path.join(testMount, 'a', 'b', 'file.txt'),
        'data',
        'utf-8'
      );

      const result = await fsExt.find.fn(['workspace'], {} as any);

      // Should be relative path, not absolute
      expect(result[0]).toBe(path.join('a', 'b', 'file.txt'));
      expect(result[0]).not.toContain(testMount);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.find.params).toHaveLength(2);
      expect(fsExt.find.params[1]?.defaultValue).toBe('*');
      expect(fsExt.find.returnType).toBe('list');
    });
  });

  describe('exists function (IR-6)', () => {
    it('returns true for existing file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.writeFile(path.join(testMount, 'exists.txt'), 'data', 'utf-8');

      const result = await fsExt.exists.fn(
        ['workspace', 'exists.txt'],
        {} as any
      );

      expect(result).toBe(true);
    });

    it('returns false for nonexistent file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      const result = await fsExt.exists.fn(
        ['workspace', 'nonexistent.txt'],
        {} as any
      );

      expect(result).toBe(false);
    });

    it('returns true for existing directory', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.mkdir(path.join(testMount, 'mydir'));

      const result = await fsExt.exists.fn(['workspace', 'mydir'], {} as any);

      expect(result).toBe(true);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.exists.params).toHaveLength(2);
      expect(fsExt.exists.returnType).toBe('bool');
    });
  });

  describe('remove function (IR-7)', () => {
    it('deletes existing file and returns true', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const filePath = path.join(testMount, 'delete.txt');
      await fs.writeFile(filePath, 'data', 'utf-8');

      const result = await fsExt.remove.fn(
        ['workspace', 'delete.txt'],
        {} as any
      );

      expect(result).toBe(true);

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('returns false for nonexistent file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await fsExt.remove.fn(
        ['workspace', 'nonexistent.txt'],
        {} as any
      );

      expect(result).toBe(false);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'write' },
        },
      });

      expect(fsExt.remove.params).toHaveLength(2);
      expect(fsExt.remove.returnType).toBe('bool');
    });
  });

  describe('stat function (IR-8)', () => {
    it('returns file metadata with correct shape', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      const filePath = path.join(testMount, 'meta.txt');
      const content = 'test data';
      await fs.writeFile(filePath, content, 'utf-8');

      const result = await fsExt.stat.fn(['workspace', 'meta.txt'], {} as any);

      expect(result).toMatchObject({
        name: 'meta.txt',
        type: 'file',
        size: Buffer.byteLength(content, 'utf-8'),
        created: expect.any(String),
        modified: expect.any(String),
      });

      // Verify ISO 8601 format
      expect(result.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns directory metadata', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await fs.mkdir(path.join(testMount, 'mydir'));

      const result = await fsExt.stat.fn(['workspace', 'mydir'], {} as any);

      expect(result).toMatchObject({
        name: 'mydir',
        type: 'directory',
        size: expect.any(Number),
        created: expect.any(String),
        modified: expect.any(String),
      });
    });

    it('throws RuntimeError for nonexistent file', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      await expect(
        fsExt.stat.fn(['workspace', 'missing.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);

      try {
        await fsExt.stat.fn(['workspace', 'missing.txt'], {} as any);
      } catch (error) {
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toContain('file not found');
      }
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.stat.params).toHaveLength(2);
      expect(fsExt.stat.returnType).toBe('dict');
    });
  });

  describe('mkdir function (IR-9)', () => {
    it('creates directory and returns true', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await fsExt.mkdir.fn(['workspace', 'newdir'], {} as any);

      expect(result).toBe(true);

      const dirPath = path.join(testMount, 'newdir');
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('creates nested directories recursively', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await fsExt.mkdir.fn(
        ['workspace', path.join('a', 'b', 'c')],
        {} as any
      );

      expect(result).toBe(true);

      const dirPath = path.join(testMount, 'a', 'b', 'c');
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('returns false if directory already exists', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await fs.mkdir(path.join(testMount, 'existing'));

      const result = await fsExt.mkdir.fn(['workspace', 'existing'], {} as any);

      expect(result).toBe(false);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'write' },
        },
      });

      expect(fsExt.mkdir.params).toHaveLength(2);
      expect(fsExt.mkdir.returnType).toBe('bool');
    });
  });

  describe('copy function (IR-10)', () => {
    it('copies file within mount and returns true', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const srcPath = path.join(testMount, 'source.txt');
      await fs.writeFile(srcPath, 'copy this', 'utf-8');

      const result = await fsExt.copy.fn(
        ['workspace', 'source.txt', 'dest.txt'],
        {} as any
      );

      expect(result).toBe(true);

      const destPath = path.join(testMount, 'dest.txt');
      const content = await fs.readFile(destPath, 'utf-8');
      expect(content).toBe('copy this');

      // Source should still exist
      const srcContent = await fs.readFile(srcPath, 'utf-8');
      expect(srcContent).toBe('copy this');
    });

    it('throws RuntimeError for nonexistent source', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await expect(
        fsExt.copy.fn(['workspace', 'missing.txt', 'dest.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('throws RuntimeError when copying exceeds size limit', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 50,
      });

      const srcPath = path.join(testMount, 'large.txt');
      await fs.writeFile(srcPath, 'x'.repeat(100), 'utf-8');

      await expect(
        fsExt.copy.fn(['workspace', 'large.txt', 'copy.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      expect(fsExt.copy.params).toHaveLength(3);
      expect(fsExt.copy.returnType).toBe('bool');
    });
  });

  describe('move function (IR-11)', () => {
    it('moves file within mount and returns true', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const srcPath = path.join(testMount, 'source.txt');
      await fs.writeFile(srcPath, 'move this', 'utf-8');

      const result = await fsExt.move.fn(
        ['workspace', 'source.txt', 'moved.txt'],
        {} as any
      );

      expect(result).toBe(true);

      const destPath = path.join(testMount, 'moved.txt');
      const content = await fs.readFile(destPath, 'utf-8');
      expect(content).toBe('move this');

      // Source should not exist
      await expect(fs.access(srcPath)).rejects.toThrow();
    });

    it('throws RuntimeError for nonexistent source', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      await expect(
        fsExt.move.fn(['workspace', 'missing.txt', 'dest.txt'], {} as any)
      ).rejects.toThrow(RuntimeError);
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      expect(fsExt.move.params).toHaveLength(3);
      expect(fsExt.move.returnType).toBe('bool');
    });
  });

  describe('mounts function (IR-12)', () => {
    it('lists configured mounts with correct shape', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
          readonly: { path: testMount, mode: 'read', glob: '*.txt' },
        },
      });

      const result = await fsExt.mounts.fn([], {} as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);

      // Verify shape: { name, mode, glob }
      const workspace = result.find((m: any) => m.name === 'workspace');
      expect(workspace).toMatchObject({
        name: 'workspace',
        mode: 'read-write',
        glob: '',
      });

      const readonly = result.find((m: any) => m.name === 'readonly');
      expect(readonly).toMatchObject({
        name: 'readonly',
        mode: 'read',
        glob: '*.txt',
      });
    });

    it('returns empty glob as empty string when not set', async () => {
      const fsExt = createFsExtension({
        mounts: {
          test: { path: testMount, mode: 'read' },
        },
      });

      const result = await fsExt.mounts.fn([], {} as any);

      expect(result[0]).toMatchObject({
        name: 'test',
        mode: 'read',
        glob: '',
      });
    });

    it('validates function signature', () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      expect(fsExt.mounts.params).toHaveLength(0);
      expect(fsExt.mounts.returnType).toBe('list');
    });
  });

  // AC-10: Error messages include context
  describe('error context (AC-10)', () => {
    it('includes path in error context', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read' },
        },
      });

      try {
        await fsExt.read.fn(['workspace', 'missing.txt'], {} as any);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).context).toBeDefined();
        expect((error as RuntimeError).context?.path).toBeDefined();
      }
    });

    it('includes size and max in size limit error context', async () => {
      const fsExt = createFsExtension({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
        maxFileSize: 50,
      });

      try {
        await fsExt.write.fn(
          ['workspace', 'large.txt', 'x'.repeat(100)],
          {} as any
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).context).toBeDefined();
        expect((error as RuntimeError).context?.size).toBeDefined();
        expect((error as RuntimeError).context?.max).toBeDefined();
      }
    });
  });
});
