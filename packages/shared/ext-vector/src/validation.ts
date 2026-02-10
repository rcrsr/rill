/**
 * Configuration validation utilities for vector database extensions.
 * Validates required fields with type-safe assertions.
 */

/**
 * Validate that a configuration field is present and non-empty.
 *
 * Throws Error for undefined, null, or empty string.
 * Zero (0) passes validation as it is a valid value.
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error message
 * @throws Error when value is undefined, null, or empty string
 *
 * @example
 * ```typescript
 * assertRequired(config.apiKey, "apiKey");
 * assertRequired(0, "timeout"); // passes (zero is valid)
 * ```
 */
export function assertRequired<T>(
  value: T | undefined | null,
  fieldName: string
): asserts value is T {
  // EC-17: undefined throws
  if (value === undefined) {
    throw new Error(`${fieldName} is required`);
  }

  // EC-18: null throws
  if (value === null) {
    throw new Error(`${fieldName} is required`);
  }

  // EC-19: empty string throws
  if (value === '') {
    throw new Error(`${fieldName} is required`);
  }

  // AC-6: Zero (0) passes validation
  // AC-5: Non-empty string passes validation
}
