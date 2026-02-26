/**
 * Unit tests for generateStateBackendSnippet helper.
 * IC-10: State backend snippet drives both local and container targets.
 */

import { describe, it, expect } from 'vitest';
import { generateStateBackendSnippet } from '../../src/targets/helpers.js';

describe('generateStateBackendSnippet', () => {
  // ============================================================
  // UNDEFINED / NO BACKEND [IC-10]
  // ============================================================

  it('returns null when stateBackend is undefined', () => {
    const result = generateStateBackendSnippet(undefined);
    expect(result).toBeNull();
  });

  // ============================================================
  // MEMORY BACKEND [IC-10]
  // ============================================================

  it('returns memory backend importLine from @rcrsr/rill-host', () => {
    const result = generateStateBackendSnippet({ type: 'memory' });
    expect(result).not.toBeNull();
    expect(result!.importLine).toBe(
      "import { createMemoryBackend } from '@rcrsr/rill-host';"
    );
  });

  it('returns createMemoryBackend() as instantiation for memory type', () => {
    const result = generateStateBackendSnippet({ type: 'memory' });
    expect(result!.instantiation).toBe('createMemoryBackend()');
  });

  it('memory type result has no config in instantiation string', () => {
    const result = generateStateBackendSnippet({ type: 'memory' });
    expect(result!.instantiation).not.toContain('{');
  });

  // ============================================================
  // FILE BACKEND [IC-10]
  // ============================================================

  it('returns file backend importLine from @rcrsr/rill-state-fs', () => {
    const result = generateStateBackendSnippet({
      type: 'file',
      config: { dir: '/tmp/state' },
    });
    expect(result).not.toBeNull();
    expect(result!.importLine).toBe(
      "import { createFileBackend } from '@rcrsr/rill-state-fs';"
    );
  });

  it('includes config in file backend instantiation string', () => {
    const result = generateStateBackendSnippet({
      type: 'file',
      config: { dir: '/tmp/state' },
    });
    expect(result!.instantiation).toBe(
      'createFileBackend({"dir":"/tmp/state"})'
    );
  });

  it('file backend with empty config produces createFileBackend({})', () => {
    const result = generateStateBackendSnippet({
      type: 'file',
      config: {},
    });
    expect(result!.instantiation).toBe('createFileBackend({})');
  });

  // ============================================================
  // SQLITE BACKEND [IC-10]
  // ============================================================

  it('returns sqlite backend importLine from @rcrsr/rill-state-sqlite', () => {
    const result = generateStateBackendSnippet({
      type: 'sqlite',
      config: { filePath: '/tmp/state.db' },
    });
    expect(result).not.toBeNull();
    expect(result!.importLine).toBe(
      "import { createSqliteBackend } from '@rcrsr/rill-state-sqlite';"
    );
  });

  it('includes config in sqlite backend instantiation string', () => {
    const result = generateStateBackendSnippet({
      type: 'sqlite',
      config: { filePath: '/tmp/state.db' },
    });
    expect(result!.instantiation).toBe(
      'createSqliteBackend({"filePath":"/tmp/state.db"})'
    );
  });

  // ============================================================
  // REDIS BACKEND [IC-10]
  // ============================================================

  it('returns redis backend importLine from @rcrsr/rill-state-redis', () => {
    const result = generateStateBackendSnippet({
      type: 'redis',
      config: { url: 'redis://localhost' },
    });
    expect(result).not.toBeNull();
    expect(result!.importLine).toBe(
      "import { createRedisBackend } from '@rcrsr/rill-state-redis';"
    );
  });

  it('includes config in redis backend instantiation string', () => {
    const result = generateStateBackendSnippet({
      type: 'redis',
      config: { url: 'redis://localhost' },
    });
    expect(result!.instantiation).toBe(
      'createRedisBackend({"url":"redis://localhost"})'
    );
  });

  // ============================================================
  // CONFIG SERIALIZATION [IC-10]
  // ============================================================

  it('serializes multi-key config objects as JSON in instantiation', () => {
    const result = generateStateBackendSnippet({
      type: 'redis',
      config: { url: 'redis://localhost', db: 1, tls: true },
    });
    const parsed = JSON.parse(
      result!.instantiation
        .replace(/^createRedisBackend\(/, '')
        .replace(/\)$/, '')
    );
    expect(parsed).toEqual({ url: 'redis://localhost', db: 1, tls: true });
  });
});
