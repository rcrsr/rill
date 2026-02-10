/**
 * Extension factory for Qdrant vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  RuntimeError,
  emitExtensionEvent,
  createVector,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
  type RillVector,
} from '@rcrsr/rill';
import type { QdrantConfig } from './types.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map Qdrant SDK error to RuntimeError with appropriate message.
 *
 * @param error - Error from Qdrant SDK
 * @returns RuntimeError with appropriate message
 */
function mapQdrantError(error: unknown): RuntimeError {
  if (error instanceof Error) {
    const message = error.message;

    // EC-1: HTTP 401 authentication failure
    if (
      message.includes('401') ||
      message.toLowerCase().includes('unauthorized')
    ) {
      return new RuntimeError(
        'RILL-R004',
        'qdrant: authentication failed (401)'
      );
    }

    // EC-2: Collection not found
    if (
      message.toLowerCase().includes('collection') &&
      message.toLowerCase().includes('not found')
    ) {
      return new RuntimeError('RILL-R004', 'qdrant: collection not found');
    }

    // EC-3: Rate limit (429)
    if (
      message.includes('429') ||
      message.toLowerCase().includes('rate limit')
    ) {
      return new RuntimeError('RILL-R004', 'qdrant: rate limit exceeded');
    }

    // EC-4: Timeout/AbortError
    if (
      error.name === 'AbortError' ||
      message.toLowerCase().includes('timeout')
    ) {
      return new RuntimeError('RILL-R004', 'qdrant: request timeout');
    }

    // EC-5: Dimension mismatch
    if (message.toLowerCase().includes('dimension')) {
      // Extract expected and actual dimensions if possible
      const match = message.match(
        /expected (\d+).*got (\d+)|(\d+).*expected.*(\d+)/i
      );
      if (match) {
        const expected = match[1] || match[4];
        const actual = match[2] || match[3];
        return new RuntimeError(
          'RILL-R004',
          `qdrant: dimension mismatch (expected ${expected}, got ${actual})`
        );
      }
      return new RuntimeError('RILL-R004', 'qdrant: dimension mismatch');
    }

    // EC-6: Collection already exists
    if (message.toLowerCase().includes('already exists')) {
      return new RuntimeError('RILL-R004', 'qdrant: collection already exists');
    }

    // EC-9: Other errors
    return new RuntimeError('RILL-R004', `qdrant: ${message}`);
  }

  return new RuntimeError('RILL-R004', 'qdrant: unknown error');
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate URL is present and non-empty.
 *
 * @param url - URL to validate
 * @throws Error if url missing or empty (AC-10)
 */
function validateUrl(url: string | undefined): asserts url is string {
  if (url === undefined) {
    throw new Error('url is required');
  }
  if (url === '') {
    throw new Error('url cannot be empty');
  }
}

/**
 * Validate collection name is present and non-empty.
 *
 * @param collection - Collection name to validate
 * @throws Error if collection missing or empty (AC-10)
 */
function validateCollection(
  collection: string | undefined
): asserts collection is string {
  if (collection === undefined || collection === '') {
    throw new Error('collection is required');
  }
}

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
  validateUrl(config.url);
  validateCollection(config.collection);

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

  // Track if disposed for EC-8
  let isDisposed = false;

  // Dispose function for cleanup (AC-31, AC-32)
  const dispose = async (): Promise<void> => {
    // AC-32: Idempotent cleanup
    if (isDisposed) {
      return;
    }
    isDisposed = true;

    try {
      // Cleanup SDK HTTP connections
      // Note: Qdrant SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Qdrant SDK: ${message}`);
    }
  };

  // Helper to check if disposed (EC-8)
  const checkDisposed = (): void => {
    if (isDisposed) {
      throw new RuntimeError('RILL-R004', 'qdrant: operation cancelled');
    }
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
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;
          const vector = args[1] as RillVector;
          const metadata = (args[2] ?? {}) as Record<string, unknown>;

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
          const result = {
            id,
            success: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:upsert',
            subsystem: 'extension:qdrant',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Insert or update single vector with metadata',
      returnType: 'dict',
    },

    // IR-2: qdrant::upsert_batch
    upsert_batch: {
      params: [{ name: 'items', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const items = args[0] as Array<Record<string, RillValue>>;

          let succeeded = 0;

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
                event: 'qdrant:upsert_batch',
                subsystem: 'extension:qdrant',
                duration,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
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
              const rillError = mapQdrantError(error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'qdrant:upsert_batch',
                subsystem: 'extension:qdrant',
                duration,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          // All succeeded
          const result = { succeeded };
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:upsert_batch',
            subsystem: 'extension:qdrant',
            duration,
            count: items.length,
            succeeded,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
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
        const startTime = Date.now();

        try {
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

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:search',
            subsystem: 'extension:qdrant',
            duration,
            result_count: results.length,
            k,
          });

          return results as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Search k nearest neighbors',
      returnType: 'list',
    },

    // IR-4: qdrant::get
    get: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;

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
          const result = {
            id: String(point.id),
            vector,
            metadata: point.payload ?? {},
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:get',
            subsystem: 'extension:qdrant',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Fetch vector by ID',
      returnType: 'dict',
    },

    // IR-5: qdrant::delete
    delete: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;

          // Call Qdrant API (Qdrant accepts string or number IDs)
          await client.delete(factoryCollection, {
            wait: true,
            points: [id as string | number],
          });

          // Build result
          const result = {
            id,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:delete',
            subsystem: 'extension:qdrant',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Delete vector by ID',
      returnType: 'dict',
    },

    // IR-6: qdrant::delete_batch
    delete_batch: {
      params: [{ name: 'ids', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const ids = args[0] as Array<string>;

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
              const rillError = mapQdrantError(error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'qdrant:delete_batch',
                subsystem: 'extension:qdrant',
                duration,
                count: ids.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          // All succeeded
          const result = { succeeded };
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:delete_batch',
            subsystem: 'extension:qdrant',
            duration,
            count: ids.length,
            succeeded,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Batch delete vectors',
      returnType: 'dict',
    },

    // IR-7: qdrant::count
    count: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Call Qdrant API
          const response = await client.getCollection(factoryCollection);

          // Extract count
          const count = response.points_count ?? 0;

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:count',
            subsystem: 'extension:qdrant',
            duration,
            count,
          });

          return count as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
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
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const name = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // Extract options
          const dimensions = options['dimensions'] as number;
          const distance =
            (options['distance'] as 'cosine' | 'euclidean' | 'dot') ?? 'cosine';

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
          const result = {
            name,
            created: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:create_collection',
            subsystem: 'extension:qdrant',
            duration,
            name,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Create new vector collection',
      returnType: 'dict',
    },

    // IR-9: qdrant::delete_collection
    delete_collection: {
      params: [{ name: 'name', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const name = args[0] as string;

          // Call Qdrant API
          await client.deleteCollection(name);

          // Build result
          const result = {
            name,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:delete_collection',
            subsystem: 'extension:qdrant',
            duration,
            name,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Delete vector collection',
      returnType: 'dict',
    },

    // IR-10: qdrant::list_collections
    list_collections: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Call Qdrant API
          const response = await client.getCollections();

          // Extract collection names
          const names = response.collections.map((col) => col.name);

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:list_collections',
            subsystem: 'extension:qdrant',
            duration,
            count: names.length,
          });

          return names as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'List all collection names',
      returnType: 'list',
    },

    // IR-11: qdrant::describe
    describe: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

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
          const result = {
            name: factoryCollection,
            count: response.points_count ?? 0,
            dimensions,
            distance,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:describe',
            subsystem: 'extension:qdrant',
            duration,
            name: factoryCollection,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapQdrantError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'qdrant:error',
            subsystem: 'extension:qdrant',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Describe configured collection',
      returnType: 'dict',
    },
  };

  // Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
