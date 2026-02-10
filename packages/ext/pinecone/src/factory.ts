/**
 * Extension factory for Pinecone vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import {
  RuntimeError,
  emitExtensionEvent,
  createVector,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
  type RillVector,
} from '@rcrsr/rill';
import {
  mapVectorError,
  withEventEmission,
  createDisposalState,
  checkDisposed as sharedCheckDisposed,
  dispose as sharedDispose,
  assertRequired,
  type DisposalState,
} from '@rcrsr/rill-ext-vector-shared';
import type { PineconeConfig } from './types.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map Pinecone SDK error to RuntimeError with Pinecone-specific checks.
 * Adds "authentication" keyword check and "index" to "collection" translation.
 *
 * @param error - Error from Pinecone SDK
 * @returns RuntimeError with appropriate message
 */
function mapPineconeError(error: unknown): RuntimeError {
  // Pinecone-specific: Check for "authentication" keyword (IR-1)
  if (error instanceof Error) {
    const message = error.message;
    if (message.toLowerCase().includes('authentication')) {
      return new RuntimeError(
        'RILL-R004',
        'pinecone: authentication failed (401)'
      );
    }
    // Special handling for "index" instead of "collection" in error messages
    // This must be checked before delegating to shared mapper
    if (
      message.toLowerCase().includes('index') &&
      message.toLowerCase().includes('not found')
    ) {
      return new RuntimeError('RILL-R004', 'pinecone: collection not found');
    }
  }

  // Delegate to shared error mapper for common error patterns
  return mapVectorError('pinecone', error);
}

// Validation functions removed - now using assertRequired from shared utilities

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Pinecone extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with 11 vector database functions and dispose
 * @throws Error for invalid configuration (AC-10)
 *
 * @example
 * ```typescript
 * const ext = createPineconeExtension({
 *   apiKey: 'your-api-key',
 *   index: 'my-index',
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createPineconeExtension(
  config: PineconeConfig
): ExtensionResult {
  // Validate required fields using shared assertRequired (AC-10)
  assertRequired(config.apiKey, 'apiKey');
  assertRequired(config.index, 'index');

  // Instantiate SDK client at factory time
  const client = new Pinecone({
    apiKey: config.apiKey,
  });

  // Store config values for use in functions
  const factoryIndex = config.index;
  const factoryNamespace: string = config.namespace ?? '';

  // Create disposal state using shared utility (IR-4)
  const disposalState: DisposalState = createDisposalState('pinecone');

  // Dispose function for cleanup using shared utility (AC-31, AC-32, IR-6)
  const dispose = async (): Promise<void> => {
    await sharedDispose(disposalState);
  };

  // Helper to check if disposed using shared utility (EC-8, IR-5)
  const checkDisposed = (): void => {
    sharedCheckDisposed(disposalState, 'pinecone');
  };

  // Convert RillValue metadata to Pinecone-compatible format
  const convertMetadata = (
    input: Record<string, unknown>
  ): Record<string, string | number | boolean> => {
    const result: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        result[key] = value;
      } else {
        result[key] = String(value);
      }
    }
    return result;
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-1: pinecone::upsert
    upsert: {
      params: [
        { name: 'id', type: 'string' },
        { name: 'vector', type: 'vector' },
        { name: 'metadata', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const id = args[0] as string;
        const vector = args[1] as RillVector;
        const metadataArg = (args[2] ?? {}) as Record<string, unknown>;

        // Convert metadata
        const metadata = convertMetadata(metadataArg);

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'upsert',
          { id },
          async () => {
            // Get index handle
            const index = client.Index(factoryIndex);

            // Call Pinecone API
            await index.namespace(factoryNamespace).upsert([
              {
                id,
                values: Array.from(vector.data),
                metadata,
              },
            ]);

            // Build and return result
            return {
              id,
              success: true,
            } as RillValue;
          }
        );
      },
      description: 'Insert or update single vector with metadata',
      returnType: 'dict',
    },

    // IR-2: pinecone::upsert_batch
    upsert_batch: {
      params: [{ name: 'items', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const items = args[0] as Array<Record<string, RillValue>>;

          let succeeded = 0;

          // Get index handle
          const index = client.Index(factoryIndex);

          // Process sequentially; halt on first failure
          for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Validate item structure
            if (!item || typeof item !== 'object') {
              const result = {
                succeeded,
                failed: `index ${i}`,
                error: 'invalid item structure',
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'pinecone:upsert_batch',
                subsystem: 'extension:pinecone',
                duration,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }

            const id = item['id'] as string;
            const vector = item['vector'] as RillVector;
            const metadataArg = (item['metadata'] ?? {}) as Record<
              string,
              unknown
            >;

            // Convert metadata
            const metadata = convertMetadata(metadataArg);

            try {
              // Call Pinecone API
              await index.namespace(factoryNamespace).upsert([
                {
                  id,
                  values: Array.from(vector.data),
                  metadata,
                },
              ]);

              succeeded++;
            } catch (error: unknown) {
              // Halt on first failure
              const rillError = mapPineconeError(error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'pinecone:upsert_batch',
                subsystem: 'extension:pinecone',
                duration,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          // All succeeded - emit single success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:upsert_batch',
            subsystem: 'extension:pinecone',
            duration,
            count: items.length,
            succeeded,
          });

          return { succeeded } as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapPineconeError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:error',
            subsystem: 'extension:pinecone',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Batch insert/update vectors',
      returnType: 'dict',
    },

    // IR-3: pinecone::search
    search: {
      params: [
        { name: 'vector', type: 'vector' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const vector = args[0] as RillVector;
        const options = (args[1] ?? {}) as Record<string, unknown>;

        // Extract options with defaults
        const k = typeof options['k'] === 'number' ? options['k'] : 10;
        const filter = (options['filter'] ?? {}) as Record<string, unknown>;
        const scoreThreshold =
          typeof options['score_threshold'] === 'number'
            ? options['score_threshold']
            : undefined;

        // Manual event emission for search (needs result_count after operation)
        const startTime = Date.now();

        try {
          // Get index handle
          const index = client.Index(factoryIndex);

          // Build search request
          const searchRequest: {
            vector: number[];
            topK: number;
            includeMetadata?: boolean;
            filter?: Record<string, unknown>;
          } = {
            vector: Array.from(vector.data),
            topK: k,
            includeMetadata: true,
          };

          if (Object.keys(filter).length > 0) {
            searchRequest.filter = filter;
          }

          // Call Pinecone API
          const response = await index
            .namespace(factoryNamespace)
            .query(searchRequest);

          // Build result list
          const results: RillValue = (response.matches ?? []).map((hit) => {
            const metadata: Record<string, RillValue> = {};
            if (hit.metadata) {
              for (const [key, value] of Object.entries(hit.metadata)) {
                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ) {
                  metadata[key] = value;
                } else {
                  metadata[key] = String(value);
                }
              }
            }
            return {
              id: hit.id,
              score: hit.score ?? 0,
              metadata,
            };
          });

          // Filter by score_threshold if provided
          let filtered: unknown = results;
          if (scoreThreshold !== undefined && Array.isArray(results)) {
            filtered = (results as Record<string, unknown>[]).filter(
              (r) => ((r['score'] as number) ?? 0) >= scoreThreshold
            );
          }

          // Emit success event with actual result_count
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:search',
            subsystem: 'extension:pinecone',
            duration,
            result_count: Array.isArray(filtered) ? filtered.length : 0,
            k,
          });

          return filtered as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapPineconeError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:error',
            subsystem: 'extension:pinecone',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Search k nearest neighbors',
      returnType: 'list',
    },

    // IR-4: pinecone::get
    get: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const id = args[0] as string;

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'get',
          { id },
          async () => {
            // Get index handle
            const index = client.Index(factoryIndex);

            // Call Pinecone API
            const response = await index
              .namespace(factoryNamespace)
              .fetch([id]);

            // EC-7: ID not found
            if (!response.records || response.records[id] === undefined) {
              throw new RuntimeError('RILL-R004', 'pinecone: id not found');
            }

            const record = response.records[id];
            const vectorData = record.values;

            // Validate vector data
            if (!vectorData || !Array.isArray(vectorData)) {
              throw new RuntimeError(
                'RILL-R004',
                'pinecone: invalid vector format'
              );
            }

            const float32Data = new Float32Array(vectorData);
            const vector = createVector(float32Data, factoryIndex);

            // Build and return result
            return {
              id,
              vector,
              metadata: record.metadata ?? {},
            } as RillValue;
          }
        );
      },
      description: 'Fetch vector by ID',
      returnType: 'dict',
    },

    // IR-5: pinecone::delete
    delete: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const id = args[0] as string;

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'delete',
          { id },
          async () => {
            // Get index handle
            const index = client.Index(factoryIndex);

            // Call Pinecone API
            const ns = factoryNamespace || '';
            await index.namespace(ns).deleteOne(id);

            // Build and return result
            return {
              id,
              deleted: true,
            } as RillValue;
          }
        );
      },
      description: 'Delete vector by ID',
      returnType: 'dict',
    },

    // IR-6: pinecone::delete_batch
    delete_batch: {
      params: [{ name: 'ids', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const ids = args[0] as Array<string>;

          let succeeded = 0;

          // Get index handle
          const index = client.Index(factoryIndex);

          // Process sequentially; halt on first failure
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i]!;

            try {
              // Call Pinecone API
              await index.namespace(factoryNamespace).deleteOne(id);

              succeeded++;
            } catch (error: unknown) {
              // Halt on first failure
              const rillError = mapPineconeError(error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'pinecone:delete_batch',
                subsystem: 'extension:pinecone',
                duration,
                count: ids.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          // All succeeded - emit single success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:delete_batch',
            subsystem: 'extension:pinecone',
            duration,
            count: ids.length,
            succeeded,
          });

          return { succeeded } as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapPineconeError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:error',
            subsystem: 'extension:pinecone',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Batch delete vectors',
      returnType: 'dict',
    },

    // IR-7: pinecone::count
    count: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'count',
          {},
          async () => {
            // Get index handle
            const index = client.Index(factoryIndex);

            // Call Pinecone API to get index stats
            const stats = await index.describeIndexStats();

            // Extract count from the target namespace
            const count =
              stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;

            return count as RillValue;
          }
        );
      },
      description: 'Return total vector count in collection',
      returnType: 'number',
    },

    // IR-8: pinecone::create_collection
    create_collection: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const name = args[0] as string;
        const options = (args[1] ?? {}) as Record<string, unknown>;

        // Extract options
        const dimensions = options['dimensions'] as number;
        const distance =
          (options['distance'] as 'cosine' | 'euclidean' | 'dot') ?? 'cosine';

        // Validate dimensions
        if (!dimensions || typeof dimensions !== 'number' || dimensions <= 0) {
          throw new RuntimeError(
            'RILL-R004',
            'pinecone: dimensions must be a positive integer'
          );
        }

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'create_collection',
          { name },
          async () => {
            // Map distance metric to Pinecone format
            let pineconeMetric: 'cosine' | 'euclidean' | 'dotproduct';
            if (distance === 'cosine') {
              pineconeMetric = 'cosine';
            } else if (distance === 'euclidean') {
              pineconeMetric = 'euclidean';
            } else {
              pineconeMetric = 'dotproduct';
            }

            // Call Pinecone API to create serverless index
            await client.createIndex({
              name,
              dimension: dimensions,
              metric: pineconeMetric,
              spec: {
                serverless: {
                  cloud: 'aws',
                  region: 'us-east-1',
                },
              },
            });

            // Build and return result
            return {
              name,
              created: true,
            } as RillValue;
          }
        );
      },
      description: 'Create new vector collection',
      returnType: 'dict',
    },

    // IR-9: pinecone::delete_collection
    delete_collection: {
      params: [{ name: 'name', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Extract arguments
        const name = args[0] as string;

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'delete_collection',
          { name },
          async () => {
            // Call Pinecone API to delete index
            await client.deleteIndex(name);

            // Build and return result
            return {
              name,
              deleted: true,
            } as RillValue;
          }
        );
      },
      description: 'Delete vector collection',
      returnType: 'dict',
    },

    // IR-10: pinecone::list_collections
    list_collections: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'list_collections',
          {},
          async () => {
            // Call Pinecone API to list indexes
            const response = await client.listIndexes();

            // Extract index names
            const names =
              response.indexes?.map((index) => index.name ?? '') ?? [];

            return names as RillValue;
          }
        );
      },
      description: 'List all collection names',
      returnType: 'list',
    },

    // IR-11: pinecone::describe
    describe: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed();

        // Use shared withEventEmission wrapper (IR-2)
        return withEventEmission(
          ctx as RuntimeContext,
          'pinecone',
          'describe',
          { name: factoryIndex },
          async () => {
            // Get index handle for stats
            const index = client.Index(factoryIndex);

            // Call Pinecone API to get index stats (data plane)
            const stats = await index.describeIndexStats();

            // Call Pinecone API to get index metadata (control plane)
            const indexInfo = await client.describeIndex(factoryIndex);

            // Extract collection info
            const dimensions = stats.dimension ?? 0;
            const count =
              stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;

            // Map Pinecone metric to standard format
            let distance: 'cosine' | 'euclidean' | 'dot' = 'cosine';
            const metric = indexInfo.metric;
            if (metric === 'cosine') {
              distance = 'cosine';
            } else if (metric === 'euclidean') {
              distance = 'euclidean';
            } else if (metric === 'dotproduct') {
              distance = 'dot';
            }

            // Build and return result
            return {
              name: factoryIndex,
              count,
              dimensions,
              distance,
            } as RillValue;
          }
        );
      },
      description: 'Describe configured collection',
      returnType: 'dict',
    },
  };

  // Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
