/**
 * exec Extension Runner
 *
 * Handles process spawning with argument validation and security controls.
 * Uses child_process.execFile() for shell injection prevention.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RuntimeError } from '../../error-classes.js';

const execFileAsync = promisify(execFile);

// ============================================================
// TYPES
// ============================================================

/** Command configuration with security controls */
export interface CommandConfig {
  /** Binary executable path */
  readonly binary: string;
  /** Optional timeout in milliseconds */
  readonly timeout?: number | undefined;
  /** Optional output size limit in bytes */
  readonly maxBuffer?: number | undefined;
  /** Allowed arguments (allowlist mode) */
  readonly allowedArgs?: readonly string[] | undefined;
  /** Blocked arguments (blocklist mode) */
  readonly blockedArgs?: readonly string[] | undefined;
  /** Working directory for command execution */
  readonly cwd?: string | undefined;
  /** Environment variables for command */
  readonly env?: Record<string, string> | undefined;
  /** Whether command accepts stdin */
  readonly stdin?: boolean | undefined;
  /** Optional description for introspection */
  readonly description?: string | undefined;
}

/** Command execution result */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate arguments against allowlist/blocklist rules.
 *
 * @param args - Command arguments to validate
 * @param config - Command configuration with security rules
 * @param commandName - Command name for error messages
 * @throws RuntimeError RILL-R004 if validation fails
 */
function validateArgs(
  args: readonly string[],
  config: CommandConfig,
  commandName: string
): void {
  const { allowedArgs, blockedArgs } = config;

  // Allowlist mode: every arg must be in allowedArgs
  if (allowedArgs !== undefined) {
    for (const arg of args) {
      if (!allowedArgs.includes(arg)) {
        // EC-14: Arg not in allowlist
        throw new RuntimeError(
          'RILL-R004',
          `arg "${arg}" not permitted for command "${commandName}"`,
          undefined,
          { commandName, arg, allowedArgs }
        );
      }
    }
  }

  // Blocklist mode: no arg can be in blockedArgs
  if (blockedArgs !== undefined) {
    for (const arg of args) {
      if (blockedArgs.includes(arg)) {
        // EC-15: Arg in blocklist
        throw new RuntimeError(
          'RILL-R004',
          `arg "${arg}" is blocked for command "${commandName}"`,
          undefined,
          { commandName, arg, blockedArgs }
        );
      }
    }
  }
}

/**
 * Check if stdin is supported by the command.
 *
 * @param config - Command configuration
 * @param commandName - Command name for error messages
 * @param hasStdin - Whether stdin was provided
 * @throws RuntimeError RILL-R004 if stdin not supported but provided
 */
function validateStdin(
  config: CommandConfig,
  commandName: string,
  hasStdin: boolean
): void {
  if (hasStdin && !config.stdin) {
    // EC-19: stdin not supported
    throw new RuntimeError(
      'RILL-R004',
      `command "${commandName}" does not support stdin`,
      undefined,
      { commandName }
    );
  }
}

// ============================================================
// EXECUTION
// ============================================================

/**
 * Execute command with process spawning and security controls.
 *
 * Uses execFile() to prevent shell injection attacks.
 * Validates arguments against allowlist/blocklist rules.
 * Returns stdout, stderr, and exit code (non-zero exit is not an error).
 *
 * @param commandName - Command name for error messages
 * @param config - Command configuration with security rules
 * @param args - Command arguments
 * @param stdinData - Optional stdin data
 * @param signal - Optional AbortSignal for cancellation
 * @returns Command result with stdout, stderr, and exitCode
 * @throws RuntimeError RILL-R004 for validation failures
 * @throws RuntimeError RILL-R012 for timeout
 * @throws RuntimeError RILL-R004 for output size limit exceeded
 * @throws RuntimeError RILL-R004 for binary not found
 *
 * @example
 * ```typescript
 * const result = await runCommand('git', {
 *   binary: 'git',
 *   allowedArgs: ['status', '--short']
 * }, ['status', '--short']);
 * // Returns: { stdout: "...", stderr: "", exitCode: 0 }
 * ```
 */
export async function runCommand(
  commandName: string,
  config: CommandConfig,
  args: readonly string[],
  stdinData?: string | undefined,
  signal?: AbortSignal | undefined
): Promise<CommandResult> {
  // Validate arguments against security rules
  validateArgs(args, config, commandName);

  // Validate stdin support
  validateStdin(config, commandName, stdinData !== undefined);

  // Prepare execFile options
  const options: {
    timeout?: number;
    maxBuffer?: number;
    encoding: 'utf8';
    input?: string;
    cwd?: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
  } = {
    encoding: 'utf8',
  };

  if (config.timeout !== undefined) {
    options.timeout = config.timeout;
  }

  if (config.maxBuffer !== undefined) {
    options.maxBuffer = config.maxBuffer;
  }

  // Add cwd if provided
  if (config.cwd !== undefined) {
    options.cwd = config.cwd;
  }

  // Add env if provided
  if (config.env !== undefined) {
    options.env = config.env;
  }

  // Add stdin data if provided
  if (stdinData !== undefined) {
    options.input = stdinData;
  }

  // Add abort signal if provided
  if (signal !== undefined) {
    options.signal = signal;
  }

  try {
    // Execute command using execFile (no shell interpolation)
    const { stdout, stderr } = await execFileAsync(
      config.binary,
      args as string[],
      options
    );

    return {
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      exitCode: 0,
    };
  } catch (err: unknown) {
    // Handle execution errors
    if (err && typeof err === 'object') {
      const execError = err as {
        code?: string;
        killed?: boolean;
        signal?: string | null;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      // EC-16: Binary not found
      if (execError.code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R004',
          `binary not found: ${config.binary}`,
          undefined,
          { commandName, binary: config.binary }
        );
      }

      // EC-18: Output exceeds limit (check multiple conditions)
      const isMaxBufferError =
        execError.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER' ||
        execError.code === 'ERR_CHILD_PROCESS_STDERR_MAXBUFFER' ||
        (execError.message &&
          execError.message.toLowerCase().includes('maxbuffer')) ||
        (execError.killed === true &&
          execError.signal === 'SIGTERM' &&
          config.maxBuffer !== undefined);

      if (isMaxBufferError) {
        throw new RuntimeError(
          'RILL-R004',
          `command output exceeds size limit`,
          undefined,
          { commandName, maxBuffer: config.maxBuffer }
        );
      }

      // EC-17: Timeout (must check after maxBuffer to avoid confusion)
      if (execError.killed === true && execError.signal === 'SIGTERM') {
        const timeoutMs = config.timeout || 0;
        throw new RuntimeError(
          'RILL-R012',
          `command "${commandName}" timed out (${timeoutMs}ms)`,
          undefined,
          { commandName, timeoutMs }
        );
      }

      // Non-zero exit code: return as CommandResult (not an error)
      if ('stdout' in execError && 'stderr' in execError) {
        // Extract exit code from error
        const exitCode =
          'code' in err && typeof (err as { code: unknown }).code === 'number'
            ? ((err as { code: number }).code as number)
            : 1;

        return {
          stdout: String(execError.stdout || ''),
          stderr: String(execError.stderr || ''),
          exitCode,
        };
      }
    }

    // Unknown error: re-throw
    throw err;
  }
}
