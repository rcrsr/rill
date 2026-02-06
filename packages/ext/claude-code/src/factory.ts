/**
 * Extension factory for Claude Code integration.
 * Creates extension instance with config validation and process lifecycle management.
 */

import which from 'which';
import {
  RuntimeError,
  emitExtensionEvent,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { ClaudeCodeConfig, ClaudeMessage } from './types.js';
import { spawnClaudeCli } from './process.js';
import { createStreamParser } from './stream-parser.js';
import { extractResult } from './result.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Active process tracker for cleanup.
 */
interface ProcessTracker {
  /** Active process cleanup functions */
  readonly disposers: Set<() => void>;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BINARY_PATH = 'claude';
const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 300000;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Serialize dict args to CLI flags for skill/command.
 * Boolean true values become flags without value, nested dicts use dot-notation.
 *
 * @param args - Dict of arguments to serialize
 * @returns Array of CLI flag strings
 */
function serializeArgsToFlags(args: Record<string, unknown>): string[] {
  const flags: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === true) {
      // Boolean true: flag without value
      flags.push(`--${key}`);
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Nested dict: dot-notation
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        flags.push(`--${key}.${nestedKey}`, String(nestedValue));
      }
    } else {
      // Other values: key-value pair
      flags.push(`--${key}`, String(value));
    }
  }

  return flags;
}

/**
 * Truncate text to max length for event logging.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 100)
 * @returns Truncated text with ellipsis if needed
 */
function truncateText(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate timeout is positive integer within bounds.
 *
 * @param timeout - Timeout in milliseconds
 * @throws Error if timeout invalid
 */
function validateTimeout(timeout: number): void {
  if (!Number.isInteger(timeout)) {
    throw new Error('Invalid timeout: must be positive integer, max 300000');
  }

  if (timeout <= 0) {
    throw new Error('Invalid timeout: must be positive integer, max 300000');
  }

  if (timeout > MAX_TIMEOUT) {
    throw new Error('Invalid timeout: must be positive integer, max 300000');
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Claude Code extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with prompt, skill, command functions and dispose
 * @throws Error for invalid configuration (EC-1, EC-2)
 *
 * @example
 * ```typescript
 * const ext = createClaudeCodeExtension({
 *   binaryPath: '/usr/local/bin/claude',
 *   defaultTimeout: 60000
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createClaudeCodeExtension(
  config: ClaudeCodeConfig = {}
): ExtensionResult {
  // Extract config with defaults
  const binaryPath = config.binaryPath ?? DEFAULT_BINARY_PATH;
  const defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;

  // Validate timeout immediately
  validateTimeout(defaultTimeout);

  // Validate binary path eagerly (sync throw if not in PATH)
  try {
    which.sync(binaryPath);
  } catch {
    throw new Error(`Binary not found: ${binaryPath}`);
  }

  // Track active processes for cleanup
  const tracker: ProcessTracker = {
    disposers: new Set(),
  };

  // Dispose function for cleanup
  const dispose = (): void => {
    // EC-16: Cleanup failure logs warning, doesn't throw
    for (const disposer of tracker.disposers) {
      try {
        disposer();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Failed to cleanup process: ${message}`);
      }
    }
    tracker.disposers.clear();
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-2: claude-code::prompt
    prompt: {
      params: [
        { name: 'text', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const text = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // EC-3: Validate text is non-empty
          if (text.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
          }

          // Extract timeout option
          const timeout =
            typeof options['timeout'] === 'number'
              ? options['timeout']
              : defaultTimeout;

          // Spawn process and collect messages
          const spawn = spawnClaudeCli(text, {
            binaryPath,
            timeoutMs: timeout,
          });

          // Register cleanup
          tracker.disposers.add(spawn.dispose);

          // Parse stream output
          const parser = createStreamParser();
          const messages: ClaudeMessage[] = [];

          spawn.ptyProcess.onData((chunk) => {
            parser.processChunk(chunk, (msg) => messages.push(msg));
          });

          // Wait for process completion
          try {
            await spawn.exitCode;
            parser.flush((msg) => messages.push(msg));
          } finally {
            tracker.disposers.delete(spawn.dispose);
            spawn.dispose();
          }

          // Extract result
          const result = extractResult(messages);

          // AC-17: Emit claude-code:prompt event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:prompt',
            subsystem: 'extension:claude-code',
            prompt: truncateText(text),
            duration,
          });

          // Convert to plain object literal for RillValue compatibility
          return {
            ...result,
            tokens: { ...result.tokens } as { [key: string]: RillValue },
          } as RillValue;
        } catch (error: unknown) {
          // AC-20: Emit claude-code:error event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:error',
            subsystem: 'extension:claude-code',
            error: error instanceof Error ? error.message : 'Unknown error',
            duration,
          });
          throw error;
        }
      },
      description:
        'Execute Claude Code prompt and return result text and token usage',
      returnType: 'dict',
    },

    // IR-3: claude-code::skill
    skill: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'args', type: 'dict', defaultValue: {} },
      ],
      fn: async (fnArgs, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const name = fnArgs[0] as string;
          const args = (fnArgs[1] ?? {}) as Record<string, unknown>;

          // EC-10: Validate name is non-empty
          if (name.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'skill name cannot be empty');
          }

          // Format input as /{name} {serialized args}
          const flags = serializeArgsToFlags(args);
          const flagsText = flags.length > 0 ? ' ' + flags.join(' ') : '';
          const prompt = `/${name}${flagsText}`;

          // Extract timeout option
          const timeout =
            typeof args['timeout'] === 'number'
              ? args['timeout']
              : defaultTimeout;

          // Spawn process
          const spawn = spawnClaudeCli(prompt, {
            binaryPath,
            timeoutMs: timeout,
          });

          tracker.disposers.add(spawn.dispose);

          // Parse stream output
          const parser = createStreamParser();
          const messages: ClaudeMessage[] = [];

          spawn.ptyProcess.onData((chunk) => {
            parser.processChunk(chunk, (msg) => messages.push(msg));
          });

          // Wait for process completion
          try {
            await spawn.exitCode;
            parser.flush((msg) => messages.push(msg));
          } finally {
            tracker.disposers.delete(spawn.dispose);
            spawn.dispose();
          }

          // Extract result
          const result = extractResult(messages);

          // AC-18: Emit claude-code:skill event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:skill',
            subsystem: 'extension:claude-code',
            name,
            args,
            duration,
          });

          // Convert to plain object literal for RillValue compatibility
          return {
            ...result,
            tokens: { ...result.tokens } as { [key: string]: RillValue },
          } as RillValue;
        } catch (error: unknown) {
          // AC-20: Emit claude-code:error event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:error',
            subsystem: 'extension:claude-code',
            error: error instanceof Error ? error.message : 'Unknown error',
            duration,
          });
          throw error;
        }
      },
      description:
        'Execute Claude Code skill with instruction and return structured result',
      returnType: 'dict',
    },

    // IR-4: claude-code::command
    command: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'args', type: 'dict', defaultValue: {} },
      ],
      fn: async (fnArgs, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const name = fnArgs[0] as string;
          const args = (fnArgs[1] ?? {}) as Record<string, unknown>;

          // EC-13: Validate name is non-empty
          if (name.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'command name cannot be empty');
          }

          // Format input similar to skill
          const flags = serializeArgsToFlags(args);
          const flagsText = flags.length > 0 ? ' ' + flags.join(' ') : '';
          const prompt = `/${name}${flagsText}`;

          // Extract timeout option
          const timeout =
            typeof args['timeout'] === 'number'
              ? args['timeout']
              : defaultTimeout;

          // Spawn process
          const spawn = spawnClaudeCli(prompt, {
            binaryPath,
            timeoutMs: timeout,
          });

          tracker.disposers.add(spawn.dispose);

          // Parse stream output
          const parser = createStreamParser();
          const messages: ClaudeMessage[] = [];

          spawn.ptyProcess.onData((chunk) => {
            parser.processChunk(chunk, (msg) => messages.push(msg));
          });

          // Wait for process completion
          try {
            await spawn.exitCode;
            parser.flush((msg) => messages.push(msg));
          } finally {
            tracker.disposers.delete(spawn.dispose);
            spawn.dispose();
          }

          // Extract result
          const result = extractResult(messages);

          // AC-19: Emit claude-code:command event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:command',
            subsystem: 'extension:claude-code',
            name,
            args,
            duration,
          });

          // Convert to plain object literal for RillValue compatibility
          return {
            ...result,
            tokens: { ...result.tokens } as { [key: string]: RillValue },
          } as RillValue;
        } catch (error: unknown) {
          // AC-20: Emit claude-code:error event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'claude-code:error',
            subsystem: 'extension:claude-code',
            error: error instanceof Error ? error.message : 'Unknown error',
            duration,
          });
          throw error;
        }
      },
      description:
        'Execute Claude Code command with task description and return execution summary',
      returnType: 'dict',
    },
  };

  // IR-5: Dispose function for process cleanup
  result.dispose = dispose;

  return result;
}
