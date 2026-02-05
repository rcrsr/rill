/**
 * CLI Shared Utilities
 * Common formatting functions for CLI tools
 */

import { isCallable, VERSION } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { ParseError, RuntimeError } from '@rcrsr/rill';
import { LexerError } from '@rcrsr/rill';
import { enrichError, type ScopeInfo } from './cli-error-enrichment.js';
import {
  formatError as formatEnrichedError,
  type FormatOptions,
} from './cli-error-formatter.js';

/**
 * Convert execution result to human-readable string
 *
 * @param value - The value to format
 * @returns Formatted string representation
 */
export function formatOutput(value: RillValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isCallable(value)) return '[closure]';
  return JSON.stringify(value, null, 2);
}

/**
 * Format error for stderr output
 *
 * When source is available, uses enrichment pipeline to add source snippets and suggestions.
 * Otherwise, falls back to simple formatting for backward compatibility.
 *
 * @param err - The error to format
 * @param source - Optional source code for enrichment
 * @param options - Optional format options (defaults to human format)
 * @param scope - Optional scope information for suggestions
 * @returns Formatted error message
 */
export function formatError(
  err: Error,
  source?: string,
  options?: Partial<FormatOptions>,
  scope?: ScopeInfo
): string {
  // IC-12: Use enrichment pipeline when source is available and error is RillError
  if (
    source !== undefined &&
    (err instanceof LexerError ||
      err instanceof ParseError ||
      err instanceof RuntimeError)
  ) {
    try {
      const enriched = enrichError(err, source, scope);
      const formatOpts: FormatOptions = {
        format: options?.format ?? 'human',
        verbose: options?.verbose ?? false,
        includeCallStack: options?.includeCallStack ?? false,
        maxCallStackDepth: options?.maxCallStackDepth ?? 10,
      };
      return formatEnrichedError(enriched, formatOpts);
    } catch {
      // If enrichment fails, fall back to simple formatting
    }
  }

  // IC-12: Fallback to existing behavior for backward compatibility
  if (err instanceof LexerError) {
    const location = err.location;
    return `Lexer error at line ${location.line}: ${err.message.replace(/ at \d+:\d+$/, '')}`;
  }

  if (err instanceof ParseError) {
    const location = err.location;
    if (location) {
      return `Parse error at line ${location.line}: ${err.message.replace(/ at \d+:\d+$/, '')}`;
    }
    return `Parse error: ${err.message}`;
  }

  if (err instanceof RuntimeError) {
    const location = err.location;
    const baseMessage = err.message.replace(/ at \d+:\d+$/, '');
    if (location) {
      return `Runtime error at line ${location.line}: ${baseMessage}`;
    }
    return `Runtime error: ${baseMessage}`;
  }

  // Handle file not found errors (ENOENT)
  if (
    err instanceof Error &&
    'code' in err &&
    err.code === 'ENOENT' &&
    'path' in err
  ) {
    return `File not found: ${err.path}`;
  }

  // Handle module errors
  if (err.message.includes('Cannot find module')) {
    return `Module error: ${err.message}`;
  }

  return err.message;
}

/**
 * Determine exit code from script result
 *
 * Implements exit code semantics per language spec:
 * - true / non-empty string: exit 0
 * - false / empty string: exit 1
 * - [0, "message"]: exit 0 with message
 * - [1, "message"]: exit 1 with message
 *
 * @param value - The script return value
 * @returns Exit code and optional message
 */
export function determineExitCode(value: RillValue): {
  code: number;
  message?: string;
} {
  // Handle tuple format: [code, message]
  if (Array.isArray(value)) {
    if (value.length >= 2) {
      const code = value[0];
      const message = value[1];

      // Validate code is 0 or 1
      if (typeof code === 'number' && (code === 0 || code === 1)) {
        // Return with message if provided as string
        if (typeof message === 'string' && message !== '') {
          return { code, message };
        }
        return { code };
      }
    }
    // Non-conforming array: treat as truthy (exit 0)
    return { code: 0 };
  }

  // Boolean values
  if (typeof value === 'boolean') {
    return { code: value ? 0 : 1 };
  }

  // String values
  if (typeof value === 'string') {
    return { code: value === '' ? 1 : 0 };
  }

  // All other values (number, dict, closure, etc.) are truthy: exit 0
  return { code: 0 };
}

/**
 * Detect help or version flags in CLI argument array.
 * Checks for --help, -h, --version, -v in any position.
 *
 * @param argv - Command-line arguments (process.argv.slice(2))
 * @returns Object with mode if flag found, null otherwise
 */
export function detectHelpVersionFlag(
  argv: string[]
): { mode: 'help' | 'version' } | null {
  // Help takes precedence over version
  if (argv.includes('--help') || argv.includes('-h')) {
    return { mode: 'help' };
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    return { mode: 'version' };
  }
  return null;
}

/**
 * Package version string (re-exported from version-data.ts)
 *
 * This replaces the previous async readVersion() function with a synchronous constant.
 * The version is now generated at build time by packages/core/scripts/generate-version.ts.
 */
export { VERSION };
