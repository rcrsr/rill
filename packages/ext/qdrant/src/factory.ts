/**
 * Extension factory for Qdrant vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  RuntimeError,
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
  checkDisposed,
  dispose,
  assertRequired,
} from '@rcrsr/rill-ext-vector-shared';
import type { QdrantConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Qdrant extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with 11 vector database functions and dispose
 * @throws Error for invalid configuration (AC-10)
 *
 * @example
 * ```typescript
 * const ext = createQdrantExtension({
 *   url: 'http://127.0.0.1:6333',
 *   collection: 'my_vectors',
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createQdrantExtension(config: QdrantConfig): ExtensionResult {
  // Validate required fields (AC-10)
  assertRequired(config.url, 'url');
  assertRequired(config.collection, 'collection');

  // Instantiate SDK client at factory time
  const clientConfig: {
    url: string;
    apiKey?: string;
    timeout?: number;
  } = { url: config.url };

  if (config.apiKey !== undefined) {
    clientConfig.apiKey = config.apiKey;
  }
  if (config.timeout !== undefined) {
    clientConfig.timeout = config.timeout;
  }

  const client = new QdrantClient(clientConfig);

  // Store config values for use in functions
  const factoryCollection = config.collection;

  // Create disposal state for tracking lifecycle
  const disposalState = createDisposalState('qdrant');

  // Dispose function for cleanup (AC-31, AC-32)
  const disposeExtension = async (): Promise<void> => {
    await dispose(disposalState, async () => {
      // Cleanup SDK HTTP connections
      // Note: Qdrant SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    });
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-1: qdrant::upsert
    upsert: {
      params: [
        { name: 'id', type: 'string' },
        { name: 'vector', type: 'vector' },
        { name: 'metadata', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const id = args[0] as string;
        const vector = args[1] as RillVector;
        const metadata = (args[2] ?? {}) as Record<string, unknown>;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'upsert',
          { id },
          async () => {
            // Call Qdrant API
            await client.upsert(factoryCollection, {
              wait: true,
              points: [
                {
                  id,
                  vector: Array.from(vector.data),
                  payload: metadata,
                },
              ],
            });

            // Build result
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

    // IR-2: qdrant::upsert_batch
    upsert_batch: {
      params: [{ name: 'items', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const items = args[0] as Array<Record<string, RillValue>>;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'upsert_batch',
          { count: items.length, succeeded: 0 },
          async () => {
            let succeeded = 0;

            // Process sequentially; halt on first failure
            for (let i = 0; i < items.length; i++) {
              const item = items[i];

              // Validate item structure
              if (!item || typeof item !== 'object') {
                return {
                  succeeded,
                  failed: `index ${i}`,
                  error: 'invalid item structure',
                } as RillValue;
              }

              const id = item['id'] as string;
              const vector = item['vector'] as RillVector;
              const metadata = (item['metadata'] ?? {}) as Record<
                string,
                unknown
              >;

              try {
                // Call Qdrant API
                await client.upsert(factoryCollection, {
                  wait: true,
                  points: [
                    {
                      id,
                      vector: Array.from(vector.data),
                      payload: metadata,
                    },
                  ],
                });

                succeeded++;
              } catch (error: unknown) {
                // Halt on first failure
                const rillError = mapVectorError('qdrant', error);
                return {
                  succeeded,
                  failed: id,
                  error: rillError.message,
                } as RillValue;
              }
            }

            // All succeeded
            return { succeeded } as RillValue;
          }
        );
      },
      description: 'Batch insert/update vectors',
      returnType: 'dict',
    },

    // IR-3: qdrant::search
    search: {
      params: [
        { name: 'vector', type: 'vector' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

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

        // Metadata object for event emission (will be updated with result_count)
        const eventMetadata = { k, result_count: 0 };

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'search',
          eventMetadata,
          async () => {
            // Build search request
            const searchRequest: {
              vector: number[];
              limit: number;
              with_payload: boolean;
              filter?: Record<string, unknown>;
              score_threshold?: number;
            } = {
              vector: Array.from(vector.data),
              limit: k,
              with_payload: true,
            };

            if (Object.keys(filter).length > 0) {
              searchRequest.filter = filter;
            }
            if (scoreThreshold !== undefined) {
              searchRequest.score_threshold = scoreThreshold;
            }

            // Call Qdrant API
            const response = await client.search(
              factoryCollection,
              searchRequest
            );

            // Build result list
            const results = response.map((hit) => ({
              id: String(hit.id),
              score: hit.score,
              metadata: hit.payload ?? {},
            }));

            // Update metadata with actual result count before event emission
            eventMetadata.result_count = results.length;

            return results as RillValue;
          }
        );
      },
      description: 'Search k nearest neighbors',
      returnType: 'list',
    },

    // IR-4: qdrant::get
    get: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const id = args[0] as string;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'get',
          { id },
          async () => {
            // Call Qdrant API
            const response = await client.retrieve(factoryCollection, {
              ids: [id],
              with_payload: true,
              with_vector: true,
            });

            // EC-7: ID not found
            if (response.length === 0) {
              throw new RuntimeError('RILL-R004', 'qdrant: id not found');
            }

            const point = response[0]!;
            const vectorData = point.vector;

            // Convert vector to Float32Array
            // vectorData can be number[] or number[][] (for named vectors) or Record (named vectors)
            let vectorArray: number[];
            if (
              Array.isArray(vectorData) &&
              vectorData.length > 0 &&
              typeof vectorData[0] === 'number'
            ) {
              // Simple vector case: number[]
              vectorArray = vectorData as number[];
            } else {
              throw new RuntimeError(
                'RILL-R004',
                'qdrant: invalid vector format'
              );
            }

            const float32Data = new Float32Array(vectorArray);
            const vector = createVector(float32Data, factoryCollection);

            // Build result
            return {
              id: String(point.id),
              vector,
              metadata: point.payload ?? {},
            } as RillValue;
          }
        );
      },
      description: 'Fetch vector by ID',
      returnType: 'dict',
    },

    // IR-5: qdrant::delete
    delete: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const id = args[0] as string;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'delete',
          { id },
          async () => {
            // Call Qdrant API (Qdrant accepts string or number IDs)
            await client.delete(factoryCollection, {
              wait: true,
              points: [id as string | number],
            });

            // Build result
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

    // IR-6: qdrant::delete_batch
    delete_batch: {
      params: [{ name: 'ids', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const ids = args[0] as Array<string>;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'delete_batch',
          { count: ids.length, succeeded: 0 },
          async () => {
            let succeeded = 0;

            // Process sequentially; halt on first failure
            for (let i = 0; i < ids.length; i++) {
              const id = ids[i];

              try {
                // Call Qdrant API (Qdrant accepts string or number IDs)
                await client.delete(factoryCollection, {
                  wait: true,
                  points: [id as string | number],
                });

                succeeded++;
              } catch (error: unknown) {
                // Halt on first failure
                const rillError = mapVectorError('qdrant', error);
                return {
                  succeeded,
                  failed: id,
                  error: rillError.message,
                } as RillValue;
              }
            }

            // All succeeded
            return { succeeded } as RillValue;
          }
        );
      },
      description: 'Batch delete vectors',
      returnType: 'dict',
    },

    // IR-7: qdrant::count
    count: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'count',
          {},
          async () => {
            // Call Qdrant API
            const response = await client.getCollection(factoryCollection);

            // Extract count
            const count = response.points_count ?? 0;

            return count as RillValue;
          }
        );
      },
      description: 'Return total vector count in collection',
      returnType: 'number',
    },

    // IR-8: qdrant::create_collection
    create_collection: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const name = args[0] as string;
        const options = (args[1] ?? {}) as Record<string, unknown>;

        // Extract options
        const dimensions = options['dimensions'] as number;
        const distance =
          (options['distance'] as 'cosine' | 'euclidean' | 'dot') ?? 'cosine';

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'create_collection',
          { name },
          async () => {
            // Map distance metric to Qdrant format
            let qdrantDistance: 'Cosine' | 'Euclid' | 'Dot';
            if (distance === 'cosine') {
              qdrantDistance = 'Cosine';
            } else if (distance === 'euclidean') {
              qdrantDistance = 'Euclid';
            } else {
              qdrantDistance = 'Dot';
            }

            // Call Qdrant API
            await client.createCollection(name, {
              vectors: {
                size: dimensions,
                distance: qdrantDistance,
              },
            });

            // Build result
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

    // IR-9: qdrant::delete_collection
    delete_collection: {
      params: [{ name: 'name', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        // Extract arguments
        const name = args[0] as string;

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'delete_collection',
          { name },
          async () => {
            // Call Qdrant API
            await client.deleteCollection(name);

            // Build result
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

    // IR-10: qdrant::list_collections
    list_collections: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'list_collections',
          {},
          async () => {
            // Call Qdrant API
            const response = await client.getCollections();

            // Extract collection names
            const names = response.collections.map((col) => col.name);

            return names as RillValue;
          }
        );
      },
      description: 'List all collection names',
      returnType: 'list',
    },

    // IR-11: qdrant::describe
    describe: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        checkDisposed(disposalState, 'qdrant');

        return withEventEmission(
          ctx as RuntimeContext,
          'qdrant',
          'describe',
          { name: factoryCollection },
          async () => {
            // Call Qdrant API
            const response = await client.getCollection(factoryCollection);

            // Extract collection info
            const vectorConfig = response.config?.params?.vectors;
            let dimensions = 0;
            let distance: 'cosine' | 'euclidean' | 'dot' = 'cosine';

            if (
              vectorConfig &&
              typeof vectorConfig === 'object' &&
              'size' in vectorConfig
            ) {
              dimensions = (vectorConfig as { size: number }).size;
              const dist = (vectorConfig as { distance: string }).distance;
              if (dist === 'Cosine') distance = 'cosine';
              else if (dist === 'Euclid') distance = 'euclidean';
              else if (dist === 'Dot') distance = 'dot';
            }

            // Build result
            return {
              name: factoryCollection,
              count: response.points_count ?? 0,
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
  result.dispose = disposeExtension;

  return result;
}
