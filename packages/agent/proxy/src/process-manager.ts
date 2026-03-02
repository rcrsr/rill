/**
 * ProcessManager: spawns child harness processes per request and manages
 * their lifecycle, timeout, and NDJSON protocol communication.
 *
 * IC-35: ProcessManager interface and createProcessManager factory.
 * IR-16: spawn(), active(), activeCount
 * IR-17: spawn sequence constraints
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type {
  StdioRunMessage,
  StdioRunResult,
  StdioAhiRequest,
} from '@rcrsr/rill-agent-shared';
import type { CatalogEntry } from './catalog.js';
import {
  ProxyError,
  PROXY_CHILD_CRASH,
  PROXY_TIMEOUT,
  PROXY_SPAWN_ERROR,
  PROXY_PROTOCOL_ERROR,
} from './errors.js';
import { parseChildLine, writeJsonLine } from './protocol.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface ActiveProcess {
  readonly pid: number;
  readonly agentName: string;
  readonly correlationId: string;
  readonly spawnedAt: number;
  readonly timeoutAt: number;
}

export interface ProcessManager {
  spawn(entry: CatalogEntry, message: StdioRunMessage): Promise<StdioRunResult>;
  active(): readonly ActiveProcess[];
  readonly activeCount: number;
}

// ============================================================
// INTERNAL CONSTANTS
// ============================================================

/** Milliseconds between SIGTERM and SIGKILL during timeout kill sequence. */
const SIGKILL_DELAY_MS = 5000;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a ProcessManager that spawns child harness processes.
 *
 * @param defaultTimeoutMs - Applied when message.timeout is 0 or missing.
 * @param ahiHandler - Called for each 'ahi' message received from child stdout.
 *   Injected to break circular dependency with the AHI mediator (task 4.6).
 */
export function createProcessManager(
  defaultTimeoutMs: number,
  ahiHandler: (child: ChildProcess, request: StdioAhiRequest) => Promise<void>
): ProcessManager {
  const activeMap = new Map<number, ActiveProcess>();

  async function spawnChild(
    entry: CatalogEntry,
    message: StdioRunMessage
  ): Promise<StdioRunResult> {
    const harnessPath = path.join(entry.bundlePath, 'harness.js');
    const timeoutMs = message.timeout > 0 ? message.timeout : defaultTimeoutMs;
    const spawnedAt = Date.now();
    const timeoutAt = spawnedAt + timeoutMs;

    // EC-13: spawn failure (ENOENT, permissions, etc.)
    let child: ChildProcess;
    try {
      child = spawn('node', [harnessPath], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    } catch (err) {
      throw new ProxyError(
        `Failed to spawn harness for agent "${entry.name}": ${String(err)}`,
        PROXY_SPAWN_ERROR,
        entry.name,
        String(err)
      );
    }

    const pid = child.pid;

    // EC-13: handle spawn errors emitted asynchronously (e.g. ENOENT)
    // We wrap the whole operation in a Promise that can be rejected early.
    return new Promise<StdioRunResult>((resolve, reject) => {
      // Register in active map once we have a PID.
      if (pid !== undefined) {
        const record: ActiveProcess = {
          pid,
          agentName: entry.name,
          correlationId: message.correlationId,
          spawnedAt,
          timeoutAt,
        };
        activeMap.set(pid, record);
      }

      let settled = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

      function settle(fn: () => void): void {
        if (settled) return;
        settled = true;
        if (sigkillTimer !== undefined) {
          clearTimeout(sigkillTimer);
        }
        if (pid !== undefined) {
          activeMap.delete(pid);
        }
        fn();
      }

      // Timeout: SIGTERM after timeoutMs, SIGKILL 5 s later.
      const timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        sigkillTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, SIGKILL_DELAY_MS);
        settle(() =>
          reject(
            new ProxyError(
              `Agent "${entry.name}" timed out after ${timeoutMs}ms`,
              PROXY_TIMEOUT,
              entry.name
            )
          )
        );
      }, timeoutMs);

      // PROXY_SPAWN_ERROR: the OS could not find or exec the node binary itself
      // (e.g. ENOENT on spawn). This fires before the process ever starts.
      // PROXY_CHILD_CRASH: node started successfully but the script exited with
      // a non-zero code (or no result). That is handled in the 'close' handler.
      child.once('error', (err: Error) => {
        clearTimeout(timeoutTimer);
        settle(() =>
          reject(
            new ProxyError(
              `Spawn error for agent "${entry.name}": ${err.message}`,
              PROXY_SPAWN_ERROR,
              entry.name,
              err.message
            )
          )
        );
      });

      // Write StdioRunMessage to child stdin then end stdin.
      if (child.stdin) {
        writeJsonLine(child.stdin, message);
        child.stdin.end();
      }

      let runResult: StdioRunResult | undefined;

      if (!child.stdout) {
        clearTimeout(timeoutTimer);
        settle(() =>
          reject(
            new ProxyError(
              `Child stdout unavailable for agent "${entry.name}"`,
              PROXY_SPAWN_ERROR,
              entry.name
            )
          )
        );
        return;
      }

      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        if (!line.trim()) return;

        // EC-14: line looks like JSON but fails to parse → protocol error.
        const looksLikeJson = line.trimStart().startsWith('{');
        const parsed = parseChildLine(line);

        if (looksLikeJson && parsed === null) {
          clearTimeout(timeoutTimer);
          rl.close();
          child.kill('SIGTERM');
          settle(() =>
            reject(
              new ProxyError(
                `Invalid NDJSON from child for agent "${entry.name}": ${line}`,
                PROXY_PROTOCOL_ERROR,
                entry.name,
                line
              )
            )
          );
          return;
        }

        if (parsed === null) {
          // AC-64: non-JSON stdout line — silently ignore.
          return;
        }

        if (parsed.method === 'run.result') {
          runResult = parsed as StdioRunResult;
          return;
        }

        if (parsed.method === 'ahi') {
          // Delegate to injected AHI handler; errors are non-fatal for the
          // outer promise (the handler writes its own ahi.result to stdin).
          ahiHandler(child, parsed as StdioAhiRequest).catch((err: unknown) => {
            process.stderr.write(
              `[process-manager] ahi handler error: ${String(err)}\n`
            );
          });
        }
      });

      // Child exit: resolve with result or reject with crash error.
      child.once('close', (code: number | null) => {
        clearTimeout(timeoutTimer);
        rl.close();

        if (settled) return;

        if (runResult !== undefined) {
          settle(() => resolve(runResult as StdioRunResult));
          return;
        }

        // EC-10: child exited with no result.
        settle(() =>
          reject(
            new ProxyError(
              `Agent "${entry.name}" process exited with code ${String(code)} without returning a result`,
              PROXY_CHILD_CRASH,
              entry.name,
              `exit code: ${String(code)}`
            )
          )
        );
      });
    });
  }

  return {
    spawn: spawnChild,

    active(): readonly ActiveProcess[] {
      return Array.from(activeMap.values());
    },

    get activeCount(): number {
      return activeMap.size;
    },
  };
}
