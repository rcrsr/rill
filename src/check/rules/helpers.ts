/**
 * Shared Helper Functions
 * Common utilities used across validation rules.
 */

/**
 * Extract source line at location for context display.
 * Splits source by newlines, retrieves the specified line (1-indexed), and trims it.
 */
export function extractContextLine(line: number, source: string): string {
  const lines = source.split('\n');
  const sourceLine = lines[line - 1];
  return sourceLine ? sourceLine.trim() : '';
}
