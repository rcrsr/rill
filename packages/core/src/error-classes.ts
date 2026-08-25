/**
 * Rill Error Classes and Factory
 * Structured error types with registry-based error codes
 */

import type { SourceLocation, SourceSpan } from './source-location.js';
import {
  ERROR_REGISTRY,
  renderMessage,
  getHelpUrl,
  ERROR_IDS,
} from './error-registry.js';
import { VERSION } from './generated/version-data.js';

// ============================================================
// CALL FRAME
// ============================================================

/**
 * Call stack frame information for error reporting.
 * Represents a single frame in the call stack with location and context.
 */
export interface CallFrame {
  /** Source location of the call */
  readonly location: SourceSpan;
  /** Name of the function (closure or host function) */
  readonly functionName?: string | undefined;
  /** Additional context (e.g., "in each body") */
  readonly context?: string | undefined;
  /** Source identifier for cross-module call stacks (e.g. file path or "module:greetings") */
  readonly sourceId?: string | undefined;
}

// ============================================================
// ERROR DATA
// ============================================================

/** Structured error data for host applications */
export interface RillErrorData {
  readonly errorId: string;
  readonly helpUrl?: string | undefined;
  readonly message: string;
  readonly location?: SourceLocation | undefined;
  readonly span?: SourceSpan | undefined;
  readonly context?: Record<string, unknown> | undefined;
  /** Identifies the source that produced this error (e.g. "module:greetings") */
  readonly sourceId?: string | undefined;
}

// ============================================================
// ERROR FACTORY
// ============================================================

/**
 * Factory function for creating errors from registry.
 *
 * Looks up error definition from registry, renders message template with context,
 * and creates RillError with structured metadata.
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit})
 * @param context - Key-value pairs for template placeholder replacement
 * @param location - Source location where error occurred (optional)
 * @returns RillError instance with rendered message
 * @throws TypeError if errorId is not found in registry
 *
 * @example
 * createError("RILL-R005", { name: "foo" }, location)
 * // Creates RuntimeError: "Variable foo is not defined at 1:5"
 *
 * @example
 * createError("RILL-X999", {})
 * // Throws: TypeError("Unknown error ID: RILL-X999")
 */
export function createError(
  errorId: string,
  context: Record<string, unknown>,
  location?: SourceLocation | undefined
): RillError {
  // Lookup error definition from registry (O(1))
  const definition = ERROR_REGISTRY.get(errorId);

  // Unknown errorId -> Throws TypeError
  if (!definition) {
    throw new TypeError(`Unknown error ID: ${errorId}`);
  }

  // Render message from template + context (O(n) where n = template length)
  // Context value fails String() coercion -> Uses fallback "[object Object]"
  // This is handled inside renderMessage via try-catch
  const message = renderMessage(definition.messageTemplate, context);

  // Malformed location (missing line/column) -> Error created without location metadata
  // We accept the location as-is; if it's malformed, the error won't have proper location data
  // This is acceptable per spec - the error is still created, just without complete location info

  // Compute helpUrl from errorId using VERSION constant
  const helpUrl = getHelpUrl(errorId, VERSION);

  // Create RillError with errorId, helpUrl, and rendered message
  return new RillError({
    errorId,
    helpUrl: helpUrl || undefined, // Convert empty string to undefined
    message,
    location,
    context,
  });
}

// ============================================================
// BASE ERROR CLASS
// ============================================================

/**
 * Base error class for all Rill errors.
 * Provides structured data for host applications to format as needed.
 */
export class RillError extends Error {
  readonly errorId: string;
  readonly helpUrl: string | undefined;
  readonly location?: SourceLocation | undefined;
  readonly span?: SourceSpan | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly sourceId?: string | undefined;

  constructor(data: RillErrorData) {
    // Missing errorId
    if (!data.errorId) {
      throw new TypeError('errorId is required');
    }

    // Unknown errorId
    if (!ERROR_REGISTRY.has(data.errorId)) {
      throw new TypeError(`Unknown error ID: ${data.errorId}`);
    }

    const location = data.location ?? data.span?.start;
    const span =
      data.span ?? (location ? { start: location, end: location } : undefined);
    const locationStr = location
      ? ` at ${location.line}:${location.column}`
      : '';
    super(`${data.message}${locationStr}`);
    this.name = 'RillError';
    this.errorId = data.errorId;
    this.helpUrl = data.helpUrl;
    this.location = location;
    this.span = span;
    this.context = data.context;
    this.sourceId = data.sourceId;
  }

  /** Get structured error data for custom formatting */
  toData(): RillErrorData {
    return {
      errorId: this.errorId,
      helpUrl: this.helpUrl,
      message: this.message.replace(/ at \d+:\d+$/, ''), // Strip location suffix
      location: this.location,
      span: this.span,
      context: this.context,
      sourceId: this.sourceId,
    };
  }

  /** Format error for display (can be overridden by host) */
  format(formatter?: (data: RillErrorData) => string): string {
    if (formatter) return formatter(this.toData());
    return this.message;
  }

  /**
   * Return a new error instance of the same prototype with `patch` merged
   * into its context. Does not mutate `this`; the original context object
   * is not shared with the returned instance.
   */
  withContext(patch: Record<string, unknown>): RillError {
    const clone = Object.create(Object.getPrototypeOf(this)) as RillError;
    Object.assign(clone, this);
    // `message` and `stack` are non-enumerable own properties on Error
    // instances in V8, so Object.assign does not copy them; restore both
    // explicitly.
    clone.message = this.message;
    if (this.stack !== undefined) {
      clone.stack = this.stack;
    }
    (clone as { context: Record<string, unknown> | undefined }).context = {
      ...this.context,
      ...patch,
    };
    return clone;
  }
}

// ============================================================
// SPECIALIZED ERROR CLASSES
// ============================================================

/** Parse-time errors */
export class ParseError extends RillError {
  constructor(
    errorId: string,
    message: string,
    location: SourceLocation,
    context?: Record<string, unknown>
  ) {
    // Unknown errorId
    const definition = ERROR_REGISTRY.get(errorId);
    if (!definition) {
      throw new TypeError(`Unknown error ID: ${errorId}`);
    }

    // Wrong category
    if (definition.category !== 'parse') {
      throw new TypeError(`Expected parse error ID, got: ${errorId}`);
    }

    const helpUrl = getHelpUrl(errorId, VERSION);
    super({
      errorId,
      helpUrl: helpUrl || undefined,
      message,
      location,
      context,
    });
    this.name = 'ParseError';
  }
}

/** Runtime execution errors */
export class RuntimeError extends RillError {
  constructor(
    errorId: string,
    message: string,
    location?: SourceLocation,
    context?: Record<string, unknown>,
    span?: SourceSpan,
    sourceId?: string
  ) {
    // Validate errorId exists in registry
    const definition = ERROR_REGISTRY.get(errorId);
    if (!definition) {
      throw new TypeError(`Unknown error ID: ${errorId}`);
    }

    // Validate errorId is a runtime error
    if (definition.category !== 'runtime') {
      throw new TypeError(`Expected runtime error ID, got: ${errorId}`);
    }

    const helpUrl = getHelpUrl(errorId, VERSION);
    super({
      errorId,
      helpUrl: helpUrl || undefined,
      message,
      location,
      span,
      context,
      sourceId,
    });
    this.name = 'RuntimeError';
  }

  /** Create from an AST node */
  static fromNode(
    errorId: string,
    message: string,
    node?: { span: SourceSpan },
    context?: Record<string, unknown>
  ): RuntimeError {
    return new RuntimeError(
      errorId,
      message,
      node?.span.start,
      context,
      node?.span
    );
  }
}

/** Timeout errors */
export class TimeoutError extends RuntimeError {
  readonly functionName: string;
  readonly timeoutMs: number;

  constructor(
    functionName: string,
    timeoutMs: number,
    location?: SourceLocation
  ) {
    super(
      ERROR_IDS.RILL_R012,
      `Function '${functionName}' timed out after ${timeoutMs}ms`,
      location,
      { functionName, timeoutMs }
    );
    this.name = 'TimeoutError';
    this.functionName = functionName;
    this.timeoutMs = timeoutMs;
  }
}
