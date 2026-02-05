/**
 * CLI Error Explanation
 * Function for rendering full error documentation
 */

import { ERROR_REGISTRY } from './types.js';

/**
 * Render full error documentation for --explain command.
 *
 * Constraints:
 * - Lookup from ERROR_REGISTRY
 * - Renders cause, resolution, examples sections
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit})
 * @returns Formatted documentation string, or null if errorId is invalid/unknown
 *
 * @example
 * explainError("RILL-R009")
 * // Returns: formatted documentation with cause, resolution, examples
 *
 * @example
 * explainError("invalid")
 * // Returns: null
 */
export function explainError(errorId: string): string | null {
  // EC-12: Invalid errorId format returns null
  const errorIdPattern = /^RILL-[LPRC]\d{3}$/;
  if (!errorIdPattern.test(errorId)) {
    return null;
  }

  // EC-13: Unknown errorId returns null
  const definition = ERROR_REGISTRY.get(errorId);
  if (!definition) {
    return null;
  }

  // Build documentation sections
  const sections: string[] = [];

  // Header: errorId and description
  sections.push(`${definition.errorId}: ${definition.description}`);
  sections.push('');

  // Cause section (if present)
  if (definition.cause) {
    sections.push('Cause:');
    sections.push(`  ${definition.cause}`);
    sections.push('');
  }

  // Resolution section (if present)
  if (definition.resolution) {
    sections.push('Resolution:');
    sections.push(`  ${definition.resolution}`);
    sections.push('');
  }

  // Examples section (if present)
  if (definition.examples && definition.examples.length > 0) {
    sections.push('Examples:');
    for (const example of definition.examples) {
      sections.push(`  ${example.description}`);
      sections.push('');
      // Indent code block
      const codeLines = example.code.split('\n');
      for (const line of codeLines) {
        sections.push(`    ${line}`);
      }
      sections.push('');
    }
  }

  return sections.join('\n').trimEnd();
}
