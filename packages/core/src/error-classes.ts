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
 * and creates an instance of the class matching the error's category: a
 * `ParseError` for parse-category (and legacy syntax-parse) IDs, a
 * `RuntimeError` for runtime-category IDs, and a base `RillError` otherwise.
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit})
 * @param context - Key-value pairs for template placeholder replacement
 * @param location - Source location where error occurred (optional)
 * @returns RillError instance (or a ParseError/RuntimeError subclass) with rendered message
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

  // ParseError requires a non-optional SourceLocation; createError's location
  // stays optional to preserve its public signature. An unlocated parse
  // error passes the UNLOCATED sentinel to satisfy the constructor's type
  // without fabricating a real location: ParseError recognizes the sentinel
  // by reference and treats it as "no location", so an unlocated call keeps
  // producing `.location === undefined` and no ' at {line}:{column}' suffix,
  // matching the behavior of a located call minus the location.
  if (
    definition.category === 'parse' ||
    LEGACY_SYNTAX_PARSE_ERROR_IDS.has(errorId)
  ) {
    return new ParseError(
      errorId,
      message,
      location ?? UNLOCATED_PARSE_LOCATION,
      context
    );
  }

  if (definition.category === 'runtime') {
    return new RuntimeError(errorId, message, location, context);
  }

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
  /** The message as constructed, before the " at {line}:{column}" location suffix is appended. */
  readonly rawMessage: string;

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
    this.rawMessage = data.message;
  }

  /** Get structured error data for custom formatting */
  toData(): RillErrorData {
    return {
      errorId: this.errorId,
      helpUrl: this.helpUrl,
      message: this.rawMessage,
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
    const clone = Object.create(
      Object.getPrototypeOf(this),
      Object.getOwnPropertyDescriptors(this)
    ) as RillError;
    // Object.getOwnPropertyDescriptors copies Error's `stack` accessor
    // descriptor as-is (get/set pair). That accessor is backed by V8's
    // internal captured-frames slot on the original instance, not by the
    // closure alone, so invoking the copied setter via a plain assignment
    // on the clone is a silent no-op. Reading `this.stack` forces V8 to
    // format and cache the stack for the original, then `defineProperty`
    // replaces the clone's copied accessor with a real own data property
    // so the clone's `stack` no longer resolves to undefined.
    Object.defineProperty(clone, 'stack', {
      value: this.stack,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    const merged = { ...this.context, ...patch };
    (clone as { context: Record<string, unknown> | undefined }).context =
      this.context === undefined && Object.keys(merged).length === 0
        ? undefined
        : merged;
    return clone;
  }
}

// ============================================================
// SPECIALIZED ERROR CLASSES
// ============================================================

/**
 * Legacy syntax migration errors: detected by the parser at parse time, but
 * carrying an `RILL-R0xx` ID (category `runtime`) because the ID letter was
 * assigned before the migration diagnostics existed. The published ID cannot
 * be renamed, so these are exempted from ParseError's category gate below.
 */
const LEGACY_SYNTAX_PARSE_ERROR_IDS: ReadonlySet<string> = new Set([
  ERROR_IDS.RILL_R078,
  ERROR_IDS.RILL_R079,
  ERROR_IDS.RILL_R080,
  ERROR_IDS.RILL_R081,
]);

/**
 * Sentinel identified by reference (not value) to let `createError` satisfy
 * `ParseError`'s non-optional `location` parameter for an unlocated
 * parse-category error without fabricating a real location. `ParseError`
 * maps this exact object back to `undefined` before it reaches `RillError`,
 * so it never sets `.location` or appends a ' at {line}:{column}' suffix to
 * `.message`. Not exported: callers construct `ParseError` directly with a
 * real location or omit it via `createError`.
 */
const UNLOCATED_PARSE_LOCATION: SourceLocation = {
  line: 1,
  column: 1,
  offset: 0,
};

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
    if (
      definition.category !== 'parse' &&
      !LEGACY_SYNTAX_PARSE_ERROR_IDS.has(errorId)
    ) {
      throw new TypeError(`Expected parse error ID, got: ${errorId}`);
    }

    const helpUrl = getHelpUrl(errorId, VERSION);
    super({
      errorId,
      helpUrl: helpUrl || undefined,
      message,
      location: location === UNLOCATED_PARSE_LOCATION ? undefined : location,
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
