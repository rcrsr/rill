/**
 * Execution module for Rill Fiddle
 *
 * Provides executeRill for running Rill code and returning structured results.
 */

import {
  parse,
  createRuntimeContext,
  execute,
  toNative,
  ERROR_REGISTRY,
  formatHalt,
  getCallStack,
  getHelpUrl,
  getStatus,
  isInvalid,
  atomName,
  RuntimeHaltSignal,
  VERSION,
  type RillValue,
  type ScriptNode,
  type SchemeResolver,
  type RuntimeOptions,
  type RillFunction,
  type TraceFrame,
} from '@rcrsr/rill';
import { EXECUTION_TIMEOUT_MS } from './constants.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Structured error from failed execution
 */
/** A single frame in the call stack */
export interface FiddleCallFrame {
  /** Source line number (1-based) */
  line: number;
  /** Source column number (1-based) */
  column: number;
  /** Source text of the line (if available) */
  sourceLine?: string | undefined;
}

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
  /** Help URL for error documentation */
  helpUrl?: string | undefined;
  /** Root cause explanation from ERROR_REGISTRY */
  cause?: string | undefined;
  /** Resolution steps from ERROR_REGISTRY */
  resolution?: string | undefined;
  /** Code examples from ERROR_REGISTRY */
  examples?: Array<{ description: string; code: string }> | undefined;
  /** Call stack frames (callers of the error site) */
  callStack?: FiddleCallFrame[] | undefined;
  /** Bare atom name from .!code (no # sigil); null when not an invalid-value halt */
  statusCode: string | null;
  /** .!message text; null when not an invalid-value halt */
  statusMessage: string | null;
  /** .!provider text; null when not an invalid-value halt */
  statusProvider: string | null;
  /** .!trace frames (origin first); null when not an invalid-value halt */
  statusTrace: TraceFrame[] | null;
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
  /** Log messages from log() calls (ordered) */
  logs: string[];
}

/**
 * Resolver configuration for Fiddle execution.
 *
 * Permits "ext", "host", and "context" schemes. Must NOT include "module" —
 * Fiddle is a single-file environment with no module resolver.
 */
export interface FiddleResolverConfig {
  /** Scheme-to-resolver map (e.g. "ext", "host") */
  resolvers: Record<string, SchemeResolver>;
  /** Per-scheme configuration data passed to each resolver */
  configurations: { resolvers: Record<string, unknown> };
  /** Host functions exposed to scripts (e.g. "ext::fn") */
  functions?: Record<string, RillFunction> | undefined;
}

// ============================================================
// EXECUTION
// ============================================================

/**
 * Build RuntimeOptions for Fiddle execution.
 *
 * Always includes callbacks.onLog and timeout from EXECUTION_TIMEOUT_MS.
 * Merges resolvers and configurations from resolverConfig when provided.
 * When resolverConfig is undefined, returns options identical to pre-use<> behavior.
 * Sets checkerMode: 'permissive'.
 *
 * @param logs - Mutable array that onLog appends to
 * @param resolverConfig - Optional resolver wiring; omit for pre-use<> behavior
 */
export function buildFiddleRuntimeOptions(
  logs: string[],
  resolverConfig?: FiddleResolverConfig
): RuntimeOptions {
  const base: RuntimeOptions = {
    callbacks: {
      onLog: (value: string) => {
        logs.push(value);
      },
    },
    timeout: EXECUTION_TIMEOUT_MS,
    checkerMode: 'permissive',
  };

  if (resolverConfig === undefined) {
    return base;
  }

  return {
    ...base,
    resolvers: resolverConfig.resolvers,
    configurations: resolverConfig.configurations,
    ...(resolverConfig.functions !== undefined && {
      functions: resolverConfig.functions,
    }),
  };
}

/**
 * Execute Rill source code and return structured result.
 *
 * Pipeline: parse() → createRuntimeContext() → execute()
 *
 * @param source - Rill source code to execute
 * @param resolverConfig - Optional resolver wiring for use<> expressions
 * @returns ExecutionState with result or error
 */
export async function executeRill(
  source: string,
  resolverConfig?: FiddleResolverConfig
): Promise<ExecutionState> {
  // EC-5: Empty source returns idle status
  if (!source.trim()) {
    return {
      status: 'idle',
      result: null,
      error: null,
      duration: null,
      logs: [],
    };
  }

  const startTime = performance.now();
  const logs: string[] = [];

  try {
    // Parse source via @rcrsr/rill
    const ast: ScriptNode = parse(source);

    // Create runtime context with log capture, timeout, and optional resolvers
    const ctx = createRuntimeContext(
      buildFiddleRuntimeOptions(logs, resolverConfig)
    );

    // Execute AST
    const executionResult = await execute(ast, ctx);
    const duration = performance.now() - startTime;

    // Route invalid final-value results to the error path (AC-FDL-6)
    if (isInvalid(executionResult.result)) {
      return {
        status: 'error',
        result: null,
        error: convertInvalidValue(executionResult.result),
        duration,
        logs,
      };
    }

    const nativeResult = toNative(executionResult.result);

    return {
      status: 'success',
      result: JSON.stringify(nativeResult, null, 2),
      error: null,
      duration,
      logs,
    };
  } catch (err) {
    const duration = performance.now() - startTime;

    // Convert error to FiddleError (pass source for call stack line lookup)
    const fiddleError = convertError(err, source);

    return {
      status: 'error',
      result: null,
      error: fiddleError,
      duration,
      logs,
    };
  }
}

/**
 * Convert thrown error to FiddleError structure
 */
function convertError(err: unknown, source?: string): FiddleError {
  // EC-1, EC-2, EC-3: RillError hierarchy (LexerError, ParseError, RuntimeError)
  if (isRillError(err)) {
    const basicError: FiddleError = {
      message: err.message,
      category: getErrorCategory(err.name),
      line: err.location?.line ?? null,
      column: err.location?.column ?? null,
      errorId: err.errorId,
      statusCode: null,
      statusMessage: null,
      statusProvider: null,
      statusTrace: null,
    };

    // Extract call stack frames, deduplicating the primary error location
    const callStack = extractCallStack(err, source);
    if (callStack.length > 0) {
      basicError.callStack = callStack;
    }

    // Enrich with metadata from ERROR_REGISTRY if available
    if (err.errorId) {
      const definition = ERROR_REGISTRY.get(err.errorId);
      if (definition) {
        return {
          ...basicError,
          helpUrl: getHelpUrl(err.errorId, VERSION),
          cause: definition.cause,
          resolution: definition.resolution,
          examples: definition.examples,
        };
      }
    }

    return basicError;
  }

  // EC-RHS: RuntimeHaltSignal escaping unguarded execution
  if (err instanceof RuntimeHaltSignal) {
    return convertInvalidValue(err.value);
  }

  // EC-4: Unexpected error (non-Rill errors)
  return {
    message: err instanceof Error ? err.message : String(err),
    category: 'runtime',
    line: null,
    column: null,
    errorId: null,
    statusCode: null,
    statusMessage: null,
    statusProvider: null,
    statusTrace: null,
  };
}

/**
 * Convert an invalid final RillValue to a FiddleError.
 *
 * Uses formatHalt for the message body and getStatus (exported from
 * @rcrsr/rill) for the structured status fields.
 */
function convertInvalidValue(value: RillValue): FiddleError {
  const status = getStatus(value);
  const haltText = formatHalt(value);
  const invalid = isInvalid(value);

  return {
    message: haltText,
    category: 'runtime',
    line: null,
    column: null,
    errorId: null,
    statusCode: invalid ? atomName(status.code) : null,
    statusMessage: invalid ? status.message : null,
    statusProvider: invalid ? status.provider : null,
    statusTrace: invalid ? (status.trace as TraceFrame[]) : null,
  };
}

/**
 * Extract call stack frames from a RillError, resolving source lines.
 * Filters out frames that duplicate the primary error location.
 */
function extractCallStack(
  err: RillErrorLike,
  source?: string
): FiddleCallFrame[] {
  // getCallStack requires an actual RillError instance with context
  if (!err || typeof err !== 'object' || !('context' in err)) return [];

  let frames;
  try {
    frames = getCallStack(err as Parameters<typeof getCallStack>[0]);
  } catch {
    return [];
  }

  if (frames.length === 0) return [];

  const sourceLines = source?.split('\n');

  return frames
    .filter((frame) => {
      // Deduplicate frames matching the primary error location
      if (!err.location) return true;
      const loc = frame.location.start;
      return (
        loc.line !== err.location.line || loc.column !== err.location.column
      );
    })
    .map((frame) => {
      const loc = frame.location.start;
      const result: FiddleCallFrame = {
        line: loc.line,
        column: loc.column,
      };
      if (sourceLines) {
        const idx = loc.line - 1;
        if (idx >= 0 && idx < sourceLines.length) {
          result.sourceLine = sourceLines[idx];
        }
      }
      return result;
    });
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
