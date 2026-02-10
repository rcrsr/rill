/**
 * Function wrapper factory for vector database extensions.
 * Combines disposal check, timing, event emission, and error mapping.
 */

import {
  emitExtensionEvent,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { DisposalState } from './types.js';
import { checkDisposed } from './disposal.js';
import { mapVectorError } from './errors.js';

/**
 * Create a function wrapper that adds disposal check, timing, events, and error mapping.
 *
 * Returns a factory function that wraps individual operations. The wrapper:
 * 1. Checks disposal state before execution
 * 2. Records operation timing
 * 3. Emits success events with duration and metadata
 * 4. Maps errors via mapVectorError and emits error events
 *
 * @param provider - Extension provider name (e.g., "chroma", "pinecone")
 * @param state - DisposalState object to check before operations
 * @returns Factory function that wraps operations
 *
 * @example
 * ```typescript
 * const state = createDisposalState('chroma');
 * const wrap = createFunctionWrapper('chroma', state);
 *
 * const query = wrap(
 *   'query',
 *   async (args, ctx) => { return results; },
 *   (args) => ({ collection: args[0] })
 * );
 * ```
 */
export function createFunctionWrapper(
  provider: string,
  state: DisposalState
): (
  operation: string,
  fn: (args: RillValue[], ctx: RuntimeContext) => Promise<RillValue>,
  metadata?: (args: RillValue[]) => Record<string, unknown>
) => (args: RillValue[], ctx: RuntimeContext) => Promise<RillValue> {
  return (operation, fn, metadata) => {
    return async (
      args: RillValue[],
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      // EC-20: Check disposal state first
      checkDisposed(state, provider);

      // Record start time
      const startTime = Date.now();

      try {
        // Execute wrapped function
        const result = await fn(args, ctx);

        // Calculate duration
        const duration = Date.now() - startTime;

        // AC-9: Emit success event with duration and metadata
        emitExtensionEvent(ctx, {
          event: `${provider}:${operation}`,
          subsystem: `extension:${provider}`,
          duration,
          ...(metadata ? metadata(args) : {}),
        });

        return result;
      } catch (error: unknown) {
        // EC-21: Map error via mapVectorError
        const duration = Date.now() - startTime;
        const mappedError = mapVectorError(provider, error);

        // Emit error event
        emitExtensionEvent(ctx, {
          event: `${provider}:error`,
          subsystem: `extension:${provider}`,
          error: mappedError.message,
          duration,
        });

        // Throw mapped error
        throw mappedError;
      }
    };
  };
}
