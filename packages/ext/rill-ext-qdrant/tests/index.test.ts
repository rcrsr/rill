/**
 * Barrel export validation tests
 * Validates that all required exports are available from the package entry point
 */

import { describe, it, expect } from 'vitest';
import {
  VERSION,
  createQdrantExtension,
  type QdrantConfig,
} from '../src/index.js';

// ============================================================
// VERSION CONSTANT TESTS
// ============================================================

describe('VERSION constant', () => {
  it('exports VERSION constant (IC-1)', () => {
    expect(VERSION).toBeDefined();
  });

  it('VERSION is a string (IC-1)', () => {
    expect(typeof VERSION).toBe('string');
  });

  it('VERSION matches package.json version (IC-1)', () => {
    expect(VERSION).toBe('0.0.1');
  });
});

// ============================================================
// TYPE EXPORT TESTS
// ============================================================

describe('QdrantConfig type export', () => {
  it('exports QdrantConfig type (IC-1)', () => {
    // Type-only test: verify the type is exported and can be used
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test',
    };

    expect(config.url).toBe('http://localhost:6333');
    expect(config.collection).toBe('test');
  });
});

// ============================================================
// FACTORY EXPORT TESTS
// ============================================================

describe('createQdrantExtension factory export', () => {
  it('exports createQdrantExtension factory (IC-1)', () => {
    expect(createQdrantExtension).toBeDefined();
    expect(typeof createQdrantExtension).toBe('function');
  });

  it('factory creates extension from barrel export (IC-1)', () => {
    const ext = createQdrantExtension({
      url: 'http://localhost:6333',
      collection: 'test',
    });

    expect(ext).toBeDefined();
    // ExtensionResult is a Record<string, HostFunctionDefinition> with optional dispose
    expect(ext.upsert).toBeDefined();
    expect(ext.dispose).toBeDefined();
  });
});
