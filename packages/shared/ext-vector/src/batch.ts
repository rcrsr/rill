/**
 * Batch execution utilities for vector database extensions.
 * Provides halt-on-first-failure semantics for sequential item processing.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { BatchResult } from './types.js';

/**
 * Process batch items sequentially with halt-on-first-failure semantics.
 *
 * Iterates items in order (index 0 to N-1), calling validate then execute
 * for each item. Halts on first validation or execution failure.
 *
 * @param items - Array of items to process
 * @param validate - Function returning error string or null for each item
 * @param execute - Async function to execute for each item
 * @param mapError - Function mapping thrown errors to RuntimeError
 * @returns Promise resolving to batch result
 *
 * @example
 * ```typescript
 * const result = await executeBatch(
 *   vectors,
 *   (item, index) => {
 *     if (!item.id) return `index ${index}`;
 *     return null;
 *   },
 *   async (item) => {
 *     await collection.upsert(item);
 *   },
 *   (error) => mapVectorError('chroma', error)
 * );
 *
 * if (result.failed) {
 *   console.log(`Failed at ${result.failed}: ${result.error}`);
 * } else {
 *   console.log(`All ${result.succeeded} items succeeded`);
 * }
 * ```
 */
export async function executeBatch<TItem>(
  items: TItem[],
  validate: (item: TItem, index: number) => string | null,
  execute: (item: TItem) => Promise<void>,
  mapError: (error: unknown) => RuntimeError
): Promise<BatchResult> {
  let succeeded = 0;

  // EC-14: Empty items array → { succeeded: 0 }
  if (items.length === 0) {
    return { succeeded: 0 };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;

    // Validate item (EC-11: Validation failure → { succeeded, failed, error })
    // Validation errors from validate callback propagate directly (not caught)
    const validationError = validate(item, i);
    if (validationError !== null) {
      return {
        succeeded,
        failed: `index ${i}`,
        error: validationError,
      };
    }

    try {
      // Execute operation
      await execute(item);
      succeeded++;
    } catch (error: unknown) {
      // EC-12: Execution failure → { succeeded, failed, error }
      const rillError = mapError(error);
      return {
        succeeded,
        failed: `index ${i}`,
        error: rillError.message,
      };
    }
  }

  // EC-13: All items succeed → { succeeded } without failed/error
  return { succeeded };
}
