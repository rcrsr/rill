/**
 * CLI LSP Diagnostic Conversion
 * Convert RillError to LSP Diagnostic format
 */

import type { RillError, SourceLocation, ErrorSeverity } from './types.js';
import { ERROR_REGISTRY } from './types.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface LspDiagnostic {
  readonly range: LspRange | null;
  readonly severity: 1 | 2 | 3;
  readonly code: string;
  readonly source: 'rill';
  readonly message: string;
  readonly suggestions?: string[] | undefined;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

// ============================================================
// LSP DIAGNOSTIC CONVERSION
// ============================================================

/**
 * Convert RillError to LSP Diagnostic format.
 *
 * Constraints:
 * - LSP uses zero-based line/character positions
 * - Severity mapping: Error=1, Warning=2, Info=3
 * - Source is always 'rill'
 * - Returns diagnostic with null range when error has no span
 *
 * @param error - RillError to convert
 * @returns LSP Diagnostic
 */
export function toLspDiagnostic(error: RillError): LspDiagnostic {
  // Get error definition for severity mapping
  const definition = ERROR_REGISTRY.get(error.errorId);
  const errorSeverity: ErrorSeverity = definition?.severity ?? 'error';

  // Map ErrorSeverity to LSP severity (Error=1, Warning=2, Info=3)
  const severity = mapSeverityToLsp(errorSeverity);

  // Extract message without location suffix
  const message = error.message.replace(/ at \d+:\d+$/, '');

  // Convert span to LSP range (zero-based positions)
  // EC-11: Missing span returns diagnostic with null range
  const range = error.location
    ? {
        start: sourceLocationToLspPosition(error.location),
        end: sourceLocationToLspPosition(error.location),
      }
    : null;

  // Extract suggestions if present (max 3)
  const errorData = error.toData();
  const contextSuggestions = errorData.context?.['suggestions'];
  let suggestions: string[] | undefined;

  if (contextSuggestions) {
    if (Array.isArray(contextSuggestions) && contextSuggestions.length > 0) {
      const filtered = contextSuggestions
        .slice(0, 3)
        .map((s) => String(s))
        .filter((s) => s.length > 0);
      if (filtered.length > 0) {
        suggestions = filtered;
      }
    }
  }

  // Build diagnostic
  return {
    range,
    severity,
    code: error.errorId,
    source: 'rill',
    message,
    ...(suggestions ? { suggestions } : {}),
  };
}

/**
 * Convert SourceLocation to zero-based LspPosition.
 *
 * Rill uses 1-based line and column numbers; LSP uses 0-based.
 *
 * @param location - Source location (1-based line, 1-based column)
 * @returns LSP position (0-based line, 0-based character)
 */
function sourceLocationToLspPosition(location: SourceLocation): LspPosition {
  return {
    line: location.line - 1, // Convert 1-based to 0-based
    character: location.column - 1, // Convert 1-based to 0-based
  };
}

/**
 * Map ErrorSeverity to LSP severity code.
 *
 * Mapping:
 * - 'error' -> 1 (Error)
 * - 'warning' -> 2 (Warning)
 * - (future) 'info' -> 3 (Information)
 *
 * @param severity - Error severity level
 * @returns LSP severity code (1, 2, or 3)
 */
function mapSeverityToLsp(severity: ErrorSeverity): 1 | 2 | 3 {
  switch (severity) {
    case 'error':
      return 1;
    case 'warning':
      return 2;
    default:
      // Future-proof: if other severities are added, default to error
      return 1;
  }
}
