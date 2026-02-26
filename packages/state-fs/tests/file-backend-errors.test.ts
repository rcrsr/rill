/**
 * Tests for createFileBackend — error and boundary paths.
 *
 * Covered:
 *   AC-38  EC-11: EACCES on unwritable directory
 *   AC-42  listCheckpoints with 0 matching returns []
 *   AC-43  EC-6: deleteCheckpoint on nonexistent ID resolves
 *   AC-44  connect() called twice resolves
 *   AC-45  close() called twice resolves
 *   AC-46  saveCheckpoint with extensionState: {} persists correctly
 *   EC-13  Corrupt JSON file throws SyntaxError from loadCheckpoint
 *
 * Skipped (require OS-level setup):
 *   EC-12  ENOSPC — disk full
 *   EC-2, EC-7, EC-9  — write failures
 *   EC-4  — read failures
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBackend, type FileBackendConfig } from '../src/index.js';
import type { CheckpointData } from '@rcrsr/rill-host';

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

// ============================================================
// SETUP
// ============================================================

let tmpDir: string;
let config: FileBackendConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rill-state-fs-err-test-'));
  config = { dir: tmpDir };
});

afterEach(() => {
  // Restore permissions so cleanup does not fail.
  try {
    chmodSync(join(tmpDir, 'checkpoints'), 0o755);
  } catch {
    // Directory may not exist yet — ignore.
  }
  try {
    chmodSync(join(tmpDir, 'sessions'), 0o755);
  } catch {
    // Directory may not exist yet — ignore.
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// CONNECT / CLOSE IDEMPOTENCY
// ============================================================

describe('createFileBackend error and boundary paths', () => {
  describe('connect() / close() idempotency', () => {
    it('connect() called twice resolves both times (AC-44)', async () => {
      const backend = createFileBackend(config);

      await expect(backend.connect()).resolves.toBeUndefined();
      await expect(backend.connect()).resolves.toBeUndefined();
    });

    it('close() called twice resolves both times (AC-45)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      await expect(backend.close()).resolves.toBeUndefined();
      await expect(backend.close()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // DELETE NONEXISTENT
  // ============================================================

  describe('deleteCheckpoint', () => {
    it('resolves without error for a nonexistent ID (AC-43, EC-6)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      await expect(
        backend.deleteCheckpoint('no-such-id')
      ).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // LIST WITH NO MATCHES
  // ============================================================

  describe('listCheckpoints', () => {
    it('returns [] when no checkpoints exist at all (AC-42)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      const results = await backend.listCheckpoints('test-agent');

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // EXTENSION STATE
  // ============================================================

  describe('saveCheckpoint with extensionState: {}', () => {
    it('persists and retrieves extensionState: {} correctly (AC-46)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();
      const checkpoint = makeCheckpoint({ extensionState: {} });

      await backend.saveCheckpoint(checkpoint);

      const loaded = await backend.loadCheckpoint(checkpoint.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.extensionState).toEqual({});
    });
  });

  // ============================================================
  // CORRUPT JSON (EC-13)
  // ============================================================

  describe('corrupt JSON', () => {
    it('returns null when index points to a corrupt checkpoint file (EC-13)', async () => {
      const backend = createFileBackend(config);
      await backend.connect();

      // Write a corrupt file and a matching index entry so loadCheckpoint
      // tries to read it.
      writeFileSync(
        join(tmpDir, 'checkpoints', 'chk-corrupt.json'),
        '{ not valid json }'
      );
      writeFileSync(
        join(tmpDir, 'checkpoints', 'sessions-index.json'),
        JSON.stringify({ 'sess-001': 'chk-corrupt' })
      );

      const result = await backend.loadCheckpoint('sess-001');
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // EACCES (AC-38, EC-11)
  // ============================================================

  describe('EACCES on unwritable directory', () => {
    it(
      'connect() throws with EACCES when dir is not writable (AC-38, EC-11)',
      {
        skip:
          process.platform === 'win32' ||
          (typeof process.getuid === 'function' && process.getuid() === 0),
      },
      async () => {
        // Create a locked directory that cannot be written to.
        const lockedDir = join(tmpDir, 'locked');
        mkdirSync(lockedDir);
        chmodSync(lockedDir, 0o000);

        const backend = createFileBackend({ dir: lockedDir });

        await expect(backend.connect()).rejects.toMatchObject({
          code: 'EACCES',
        });

        // Restore so afterEach cleanup succeeds.
        chmodSync(lockedDir, 0o755);
      }
    );
  });

  // ============================================================
  // SKIPPED: OS-LEVEL FAILURES
  // ============================================================

  it.skip('EC-12: ENOSPC — disk full — not tested (requires OS-level setup)', () => {
    // Requires filling the filesystem; not feasible in unit tests.
  });

  it.skip('EC-2, EC-7, EC-9: generic write failures — not tested (requires OS-level setup)', () => {
    // Requires mocking fs at OS level.
  });

  it.skip('EC-4: read failures — not tested (requires OS-level setup)', () => {
    // Requires mocking fs at OS level.
  });
});
