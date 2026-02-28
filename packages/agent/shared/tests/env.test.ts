import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnv } from '../src/env.js';

// ============================================================
// HELPERS
// ============================================================

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `rill-env-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeDotenv(name: string, content: string): void {
  writeFileSync(path.join(tmpDir, name), content, 'utf-8');
}

// ============================================================
// FALLBACK BEHAVIOR
// ============================================================

describe('loadEnv', () => {
  describe('fallback behavior', () => {
    it('returns process.env when sources is undefined', () => {
      const result = loadEnv(undefined, tmpDir);
      expect(result).toBe(process.env);
    });

    it('returns process.env when sources is empty array', () => {
      const result = loadEnv([], tmpDir);
      expect(result).toBe(process.env);
    });
  });

  // ============================================================
  // PROCESS SOURCE
  // ============================================================

  describe('process source', () => {
    it('includes process.env values', () => {
      const result = loadEnv([{ type: 'process' }], tmpDir);
      expect(result['PATH']).toBe(process.env['PATH']);
    });
  });

  // ============================================================
  // DOTENV SOURCE
  // ============================================================

  describe('dotenv source', () => {
    it('parses KEY=value lines', () => {
      writeDotenv('.env', 'FOO=bar\nBAZ=qux');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['FOO']).toBe('bar');
      expect(result['BAZ']).toBe('qux');
    });

    it('strips double quotes from values', () => {
      writeDotenv('.env', 'TOKEN="my-secret"');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['TOKEN']).toBe('my-secret');
    });

    it('strips single quotes from values', () => {
      writeDotenv('.env', "TOKEN='my-secret'");
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['TOKEN']).toBe('my-secret');
    });

    it('skips comment lines', () => {
      writeDotenv('.env', '# this is a comment\nKEY=val');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['KEY']).toBe('val');
      expect(result['# this is a comment']).toBeUndefined();
    });

    it('skips blank lines', () => {
      writeDotenv('.env', 'A=1\n\n\nB=2');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['A']).toBe('1');
      expect(result['B']).toBe('2');
    });

    it('handles values containing = characters', () => {
      writeDotenv('.env', 'URL=https://api.example.com?key=abc');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['URL']).toBe('https://api.example.com?key=abc');
    });

    it('handles empty values', () => {
      writeDotenv('.env', 'EMPTY=');
      const result = loadEnv([{ type: 'dotenv', path: '.env' }], tmpDir);
      expect(result['EMPTY']).toBe('');
    });

    it('resolves path relative to basePath', () => {
      const subDir = path.join(tmpDir, 'config');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(path.join(subDir, '.env.local'), 'X=42', 'utf-8');
      const result = loadEnv(
        [{ type: 'dotenv', path: 'config/.env.local' }],
        tmpDir
      );
      expect(result['X']).toBe('42');
    });

    it('warns and skips missing .env file', () => {
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      const result = loadEnv(
        [{ type: 'dotenv', path: '.env.missing' }],
        tmpDir
      );
      expect(result).toEqual({});
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('.env.missing')
      );
      stderrSpy.mockRestore();
    });
  });

  // ============================================================
  // SOURCE MERGE ORDER
  // ============================================================

  describe('merge order', () => {
    it('later sources override earlier sources', () => {
      writeDotenv('.env', 'KEY=from-dotenv\nONLY_DOTENV=yes');
      // Process env always has PATH set
      const result = loadEnv(
        [{ type: 'process' }, { type: 'dotenv', path: '.env' }],
        tmpDir
      );
      expect(result['KEY']).toBe('from-dotenv');
      expect(result['ONLY_DOTENV']).toBe('yes');
      // process.env values still present for keys not overridden
      expect(result['PATH']).toBe(process.env['PATH']);
    });

    it('process after dotenv overrides dotenv values', () => {
      writeDotenv('.env', `PATH=fake-path`);
      const result = loadEnv(
        [{ type: 'dotenv', path: '.env' }, { type: 'process' }],
        tmpDir
      );
      // process.env PATH overrides the dotenv PATH
      expect(result['PATH']).toBe(process.env['PATH']);
    });

    it('multiple dotenv files merge in order', () => {
      writeDotenv('.env', 'A=1\nB=2');
      writeDotenv('.env.local', 'B=override\nC=3');
      const result = loadEnv(
        [
          { type: 'dotenv', path: '.env' },
          { type: 'dotenv', path: '.env.local' },
        ],
        tmpDir
      );
      expect(result['A']).toBe('1');
      expect(result['B']).toBe('override');
      expect(result['C']).toBe('3');
    });
  });
});
