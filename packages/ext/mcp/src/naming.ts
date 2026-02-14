/**
 * Name sanitization utilities for MCP tool names
 *
 * Converts MCP tool names to valid rill identifiers with collision detection.
 */

/**
 * Sanitizes a single MCP tool name to a valid rill identifier.
 *
 * Rules:
 * - Replace `-` with `_`
 * - Replace `.` with `_`
 * - Convert camelCase to snake_case
 * - Convert PascalCase to snake_case
 * - Normalize consecutive underscores to single underscore
 * - Strip leading and trailing underscores
 *
 * @param name - Original MCP tool name
 * @returns Sanitized rill identifier
 */
function sanitizeName(name: string): string {
  // Replace hyphens and dots with underscores
  let sanitized = name.replace(/[-.]/g, '_');

  // Convert camelCase and PascalCase to snake_case
  // Insert underscore before uppercase letters, then lowercase everything
  sanitized = sanitized
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

  // Normalize underscores: collapse consecutive and strip leading/trailing
  sanitized = sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

  return sanitized;
}

/**
 * Sanitizes MCP tool names with collision detection.
 *
 * When multiple tool names sanitize to the same identifier, appends
 * `_2`, `_3`, etc. to subsequent occurrences.
 *
 * @param names - Array of original MCP tool names
 * @returns Map from original name to sanitized rill identifier
 */
export function sanitizeNames(names: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const usedNames = new Map<string, number>();

  for (const name of names) {
    const sanitized = sanitizeName(name);
    const count = usedNames.get(sanitized) ?? 0;
    usedNames.set(sanitized, count + 1);

    if (count === 0) {
      result.set(name, sanitized);
    } else {
      result.set(name, `${sanitized}_${count + 1}`);
    }
  }

  return result;
}
