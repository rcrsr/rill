/**
 * Execution module for Rill Fiddle
 *
 * Provides executeRill and formatResult functions for running Rill code
 * and formatting execution results.
 */

import {
  parse,
  createRuntimeContext,
  execute,
  isCallable,
  type RillValue,
  type ScriptNode,
} from '@rcrsr/rill';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Structured error from failed execution
 */
export interface FiddleError {
  /** Human-readable error message */
  message: string;
  /** Error classification from RillError */
  category: 'lexer' | 'parse' | 'runtime';
  /** Source line number (1-based) from SourceLocation */
  line: number | null;
  /** Source column number (1-based) from SourceLocation */
  column: number | null;
  /** Rill error ID (e.g., "RILL-L001") */
  errorId: string | null;
}

/**
 * Execution state for Rill Fiddle
 */
export interface ExecutionState {
  /** Current execution status */
  status: 'idle' | 'running' | 'success' | 'error';
  /** Formatted output from successful execution */
  result: string | null;
  /** Structured error from failed execution */
  error: FiddleError | null;
  /** Execution time in milliseconds */
  duration: number | null;
}

// ============================================================
// EXECUTION
// ============================================================

/**
 * Execute Rill source code and return structured result.
 *
 * Pipeline: parse() → createRuntimeContext() → execute()
 *
 * @param source - Rill source code to execute
 * @returns ExecutionState with result or error
 */
export async function executeRill(source: string): Promise<ExecutionState> {
  // EC-5: Empty source returns idle status
  if (!source.trim()) {
    return {
      status: 'idle',
      result: null,
      error: null,
      duration: null,
    };
  }

  const startTime = performance.now();
  const logs: string[] = [];

  try {
    // Parse source via @rcrsr/rill
    const ast: ScriptNode = parse(source);

    // Create runtime context with log capture and timeout
    const ctx = createRuntimeContext({
      callbacks: {
        onLog: (value: RillValue) => {
          logs.push(formatResult(value));
        },
      },
      timeout: 5000, // 5 second default timeout
    });

    // Execute AST
    const executionResult = await execute(ast, ctx);
    const duration = performance.now() - startTime;

    // Format result: logs + final value
    const formattedValue = formatResult(executionResult.value);
    const result =
      logs.length > 0
        ? `${logs.join('\n')}\n${formattedValue}`
        : formattedValue;

    return {
      status: 'success',
      result,
      error: null,
      duration,
    };
  } catch (err) {
    const duration = performance.now() - startTime;

    // Convert error to FiddleError
    const fiddleError = convertError(err);

    return {
      status: 'error',
      result: null,
      error: fiddleError,
      duration,
    };
  }
}

/**
 * Convert thrown error to FiddleError structure
 */
function convertError(err: unknown): FiddleError {
  // EC-1, EC-2, EC-3: RillError hierarchy (LexerError, ParseError, RuntimeError)
  if (isRillError(err)) {
    return {
      message: err.message,
      category: getErrorCategory(err.name),
      line: err.location?.line ?? null,
      column: err.location?.column ?? null,
      errorId: err.errorId,
    };
  }

  // EC-4: Unexpected error (non-Rill errors)
  return {
    message: err instanceof Error ? err.message : String(err),
    category: 'runtime',
    line: null,
    column: null,
    errorId: null,
  };
}

/**
 * Type guard for RillError instances
 */
function isRillError(err: unknown): err is RillErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'errorId' in err &&
    'name' in err &&
    'message' in err
  );
}

/**
 * RillError-like interface for type checking
 */
interface RillErrorLike {
  errorId: string;
  name: string;
  message: string;
  location?: {
    line: number;
    column: number;
    offset: number;
  };
}

/**
 * Map error class name to category
 */
function getErrorCategory(name: string): 'lexer' | 'parse' | 'runtime' {
  if (name === 'LexerError') return 'lexer';
  if (name === 'ParseError') return 'parse';
  return 'runtime';
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Convert execution result to display string.
 *
 * Based on formatOutput from packages/cli/src/cli-shared.ts:22-30
 *
 * @param value - RillValue to format
 * @returns Formatted string representation
 */
export function formatResult(value: RillValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isCallable(value)) return '[closure]';
  return JSON.stringify(value, null, 2);
}
