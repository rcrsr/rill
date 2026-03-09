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
  getHelpUrl,
  VERSION,
  type ScriptNode,
  type SchemeResolver,
  type RuntimeOptions,
  type RillFunction,
  type RillFunctionSignature,
} from '@rcrsr/rill';
import { EXECUTION_TIMEOUT_MS } from './constants.js';

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
  /** Help URL for error documentation */
  helpUrl?: string | undefined;
  /** Root cause explanation from ERROR_REGISTRY */
  cause?: string | undefined;
  /** Resolution steps from ERROR_REGISTRY */
  resolution?: string | undefined;
  /** Code examples from ERROR_REGISTRY */
  examples?: Array<{ description: string; code: string }> | undefined;
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
 * Permits "ext" and "host" schemes. Must NOT include "module" —
 * Fiddle is a single-file environment with no module resolver.
 */
export interface FiddleResolverConfig {
  /** Scheme-to-resolver map (e.g. "ext", "host") */
  resolvers: Record<string, SchemeResolver>;
  /** Per-scheme configuration data passed to each resolver */
  configurations: { resolvers: Record<string, unknown> };
  /** Host functions exposed to scripts (e.g. "ext::fn") */
  functions?: Record<string, RillFunction | RillFunctionSignature> | undefined;
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

    // Convert error to FiddleError
    const fiddleError = convertError(err);

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
function convertError(err: unknown): FiddleError {
  // EC-1, EC-2, EC-3: RillError hierarchy (LexerError, ParseError, RuntimeError)
  if (isRillError(err)) {
    const basicError: FiddleError = {
      message: err.message,
      category: getErrorCategory(err.name),
      line: err.location?.line ?? null,
      column: err.location?.column ?? null,
      errorId: err.errorId,
    };

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
