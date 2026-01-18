/**
 * Lexer Errors
 */

import type { SourceLocation } from '../types.js';

export class LexerError extends Error {
  constructor(
    message: string,
    public readonly location: SourceLocation
  ) {
    super(`${message} at line ${location.line}, column ${location.column}`);
    this.name = 'LexerError';
  }
}
