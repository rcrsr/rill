/**
 * Event emission wrapper for vector database extensions.
 * Wraps async operations with start-time recording, success event emission, and error event emission.
 */

import { emitExtensionEvent, type RuntimeContext } from '@rcrsr/rill';
import { mapVectorError } from './errors.js';

/**
 * Wrap async operation with start-time recording, success event emission, and error event emission.
 *
 * Records `Date.now()` before invoking `fn`, emits success or error events based on outcome.
 *
 * @param ctx - Runtime context for event emission
 * @param provider - Provider name (e.g., "chroma", "pinecone", "qdrant")
 * @param operation - Operation name (e.g., "upsert", "query", "delete")
 * @param metadata - Additional metadata to include in success event
 * @param fn - Async operation to execute
 * @returns Promise resolving to operation result
 * @throws RuntimeError - Mapped error from `mapVectorError`
 *
 * @example
 * ```typescript
 * const result = await withEventEmission(
 *   ctx,
 *   'chroma',
 *   'upsert',
 *   { id: 'vec-1' },
 *   async () => client.upsert({ id: 'vec-1', vector: [1, 2, 3] })
 * );
 * // Emits: { event: 'chroma:upsert', subsystem: 'extension:chroma', duration: 42, id: 'vec-1' }
 * ```
 *
 * @remarks
 * - EC-9: `fn` throws → RuntimeError (mapped via mapVectorError)
 * - EC-10: `ctx.callbacks.onLogEvent` undefined → No error (silent skip, handled by emitExtensionEvent)
 */
export async function withEventEmission<T>(
  ctx: RuntimeContext,
  provider: string,
  operation: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  // Record start time before fn invocation
  const startTime = Date.now();

  try {
    // Execute operation
    const result = await fn();

    // Calculate duration
    const duration = Date.now() - startTime;

    // Emit success event: {provider}:{operation} with subsystem, duration, and spread metadata
    emitExtensionEvent(ctx, {
      event: `${provider}:${operation}`,
      subsystem: `extension:${provider}`,
      duration,
      ...metadata,
    });

    return result;
  } catch (error: unknown) {
    // EC-9: fn throws → RuntimeError (mapped via mapVectorError)
    const duration = Date.now() - startTime;
    const rillError = mapVectorError(provider, error);

    // Emit error event: {provider}:error with error message and duration
    emitExtensionEvent(ctx, {
      event: `${provider}:error`,
      subsystem: `extension:${provider}`,
      error: rillError.message,
      duration,
    });

    // Throw mapped error
    throw rillError;
  }
}
