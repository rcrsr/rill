/**
 * Tests for createSqliteBackend — error and boundary cases.
 *
 * Covered:
 *   AC-39, EC-16  SQLITE_BUSY on concurrent write (skipped: requires multi-process setup)
 *   EC-14         connect() with non-writable path throws native SqliteError
 *   EC-15         Schema migration failure (skipped: hard to trigger without internals)
 *   EC-2          saveCheckpoint after close() throws
 *   EC-4          loadCheckpoint after close() throws
 *   EC-7          deleteCheckpoint after close() throws
 *   EC-9          putSession after close() throws
 *   AC-43         deleteCheckpoint on nonexistent ID resolves without error
 *   AC-45         close() called twice after connect() resolves without error
 *   AC-46         saveCheckpoint with extensionState: {} persists correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteBackend, type SqliteBackendConfig } from '../src/index.js';
import type { CheckpointData, PersistedSessionState } from '@rcrsr/rill-host';

// ============================================================
// FIXTURE BUILDERS
// ============================================================

function makeCheckpoint(overrides?: Partial<CheckpointData>): CheckpointData {
  return {
    id: 'chk-001',
    sessionId: 'sess-001',
    agentName: 'test-agent',
    timestamp: 1000,
    stepIndex: 0,
    totalSteps: 5,
    pipeValue: null,
    variables: {},
    variableTypes: {},
    extensionState: {},
    ...overrides,
  };
}

function makeSession(
  overrides?: Partial<PersistedSessionState>
): PersistedSessionState {
  return {
    sessionId: 'sess-001',
    agentName: 'test-agent',
    state: 'running',
    startTime: 1000,
    lastActivity: 2000,
    metadata: {},
    ...overrides,
  };
}

// ============================================================
// SETUP
// ============================================================

let tmpDir: string;
let config: SqliteBackendConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rill-sqlite-err-test-'));
  config = { filePath: join(tmpDir, 'state.db') };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// ERROR CASES: EC-14, EC-15, EC-16 / AC-39
// ============================================================

describe('createSqliteBackend — error cases', () => {
  describe('connect()', () => {
    it('throws a native error when file path parent directory does not exist (EC-14)', () => {
      // A path whose parent directory does not exist cannot be written.
      // better-sqlite3's Database constructor throws synchronously, so connect()
      // also throws synchronously rather than returning a rejected Promise.
      const badConfig: SqliteBackendConfig = {
        filePath: '/nonexistent-parent-directory/sub/state.db',
      };
      const backend = createSqliteBackend(badConfig);

      expect(() => backend.connect()).toThrow();
    });

    it.skip('SQLITE_BUSY propagates as native error on concurrent write from two processes (AC-39, EC-16)', () => {
      // SKIP REASON: better-sqlite3 is synchronous and Node.js is single-threaded.
      // SQLITE_BUSY from concurrent access requires two separate OS processes
      // writing to the same WAL-mode database simultaneously. This is not
      // reliably reproducible in a single-process Vitest run. A multi-process
      // integration test (e.g. via worker_threads or child_process) is needed.
    });

    it.skip('schema migration failure propagates as native SqliteError (EC-15)', () => {
      // SKIP REASON: The migration logic runs instance.exec() inside connect().
      // Triggering a migration failure requires corrupting the internal SQLite
      // schema or injecting a fault into better-sqlite3's exec path, neither of
      // which is safely achievable without patching the module. The success path
      // for migration is covered in sqlite-backend.test.ts (AC-21).
    });
  });

  // ============================================================
  // OPERATIONS AFTER CLOSE: EC-2, EC-4, EC-7, EC-9
  // ============================================================

  describe('operations after close()', () => {
    it('saveCheckpoint throws after backend is closed (EC-2)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      await backend.close();

      // getDb() throws because db is null after close.
      expect(() => {
        void backend.saveCheckpoint(makeCheckpoint());
      }).toThrow('not connected');
    });

    it('loadCheckpoint throws after backend is closed (EC-4)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      await backend.close();

      expect(() => {
        void backend.loadCheckpoint('sess-001');
      }).toThrow('not connected');
    });

    it('deleteCheckpoint throws after backend is closed (EC-7)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      await backend.close();

      expect(() => {
        void backend.deleteCheckpoint('chk-001');
      }).toThrow('not connected');
    });

    it('putSession throws after backend is closed (EC-9)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();
      await backend.close();

      expect(() => {
        void backend.putSession('sess-001', makeSession());
      }).toThrow('not connected');
    });
  });

  // ============================================================
  // BOUNDARY CONDITIONS: AC-43, AC-45, AC-46
  // ============================================================

  describe('boundary conditions', () => {
    it('deleteCheckpoint on a nonexistent ID resolves without error (AC-43)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      // No rows match the ID; SQLite DELETE is a no-op. Must still resolve.
      await expect(
        backend.deleteCheckpoint('does-not-exist')
      ).resolves.toBeUndefined();

      await backend.close();
    });

    it('close() called twice after connect() resolves without error (AC-45)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      // First close tears down the connection; second close is a no-op.
      await expect(backend.close()).resolves.toBeUndefined();
      await expect(backend.close()).resolves.toBeUndefined();
    });

    it('saveCheckpoint with extensionState: {} persists and loads as {} (AC-46)', async () => {
      const backend = createSqliteBackend(config);
      await backend.connect();

      const checkpoint = makeCheckpoint({
        extensionState: {},
        variables: { count: 7 },
        variableTypes: { count: 'number' },
        pipeValue: 'result',
      });

      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);

      expect(loaded).not.toBeNull();
      // extensionState must round-trip as an empty object, not null/undefined.
      expect(loaded!.extensionState).toEqual({});
      // Other fields must be intact alongside the empty extensionState.
      expect(loaded!.variables).toEqual({ count: 7 });
      expect(loaded!.variableTypes).toEqual({ count: 'number' });
      expect(loaded!.pipeValue).toBe('result');

      await backend.close();
    });
  });
});
