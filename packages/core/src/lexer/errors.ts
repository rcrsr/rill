/**
 * Lexer Errors
 */

import { RillError, ERROR_REGISTRY, getHelpUrl } from '../types.js';
import type { SourceLocation } from '../types.js';
import { VERSION } from '../generated/version-data.js';

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

    // EC-5: Unknown errorId throws TypeError
    if (!definition) {
      throw new TypeError(`Unknown error ID: ${errorId}`);
    }

    // EC-6: Wrong category throws TypeError
    if (definition.category !== 'lexer') {
      throw new TypeError(`Expected lexer error ID, got: ${errorId}`);
    }

    // Call RillError constructor with structured data
    const helpUrl = getHelpUrl(errorId, VERSION);
    super({
      errorId,
      helpUrl: helpUrl || undefined,
      message,
      location,
      context,
    });

    this.name = 'LexerError';
    this.location = location;
  }
}
