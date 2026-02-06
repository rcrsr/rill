/**
 * Process manager for Claude CLI spawning and lifecycle.
 * Handles PTY spawn, timeout enforcement, and cleanup.
 */

import * as pty from 'node-pty';
import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// TYPES
// ============================================================

/**
 * Process spawn result.
 * Includes PTY instance and cleanup function.
 */
export interface SpawnResult {
  /** PTY process instance */
  readonly ptyProcess: pty.IPty;
  /** Exit code promise (resolves when process exits) */
  readonly exitCode: Promise<number>;
  /** Cleanup function (kills process if running) */
  readonly dispose: () => void;
}

/**
 * Options for spawning Claude CLI process.
 */
export interface SpawnOptions {
  /** Path to Claude CLI binary (default: 'claude') */
  readonly binaryPath?: string | undefined;
  /** Timeout in milliseconds (kills process after duration) */
  readonly timeoutMs?: number | undefined;
  /** Working directory for process (default: inherit) */
  readonly cwd?: string | undefined;
  /** Environment variables (default: inherit) */
  readonly env?: Record<string, string | undefined> | undefined;
}

// ============================================================
// SPAWN FUNCTION
// ============================================================

/**
 * Spawn Claude CLI process with timeout enforcement.
 *
 * @param prompt - User prompt to send to Claude
 * @param options - Spawn options
 * @returns Process handle with exit code and cleanup
 * @throws RuntimeError RILL-R004 for spawn failures
 */
export function spawnClaudeCli(
  prompt: string,
  options: SpawnOptions = {}
): SpawnResult {
  const {
    binaryPath = 'claude',
    timeoutMs,
    cwd = process.cwd(),
    env = process.env,
  } = options;

  // Track timeout and process state
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  // Create promise for exit code
  let resolveExit: (code: number) => void;
  let rejectExit: (error: Error) => void;

  const exitCode = new Promise<number>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });

  // Spawn process
  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(
      binaryPath,
      [
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '--verbose',
      ],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd,
        env,
      }
    );
  } catch (error: unknown) {
    // Handle spawn errors
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;

      // EC-4: Binary not found
      if (code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R004',
          'claude binary not found',
          undefined,
          { binaryPath }
        );
      }

      // EC-5: Permission denied
      if (code === 'EACCES') {
        throw new RuntimeError(
          'RILL-R004',
          'Permission denied: claude',
          undefined,
          { binaryPath }
        );
      }

      // EC-6: Generic spawn failure
      throw new RuntimeError(
        'RILL-R004',
        `Failed to spawn claude binary: ${error.message}`,
        undefined,
        { binaryPath, originalError: error.message }
      );
    }

    // Unknown error type
    throw new RuntimeError(
      'RILL-R004',
      `Failed to spawn claude binary: Unknown error`,
      undefined,
      { binaryPath }
    );
  }

  // Set up timeout enforcement
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      if (!disposed) {
        disposed = true;
        ptyProcess.kill();
        rejectExit(
          new RuntimeError(
            'RILL-R004',
            `Claude CLI timeout after ${timeoutMs}ms`,
            undefined,
            { timeoutMs }
          )
        );
      }
    }, timeoutMs);
  }

  // Handle process exit
  ptyProcess.onExit((event) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!disposed) {
      disposed = true;
      const { exitCode: code } = event;

      // EC-9: Non-zero exit code
      if (code !== 0) {
        rejectExit(
          new RuntimeError(
            'RILL-R004',
            `Claude CLI exited with code ${code}`,
            undefined,
            { exitCode: code }
          )
        );
      } else {
        resolveExit(code);
      }
    }
  });

  // Write prompt to stdin and close
  try {
    ptyProcess.write(prompt);
    // Signal EOF by not writing more (PTY handles stdin closure differently)
  } catch (error: unknown) {
    // If write fails, clean up and throw
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    ptyProcess.kill();

    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new RuntimeError(
      'RILL-R004',
      `Failed to write prompt to claude process: ${message}`,
      undefined,
      { originalError: message }
    );
  }

  // Cleanup function
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // EC-16: Cleanup failure warning
    try {
      ptyProcess.kill();
    } catch (error: unknown) {
      // Log warning but don't throw
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to kill claude process during cleanup: ${message}`);
    }
  };

  return {
    ptyProcess,
    exitCode,
    dispose,
  };
}
