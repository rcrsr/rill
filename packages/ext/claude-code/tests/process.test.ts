/**
 * Tests for process manager module.
 * Covers spawn errors, timeout enforcement, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// MOCKS
// ============================================================

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

import * as pty from 'node-pty';
import { spawnClaudeCli } from '../src/process.js';

// Helper to create mock PTY
interface MockPtyProcess {
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
}

function createMockPty(): MockPtyProcess {
  return {
    write: vi.fn(),
    kill: vi.fn(),
    onExit: vi.fn(),
    onData: vi.fn(),
  };
}

// ============================================================
// SETUP/TEARDOWN
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// SPAWN ERROR TESTS
// ============================================================

describe('Process Manager', () => {
  describe('spawn errors', () => {
    it('throws RILL-R004 for binary not found (ENOENT)', () => {
      // EC-4: Binary not found triggers ENOENT error
      const error = new Error('spawn claude ENOENT') as Error & {
        code?: string;
      };
      error.code = 'ENOENT';

      vi.mocked(pty.spawn).mockImplementation(() => {
        throw error;
      });

      expect(() =>
        spawnClaudeCli('test', { binaryPath: '/invalid/path' })
      ).toThrow('claude binary not found');
    });

    it('throws RILL-R004 for permission denied (EACCES)', () => {
      // EC-5: Permission denied triggers EACCES error
      const error = new Error('spawn claude EACCES') as Error & {
        code?: string;
      };
      error.code = 'EACCES';

      vi.mocked(pty.spawn).mockImplementation(() => {
        throw error;
      });

      expect(() => spawnClaudeCli('test', { binaryPath: '/no/perms' })).toThrow(
        'Permission denied: claude'
      );
    });

    it('throws RILL-R004 for generic spawn failure', () => {
      // EC-6: Generic spawn failure includes error details
      const error = new Error('Unknown spawn error');

      vi.mocked(pty.spawn).mockImplementation(() => {
        throw error;
      });

      expect(() => spawnClaudeCli('test')).toThrow(
        'Failed to spawn claude binary: Unknown spawn error'
      );
    });

    it('throws RILL-R004 for unknown error type', () => {
      // EC-6: Non-Error objects handled
      vi.mocked(pty.spawn).mockImplementation(() => {
        throw 'string error';
      });

      expect(() => spawnClaudeCli('test')).toThrow(
        'Failed to spawn claude binary: Unknown error'
      );
    });
  });

  describe('successful spawn', () => {
    it('spawns with correct CLI flags', () => {
      // AC-3: Correct flags passed to CLI
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('test prompt', { binaryPath: '/usr/bin/claude' });

      expect(pty.spawn).toHaveBeenCalledWith(
        '/usr/bin/claude',
        expect.arrayContaining([
          '-p',
          'test prompt',
          '--output-format',
          'stream-json',
          '--verbose',
          '--dangerously-skip-permissions',
        ]),
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
        })
      );
    });

    it('passes prompt via -p flag', () => {
      // Prompt passed as CLI argument, not stdin
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('my prompt');

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', 'my prompt']),
        expect.any(Object)
      );
      expect(mockPty.write).not.toHaveBeenCalled();
    });

    it('uses default binary path when not specified', () => {
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('test');

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('uses provided working directory', () => {
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('test', { cwd: '/custom/dir' });

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: '/custom/dir' })
      );
    });

    it('uses provided environment variables', () => {
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const customEnv = { CUSTOM_VAR: 'value' };
      spawnClaudeCli('test', { env: customEnv });

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ env: customEnv })
      );
    });
  });

  describe('timeout enforcement', () => {
    it('kills process after timeout expires', async () => {
      // EC-8: Timeout kills process
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test', { timeoutMs: 5000 });

      // Advance time past timeout
      vi.advanceTimersByTime(5000);

      await expect(result.exitCode).rejects.toThrow(
        'Claude CLI timeout after 5000ms'
      );
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it('does not set timeout when timeoutMs is undefined', () => {
      // No timeout enforcement without explicit value
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('test');

      vi.advanceTimersByTime(1000000);
      expect(mockPty.kill).not.toHaveBeenCalled();
    });

    it('does not set timeout when timeoutMs is zero', () => {
      // Zero timeout means no enforcement
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      spawnClaudeCli('test', { timeoutMs: 0 });

      vi.advanceTimersByTime(1000000);
      expect(mockPty.kill).not.toHaveBeenCalled();
    });

    it('clears timeout on successful exit', () => {
      // AC-3: Timeout cleared when process exits normally
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test', { timeoutMs: 5000 });

      // Simulate successful exit before timeout
      exitCallback?.({ exitCode: 0 });

      // Advance past timeout - should not kill
      vi.advanceTimersByTime(5000);
      expect(mockPty.kill).not.toHaveBeenCalled();

      return expect(result.exitCode).resolves.toBe(0);
    });
  });

  describe('exit code handling', () => {
    it('resolves with code 0 on successful exit', async () => {
      // Successful exit returns 0
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test');

      exitCallback?.({ exitCode: 0 });

      await expect(result.exitCode).resolves.toBe(0);
    });

    it('rejects with RILL-R004 on non-zero exit', async () => {
      // EC-9: Non-zero exit code propagates
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test');

      exitCallback?.({ exitCode: 1 });

      await expect(result.exitCode).rejects.toThrow(
        'Claude CLI exited with code 1'
      );
    });

    it('rejects with RILL-R004 on exit code 127', async () => {
      // Common error code (command not found)
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test');

      exitCallback?.({ exitCode: 127 });

      await expect(result.exitCode).rejects.toThrow(
        'Claude CLI exited with code 127'
      );
    });
  });

  describe('cleanup and disposal', () => {
    it('kills process when dispose is called', () => {
      // Cleanup function kills process
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test');
      result.dispose();

      expect(mockPty.kill).toHaveBeenCalled();
    });

    it('clears timeout when dispose is called', () => {
      // Disposal clears timeout to prevent memory leak
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test', { timeoutMs: 5000 });
      result.dispose();

      // Advance time - timeout should not fire
      vi.advanceTimersByTime(5000);
      // Kill only called once (from dispose, not timeout)
      expect(mockPty.kill).toHaveBeenCalledTimes(1);
    });

    it('does not throw when dispose is called multiple times', () => {
      // EC-16: Idempotent cleanup
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test');

      expect(() => {
        result.dispose();
        result.dispose();
        result.dispose();
      }).not.toThrow();
    });

    it('logs warning but does not throw when kill fails', () => {
      // EC-16: Cleanup failure logs warning
      const mockPty = createMockPty();
      mockPty.kill.mockImplementation(() => {
        throw new Error('Process already dead');
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result = spawnClaudeCli('test');

      expect(() => result.dispose()).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to kill claude process')
      );

      consoleWarnSpy.mockRestore();
    });

    it('does not kill twice if timeout fires then dispose called', () => {
      // Disposed flag prevents double-kill
      const mockPty = createMockPty();
      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test', { timeoutMs: 5000 });

      // Catch rejection to prevent unhandled error
      result.exitCode.catch(() => {});

      // Timeout fires
      vi.advanceTimersByTime(5000);

      // Then dispose called
      result.dispose();

      // Kill called only once
      expect(mockPty.kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent processes', () => {
    it('handles multiple spawns independently', () => {
      // AC-15: Concurrent processes work independently
      const mockPty1 = createMockPty();
      const mockPty2 = createMockPty();
      const mockPty3 = createMockPty();

      let callCount = 0;
      vi.mocked(pty.spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockPty1 as unknown as pty.IPty;
        if (callCount === 2) return mockPty2 as unknown as pty.IPty;
        return mockPty3 as unknown as pty.IPty;
      });

      const result1 = spawnClaudeCli('prompt1', { timeoutMs: 1000 });
      const result2 = spawnClaudeCli('prompt2', { timeoutMs: 2000 });
      const result3 = spawnClaudeCli('prompt3', { timeoutMs: 3000 });

      // Catch rejections to prevent unhandled errors
      result1.exitCode.catch(() => {});
      result2.exitCode.catch(() => {});
      result3.exitCode.catch(() => {});

      // Each process has separate timeout
      vi.advanceTimersByTime(1000);
      expect(mockPty1.kill).toHaveBeenCalled();
      expect(mockPty2.kill).not.toHaveBeenCalled();
      expect(mockPty3.kill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(mockPty2.kill).toHaveBeenCalled();
      expect(mockPty3.kill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(mockPty3.kill).toHaveBeenCalled();

      // Each has independent disposal
      expect(() => {
        result1.dispose();
        result2.dispose();
        result3.dispose();
      }).not.toThrow();
    });

    it('handles 10 concurrent spawns without interference', () => {
      // AC-15: 10 concurrent spawns
      const mockPtys = Array.from({ length: 10 }, () => createMockPty());
      let callCount = 0;

      vi.mocked(pty.spawn).mockImplementation(() => {
        const pty = mockPtys[callCount];
        callCount++;
        return pty as unknown as pty.IPty;
      });

      const results = Array.from({ length: 10 }, (_, i) =>
        spawnClaudeCli(`prompt${i}`, { timeoutMs: (i + 1) * 1000 })
      );

      // Catch rejections to prevent unhandled errors
      results.forEach((r) => r.exitCode.catch(() => {}));

      // Each timeout fires independently
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000);
        expect(mockPtys[i].kill).toHaveBeenCalled();
      }

      // All can be disposed
      results.forEach((r) => r.dispose());
    });
  });

  describe('resource leak prevention', () => {
    it('sequential spawns clear timeouts properly', () => {
      // AC-16: No resource leaks over repeated calls
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      // Simulate 100 sequential spawns (scaled down from 1000 for test speed)
      for (let i = 0; i < 100; i++) {
        const result = spawnClaudeCli('test', { timeoutMs: 5000 });
        exitCallback?.({ exitCode: 0 });
        result.dispose();
      }

      // No hanging timers - advancing time should not cause issues
      vi.advanceTimersByTime(10000);

      // No excessive kill calls (only from disposal, not timeouts)
      expect(mockPty.kill.mock.calls.length).toBeLessThanOrEqual(100);
    });

    it('disposed processes do not respond to late events', () => {
      // Disposed flag prevents late event handling
      const mockPty = createMockPty();
      let exitCallback: ((event: { exitCode: number }) => void) | undefined;

      mockPty.onExit.mockImplementation((cb) => {
        exitCallback = cb;
      });

      vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty);

      const result = spawnClaudeCli('test', { timeoutMs: 5000 });
      result.dispose();

      // Late exit event after disposal
      exitCallback?.({ exitCode: 1 });

      // Should not throw or cause issues
      vi.advanceTimersByTime(5000);
    });
  });
});
