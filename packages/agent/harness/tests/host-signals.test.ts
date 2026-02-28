/**
 * Tests for registerSignalHandlers — SIGTERM drain and SIGINT abort.
 *
 * Covered:
 *   AC-29  SIGTERM + never-resolving stop + drainTimeout 50ms → exit 1 after timeout
 *   AC-30  SIGTERM + fast stop within drainTimeout → exit 0
 *   AC-34  SIGINT → stop called + exit 1 immediately
 *
 * Strategy: Mock process.exit with vi.spyOn (non-throwing) so the async
 * SIGTERM handler and the sync SIGINT handler record calls without
 * killing the Vitest process.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerSignalHandlers } from '../src/signals.js';
import type { SessionRecord } from '../src/types.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Minimal mock satisfying the local SignalHost interface in signals.ts.
 * The full AgentHost satisfies this shape structurally; so does this mock.
 */
function createMockHost(stopImpl: () => Promise<void>): {
  stop: () => Promise<void>;
  sessions: () => SessionRecord[];
} {
  return {
    stop: stopImpl,
    sessions: () => [],
  };
}

/**
 * Resolves after the given number of milliseconds.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// SIGNAL HANDLER TESTS
// ============================================================

describe('registerSignalHandlers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn<typeof process, 'exit'>>;

  beforeEach(() => {
    // Mock process.exit without throwing — just record the call.
    // Throwing would cause the async handleSigterm promise to reject as an
    // unhandled rejection, which fails the test suite.
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null | undefined) => {
        return undefined as never;
      });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Remove signal listeners added during each test to prevent cross-test
    // interference. Tests add exactly one listener per signal per call.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  // ----------------------------------------------------------
  // AC-29: SIGTERM + never-resolving stop → exit 1 after timeout
  // ----------------------------------------------------------

  describe('SIGTERM', () => {
    it('calls process.exit(1) when stop does not complete within drainTimeout (AC-29)', async () => {
      // Arrange: stop() returns a promise that never resolves.
      const host = createMockHost(() => new Promise<void>(() => {}));
      const drainTimeout = 50; // ms

      registerSignalHandlers(host, drainTimeout);

      // Act: emit SIGTERM and wait longer than the drain timeout.
      process.emit('SIGTERM');
      await wait(drainTimeout + 100);

      // Assert: exit(1) was called because stop timed out.
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(0);
    });

    // --------------------------------------------------------
    // AC-30: SIGTERM + fast stop → exit 0
    // --------------------------------------------------------

    it('calls process.exit(0) when stop completes within drainTimeout (AC-30)', async () => {
      // Arrange: stop() resolves immediately.
      const host = createMockHost(() => Promise.resolve());
      const drainTimeout = 200; // ms

      registerSignalHandlers(host, drainTimeout);

      // Act: emit SIGTERM and wait a short time for the async handler.
      process.emit('SIGTERM');
      await wait(50);

      // Assert: exit(0) was called because drain completed cleanly.
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  // ----------------------------------------------------------
  // AC-34: SIGINT → stop called + exit 1 immediately
  // ----------------------------------------------------------

  describe('SIGINT', () => {
    it('calls process.exit(1) immediately and invokes stop (AC-34)', () => {
      // Arrange: track whether stop() was called.
      let stopCalled = false;
      const host = createMockHost(() => {
        stopCalled = true;
        return Promise.resolve();
      });

      registerSignalHandlers(host, 1000);

      // Act: emit SIGINT — handler is synchronous.
      process.emit('SIGINT');

      // Assert: exit(1) called immediately and stop was invoked.
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stopCalled).toBe(true);
    });
  });
});
