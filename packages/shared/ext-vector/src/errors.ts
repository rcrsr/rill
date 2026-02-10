/**
 * Error mapping utilities for vector database extensions.
 * Converts SDK-specific errors to RuntimeError with standardized messages.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Convert SDK error to RuntimeError with provider-prefixed messages.
 *
 * Maps common error conditions (authentication, rate limits, timeouts, etc.)
 * to standardized RuntimeError instances with error code RILL-R004.
 *
 * @param provider - Provider name (e.g., "chroma", "pinecone", "qdrant")
 * @param error - Error from SDK operation
 * @returns RuntimeError with provider-prefixed message
 *
 * @example
 * ```typescript
 * try {
 *   await client.query(...);
 * } catch (error) {
 *   throw mapVectorError('chroma', error);
 * }
 * ```
 */
export function mapVectorError(provider: string, error: unknown): RuntimeError {
  // EC-8: Non-Error value thrown
  if (!(error instanceof Error)) {
    return new RuntimeError('RILL-R004', `${provider}: unknown error`);
  }

  const message = error.message;

  // EC-1: Status 401 or "unauthorized" in message
  if (
    message.includes('401') ||
    message.toLowerCase().includes('unauthorized')
  ) {
    return new RuntimeError(
      'RILL-R004',
      `${provider}: authentication failed (401)`
    );
  }

  // EC-2: "collection" + "not found" in message
  if (
    message.toLowerCase().includes('collection') &&
    message.toLowerCase().includes('not found')
  ) {
    return new RuntimeError('RILL-R004', `${provider}: collection not found`);
  }

  // EC-3: Status 429 or "rate limit" in message
  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return new RuntimeError('RILL-R004', `${provider}: rate limit exceeded`);
  }

  // EC-4: AbortError name or "timeout" in message
  if (
    error.name === 'AbortError' ||
    message.toLowerCase().includes('timeout')
  ) {
    return new RuntimeError('RILL-R004', `${provider}: request timeout`);
  }

  // EC-5: "dimension" in message
  if (message.toLowerCase().includes('dimension')) {
    // Extract expected and actual dimensions if possible
    // DEVIATION: Fixed regex to use non-greedy .*? in second alternative
    // Original spec: /expected (\d+).*got (\d+)|(\d+).*expected.*(\d+)/i
    // Without non-greedy, "received 512 dimensions, expected 384" matches "4" not "384"
    const match = message.match(
      /expected (\d+).*got (\d+)|(\d+).*?expected.*?(\d+)/i
    );
    if (match) {
      const expected = match[1] || match[4];
      const actual = match[2] || match[3];
      return new RuntimeError(
        'RILL-R004',
        `${provider}: dimension mismatch (expected ${expected}, got ${actual})`
      );
    }
    return new RuntimeError('RILL-R004', `${provider}: dimension mismatch`);
  }

  // EC-6: "already exists" in message
  if (message.toLowerCase().includes('already exists')) {
    return new RuntimeError(
      'RILL-R004',
      `${provider}: collection already exists`
    );
  }

  // EC-7: Generic Error instance
  return new RuntimeError('RILL-R004', `${provider}: ${message}`);
}
