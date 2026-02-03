/**
 * Lexer Errors
 */

import { RillError, ERROR_REGISTRY } from '../types.js';
import type { SourceLocation } from '../types.js';

export class LexerError extends RillError {
  // Override to make location required (lexer errors always have location)
  override readonly location: SourceLocation;

  constructor(
    errorId: string,
    message: string,
    location: SourceLocation,
    context?: Record<string, unknown>
  ) {
    // Look up error definition from registry
    const definition = ERROR_REGISTRY.get(errorId);

    // EC-3: Unknown errorId throws TypeError
    if (!definition) {
      throw new TypeError(`Unknown error ID: ${errorId}`);
    }

    // Call RillError constructor with structured data
    super({
      code: definition.legacyCode,
      errorId,
      message,
      location,
      context,
    });

    this.name = 'LexerError';
    this.location = location;
  }
}
