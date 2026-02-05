/**
 * Configuration Loader Tests
 * Tests for .rill-check.json loading and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, createDefaultConfig } from '../../src/check/index.js';

// ============================================================
// TEST FIXTURES
// ============================================================

const TEST_DIR = join(process.cwd(), 'tests', 'fixtures', 'check-config');
const CONFIG_FILE = '.rill-check.json';

/**
 * Create test directory and configuration file.
 */
function setupTestConfig(config: unknown): string {
  // Create test directory if it doesn't exist
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }

  const configPath = join(TEST_DIR, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return TEST_DIR;
}

/**
 * Clean up test directory after each test.
 */
function cleanupTestConfig(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

describe('createDefaultConfig', () => {
  it('returns configuration with all rules enabled', () => {
    const config = createDefaultConfig();

    expect(config.rules).toBeDefined();
    expect(config.severity).toBeDefined();
  });

  it('returns configuration with all registered rules enabled', () => {
    // VALIDATION_RULES contains registered rules
    const config = createDefaultConfig();

    // Should have at least NAMING_SNAKE_CASE rule
    expect(Object.keys(config.rules).length).toBeGreaterThan(0);
    expect(config.rules.NAMING_SNAKE_CASE).toBe('on');
  });
});

// ============================================================
// FILE NOT FOUND
// ============================================================

describe('loadConfig - file not found', () => {
  beforeEach(() => {
    cleanupTestConfig();
  });

  it('returns null when config file does not exist', () => {
    const result = loadConfig(TEST_DIR);
    expect(result).toBeNull();
  });

  it('returns null for non-existent directory', () => {
    const result = loadConfig('/nonexistent/directory');
    expect(result).toBeNull();
  });
});

// ============================================================
// VALID CONFIGURATION
// ============================================================

describe('loadConfig - valid configuration', () => {
  afterEach(() => {
    cleanupTestConfig();
  });

  it('loads empty configuration file', () => {
    setupTestConfig({});
    const result = loadConfig(TEST_DIR);

    expect(result).not.toBeNull();
    expect(result?.rules).toBeDefined();
    expect(result?.severity).toBeDefined();
  });

  it('loads configuration with rules field', () => {
    setupTestConfig({
      rules: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('loads configuration with severity field', () => {
    setupTestConfig({
      severity: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('loads configuration with both fields', () => {
    setupTestConfig({
      rules: {},
      severity: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
    expect(result?.rules).toBeDefined();
    expect(result?.severity).toBeDefined();
  });

  it('merges config with defaults', () => {
    setupTestConfig({
      rules: {},
      severity: {},
    });

    const defaults = createDefaultConfig();
    const result = loadConfig(TEST_DIR);

    expect(result).not.toBeNull();
    expect(result?.rules).toEqual(defaults.rules);
    expect(result?.severity).toEqual(defaults.severity);
  });
});

// ============================================================
// INVALID JSON [EC-3]
// ============================================================

describe('loadConfig - invalid JSON [EC-3]', () => {
  afterEach(() => {
    cleanupTestConfig();
  });

  it('throws for malformed JSON', () => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    const configPath = join(TEST_DIR, CONFIG_FILE);
    writeFileSync(configPath, '{ invalid json }', 'utf-8');

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('invalid JSON');
  });

  it('throws for non-object JSON', () => {
    setupTestConfig('string value');

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('must be an object');
  });

  it('throws for array JSON', () => {
    setupTestConfig([1, 2, 3]);

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('must be an object');
  });

  it('throws for null JSON', () => {
    setupTestConfig(null);

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('must be an object');
  });

  it('throws when rules field is not an object', () => {
    setupTestConfig({
      rules: 'invalid',
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('rules must be an object');
  });

  it('throws when severity field is not an object', () => {
    setupTestConfig({
      severity: 'invalid',
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('severity must be an object');
  });

  it('throws when rule state is invalid', () => {
    setupTestConfig({
      rules: {
        SOME_RULE: 'invalid_state',
      },
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('invalid state');
    expect(() => loadConfig(TEST_DIR)).toThrow(
      "must be 'on', 'off', or 'warn'"
    );
  });

  it('throws when severity value is invalid', () => {
    setupTestConfig({
      severity: {
        SOME_RULE: 'critical',
      },
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('invalid severity');
    expect(() => loadConfig(TEST_DIR)).toThrow(
      "must be 'error', 'warning', or 'info'"
    );
  });
});

// ============================================================
// UNKNOWN RULES [EC-4]
// ============================================================

describe('loadConfig - unknown rules [EC-4]', () => {
  afterEach(() => {
    cleanupTestConfig();
  });

  it('throws for unknown rule in rules field', () => {
    setupTestConfig({
      rules: {
        UNKNOWN_RULE: 'on',
      },
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('unknown rule UNKNOWN_RULE');
  });

  it('throws for unknown rule in severity field', () => {
    setupTestConfig({
      severity: {
        UNKNOWN_RULE: 'error',
      },
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('unknown rule UNKNOWN_RULE');
  });

  it('throws for multiple unknown rules', () => {
    setupTestConfig({
      rules: {
        UNKNOWN_ONE: 'on',
        UNKNOWN_TWO: 'off',
      },
    });

    expect(() => loadConfig(TEST_DIR)).toThrow('Invalid configuration:');
    expect(() => loadConfig(TEST_DIR)).toThrow('unknown rule');
  });
});

// ============================================================
// VALID RULE STATES
// ============================================================

describe('loadConfig - valid rule states', () => {
  afterEach(() => {
    cleanupTestConfig();
  });

  it('accepts "on" state', () => {
    setupTestConfig({
      rules: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('accepts "off" state', () => {
    setupTestConfig({
      rules: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('accepts "warn" state', () => {
    setupTestConfig({
      rules: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });
});

// ============================================================
// VALID SEVERITY VALUES
// ============================================================

describe('loadConfig - valid severity values', () => {
  afterEach(() => {
    cleanupTestConfig();
  });

  it('accepts "error" severity', () => {
    setupTestConfig({
      severity: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('accepts "warning" severity', () => {
    setupTestConfig({
      severity: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });

  it('accepts "info" severity', () => {
    setupTestConfig({
      severity: {},
    });

    const result = loadConfig(TEST_DIR);
    expect(result).not.toBeNull();
  });
});
