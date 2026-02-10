/**
 * Rill Error Classes and Factory
 * Structured error types with registry-based error codes
 */

import type { SourceLocation, SourceSpan } from './source-location.js';
import { ERROR_REGISTRY, renderMessage, getHelpUrl } from './error-registry.js';
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
  readonly context?: Record<string, unknown> | undefined;
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

  // EC-9: Unknown errorId -> Throws TypeError
  if (!definition) {
    throw new TypeError(`Unknown error ID: ${errorId}`);
  }

  // Render message from template + context (O(n) where n = template length)
  // EC-10: Context value fails String() coercion -> Uses fallback "[object Object]"
  // This is handled inside renderMessage via try-catch
  const message = renderMessage(definition.messageTemplate, context);

  // EC-11: Malformed location (missing line/column) -> Error created without location metadata
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
  readonly context?: Record<string, unknown> | undefined;

  constructor(data: RillErrorData) {
    // EC-3: Missing errorId
    if (!data.errorId) {
      throw new TypeError('errorId is required');
    }

    // EC-4: Unknown errorId
    if (!ERROR_REGISTRY.has(data.errorId)) {
      throw new TypeError(`Unknown error ID: ${data.errorId}`);
    }

    const locationStr = data.location
      ? ` at ${data.location.line}:${data.location.column}`
      : '';
    super(`${data.message}${locationStr}`);
    this.name = 'RillError';
    this.errorId = data.errorId;
    this.helpUrl = data.helpUrl;
    this.location = data.location;
    this.context = data.context;
  }

  /** Get structured error data for custom formatting */
  toData(): RillErrorData {
    return {
      errorId: this.errorId,
      helpUrl: this.helpUrl,
      message: this.message.replace(/ at \d+:\d+$/, ''), // Strip location suffix
      location: this.location,
      context: this.context,
    };
  }

  /** Format error for display (can be overridden by host) */
  format(formatter?: (data: RillErrorData) => string): string {
    if (formatter) return formatter(this.toData());
    return this.message;
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
    // EC-7: Unknown errorId
    const definition = ERROR_REGISTRY.get(errorId);
    if (!definition) {
      throw new TypeError(`Unknown error ID: ${errorId}`);
    }

    // EC-8: Wrong category
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
    context?: Record<string, unknown>
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
      context,
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
    return new RuntimeError(errorId, message, node?.span.start, context);
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
      'RILL-R012',
      `Function '${functionName}' timed out after ${timeoutMs}ms`,
      location,
      { functionName, timeoutMs }
    );
    this.name = 'TimeoutError';
    this.functionName = functionName;
    this.timeoutMs = timeoutMs;
  }
}

/** Auto-exception errors (when $_ matches a pattern) */
export class AutoExceptionError extends RuntimeError {
  readonly pattern: string;
  readonly matchedValue: string;

  constructor(
    pattern: string,
    matchedValue: string,
    location?: SourceLocation
  ) {
    super(
      'RILL-R014',
      `Auto-exception triggered: pattern '${pattern}' matched`,
      location,
      { pattern, matchedValue }
    );
    this.name = 'AutoExceptionError';
    this.pattern = pattern;
    this.matchedValue = matchedValue;
  }
}

/** Abort errors (when execution is cancelled via AbortSignal) */
export class AbortError extends RuntimeError {
  constructor(location?: SourceLocation) {
    super('RILL-R013', 'Execution aborted', location, {});
    this.name = 'AbortError';
  }
}
