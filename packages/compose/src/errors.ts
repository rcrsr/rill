/**
 * Error types for rill-compose.
 * Shared by all modules in the package.
 */

// ============================================================
// COMPOSE PHASE
// ============================================================

/**
 * Build phase where a compose error occurred.
 */
export type ComposePhase =
  | 'validation'
  | 'resolution'
  | 'compatibility'
  | 'compilation'
  | 'bundling'
  | 'init';

// ============================================================
// BASE ERROR
// ============================================================

/**
 * Base error for all rill-compose failures.
 * Extends Error with structured context.
 */
export class ComposeError extends Error {
  /** JSON path to the manifest field causing the error (if applicable). */
  readonly fieldPath?: string | undefined;
  /** Build phase where the error occurred. */
  readonly phase: ComposePhase;

  constructor(
    message: string,
    phase: ComposePhase,
    fieldPath?: string | undefined
  ) {
    super(message);
    this.name = 'ComposeError';
    this.phase = phase;
    this.fieldPath = fieldPath;
  }
}

// ============================================================
// MANIFEST VALIDATION
// ============================================================

/**
 * A single validation issue from a manifest field.
 */
export interface ManifestIssue {
  /** JSON path to the invalid field (e.g., "extensions.llm.package"). */
  readonly path: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Line number in the manifest file (when available). */
  readonly line?: number | undefined;
}

/**
 * Manifest schema validation error with field-level detail.
 * Wraps zod v4 ZodError issues.
 */
export class ManifestValidationError extends ComposeError {
  /** Structured validation issues from zod. */
  readonly issues: readonly ManifestIssue[];

  constructor(
    message: string,
    issues: readonly ManifestIssue[],
    fieldPath?: string | undefined
  ) {
    super(message, 'validation', fieldPath);
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}
