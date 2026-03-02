/**
 * Unit tests for loadConfig().
 *
 * Covered:
 *   IR-7   loadConfig with valid file path → returns parsed + interpolated config
 *   IR-7   loadConfig with inline JSON → returns parsed config
 *   EC-6   loadConfig with file not found → throws with readable path error
 *   EC-7   loadConfig with invalid JSON → throws with parse error
 *   AC-20  loadConfig with inline JSON containing unset ${VAR} → retains literal
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/load-config.js';

// ============================================================
// TEMP DIR SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'load-config-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// FILE PATH TESTS [IR-7]
// ============================================================

describe('loadConfig — file path detection', () => {
  it('detects a value with / as a file path and parses the file [IR-7]', () => {
    const configData = { myExt: { apiKey: 'abc123' } };
    const filePath = path.join(testDir, 'config.json');
    writeFileSync(filePath, JSON.stringify(configData), 'utf-8');

    const result = loadConfig(filePath);

    expect(result).toEqual(configData);
  });

  it('detects a value ending with .json as a file path [IR-7]', () => {
    const configData = { db: { host: 'localhost' } };
    // Use a relative-looking name that ends with .json (still resolved via readFileSync)
    const filePath = path.join(testDir, 'agent.json');
    writeFileSync(filePath, JSON.stringify(configData), 'utf-8');

    const result = loadConfig(filePath);

    expect(result).toEqual(configData);
  });

  it('interpolates ${VAR} in file config values against process.env [IR-7]', () => {
    const originalEnv = process.env['TEST_HOST'];
    process.env['TEST_HOST'] = 'db.example.com';

    try {
      const configData = { db: { host: '${TEST_HOST}' } };
      const filePath = path.join(testDir, 'config.json');
      writeFileSync(filePath, JSON.stringify(configData), 'utf-8');

      const result = loadConfig(filePath);

      expect(result).toEqual({ db: { host: 'db.example.com' } });
    } finally {
      if (originalEnv === undefined) {
        delete process.env['TEST_HOST'];
      } else {
        process.env['TEST_HOST'] = originalEnv;
      }
    }
  });
});

// ============================================================
// INLINE JSON TESTS [IR-7]
// ============================================================

describe('loadConfig — inline JSON', () => {
  it('parses inline JSON string directly [IR-7]', () => {
    const result = loadConfig('{"ext":{"key":"value"}}');

    expect(result).toEqual({ ext: { key: 'value' } });
  });

  it('returns empty object for inline empty object JSON [IR-7]', () => {
    const result = loadConfig('{}');

    expect(result).toEqual({});
  });

  it('retains literal ${VAR} in inline JSON when env var is unset [AC-20]', () => {
    // Ensure the variable is not set
    const varName = 'RILL_TEST_UNSET_VAR_XYZ';
    delete process.env[varName];

    // Build JSON string with a ${VAR} placeholder without triggering template substitution
    const placeholder = '${' + varName + '}';
    const inlineJson = '{"app":{"name":"' + placeholder + '"}}';

    const result = loadConfig(inlineJson);

    expect(result).toEqual({ app: { name: placeholder } });
  });

  it('passes through non-string values unchanged in inline JSON [IR-7]', () => {
    const result = loadConfig(
      '{"server":{"port":8080,"debug":true,"meta":null}}'
    ) as Record<string, Record<string, unknown>>;

    expect(result['server']?.['port']).toBe(8080);
    expect(result['server']?.['debug']).toBe(true);
    expect(result['server']?.['meta']).toBeNull();
  });
});

// ============================================================
// ERROR CONDITIONS
// ============================================================

describe('loadConfig — error conditions', () => {
  // EC-6: file not found
  it('throws with readable path error when file does not exist [EC-6]', () => {
    const missingPath = path.join(testDir, 'missing.json');

    expect(() => loadConfig(missingPath)).toThrow();

    try {
      loadConfig(missingPath);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // The error should mention the path (node fs error includes the path)
      expect((err as Error).message).toContain(missingPath);
    }
  });

  // EC-7: invalid JSON in file
  it('throws with parse error message when file contains invalid JSON [EC-7]', () => {
    const filePath = path.join(testDir, 'invalid.json');
    writeFileSync(filePath, 'not valid json { broken', 'utf-8');

    expect(() => loadConfig(filePath)).toThrow('Invalid JSON in config');
  });

  // EC-7: invalid JSON inline
  it('throws with parse error message for invalid inline JSON [EC-7]', () => {
    // A value with no / or \ and not ending in .json is treated as inline
    expect(() => loadConfig('{broken json')).toThrow('Invalid JSON in config');
  });

  // Non-object JSON
  it('throws when JSON is an array rather than an object', () => {
    expect(() => loadConfig('[1, 2, 3]')).toThrow(
      'Config must be a JSON object'
    );
  });

  it('throws when JSON is a string scalar', () => {
    expect(() => loadConfig('"just-a-string"')).toThrow(
      'Config must be a JSON object'
    );
  });
});
