/**
 * Error mapping utilities for LLM provider extensions.
 * Converts provider-specific errors to RuntimeError with consistent messages.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { ProviderErrorDetector } from './types.js';

/**
 * Map provider SDK error to RuntimeError with appropriate message.
 *
 * Uses provider-specific detector callback to extract status code and message.
 * Falls back to generic error message if detector returns null.
 *
 * @param providerName - Provider name for error message prefix (e.g., "Anthropic", "OpenAI")
 * @param error - Error from provider SDK or unknown error
 * @param detect - Provider callback that returns status code and message, or null if not provider error
 * @returns RuntimeError with formatted message
 *
 * @example
 * // EC-12: Detector returns non-null
 * const detect = (err) => {
 *   if (err instanceof Anthropic.APIError) {
 *     return { status: err.status, message: err.message };
 *   }
 *   return null;
 * };
 * mapProviderError("Anthropic", apiError, detect);
 * // RuntimeError: "Anthropic API error (HTTP 401): Invalid API key"
 *
 * @example
 * // EC-13: Detector returns null
 * const detect = () => null;
 * mapProviderError("OpenAI", new Error("Network timeout"), detect);
 * // RuntimeError: "OpenAI error: Network timeout"
 */
export function mapProviderError(
  providerName: string,
  error: unknown,
  detect: ProviderErrorDetector
): RuntimeError {
  // Try provider-specific error detection
  const detected = detect(error);

  // EC-12: Detector returns non-null → format with status code
  if (detected !== null) {
    const { status, message } = detected;
    if (status !== undefined) {
      return new RuntimeError(
        'RILL-R004',
        `${providerName} API error (HTTP ${status}): ${message}`,
        undefined,
        { cause: error }
      );
    }
    // Status not present, but provider error detected
    return new RuntimeError(
      'RILL-R004',
      `${providerName} API error: ${message}`,
      undefined,
      { cause: error }
    );
  }

  // EC-13: Detector returns null → fallback to generic error message
  if (error instanceof Error) {
    return new RuntimeError(
      'RILL-R004',
      `${providerName} error: ${error.message}`,
      undefined,
      { cause: error }
    );
  }

  // Unknown error type
  return new RuntimeError(
    'RILL-R004',
    `${providerName} error: Unknown error`,
    undefined,
    { cause: error }
  );
}
