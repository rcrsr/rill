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
import type { PineconeConfig } from './types.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map Pinecone SDK error to RuntimeError with appropriate message.
 *
 * @param error - Error from Pinecone SDK
 * @returns RuntimeError with appropriate message
 */
function mapPineconeError(error: unknown): RuntimeError {
  if (error instanceof Error) {
    const message = error.message;

    // EC-1: HTTP 401 authentication failure
    if (
      message.includes('401') ||
      message.toLowerCase().includes('unauthorized') ||
      message.toLowerCase().includes('authentication')
    ) {
      return new RuntimeError(
        'RILL-R004',
        'pinecone: authentication failed (401)'
      );
    }

    // EC-2: Index not found (404)
    if (
      message.toLowerCase().includes('index') &&
      message.toLowerCase().includes('not found')
    ) {
      return new RuntimeError('RILL-R004', 'pinecone: collection not found');
    }

    // EC-3: Rate limit (429)
    if (
      message.includes('429') ||
      message.toLowerCase().includes('rate limit')
    ) {
      return new RuntimeError('RILL-R004', 'pinecone: rate limit exceeded');
    }

    // EC-4: Timeout/AbortError
    if (
      error.name === 'AbortError' ||
      message.toLowerCase().includes('timeout')
    ) {
      return new RuntimeError('RILL-R004', 'pinecone: request timeout');
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
          `pinecone: dimension mismatch (expected ${expected}, got ${actual})`
        );
      }
      return new RuntimeError('RILL-R004', 'pinecone: dimension mismatch');
    }

    // EC-6: Index already exists
    if (message.toLowerCase().includes('already exists')) {
      return new RuntimeError(
        'RILL-R004',
        'pinecone: collection already exists'
      );
    }

    // EC-9: Other errors
    return new RuntimeError('RILL-R004', `pinecone: ${message}`);
  }

  return new RuntimeError('RILL-R004', 'pinecone: unknown error');
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate API key is present and non-empty.
 *
 * @param apiKey - API key to validate
 * @throws Error if apiKey missing or empty (AC-10)
 */
function validateApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (apiKey === undefined) {
    throw new Error('apiKey is required');
  }
  if (apiKey === '') {
    throw new Error('apiKey cannot be empty');
  }
}

/**
 * Validate index name is present and non-empty.
 *
 * @param index - Index name to validate
 * @throws Error if index missing or empty (AC-10)
 */
function validateIndex(index: string | undefined): asserts index is string {
  if (index === undefined || index === '') {
    throw new Error('index is required');
  }
}

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
  // Validate required fields (AC-10)
  validateApiKey(config.apiKey);
  validateIndex(config.index);

  // Instantiate SDK client at factory time
  const client = new Pinecone({
    apiKey: config.apiKey,
  });

  // Store config values for use in functions
  const factoryIndex = config.index;
  const factoryNamespace: string = config.namespace ?? '';

  // Track if disposed for EC-8
  let isDisposed = false;

  // Dispose function for cleanup (AC-31, AC-32)
  const dispose = async (): Promise<void> => {
    // AC-32: Idempotent cleanup
    if (isDisposed) {
      return;
    }
    isDisposed = true;
  };

  // Helper to check if disposed (EC-8)
  const checkDisposed = (): void => {
    if (isDisposed) {
      throw new RuntimeError('RILL-R004', 'pinecone: operation cancelled');
    }
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
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;
          const vector = args[1] as RillVector;
          const metadataArg = (args[2] ?? {}) as Record<string, unknown>;

          // Get index handle
          const index = client.Index(factoryIndex);

          // Convert metadata
          const metadata = convertMetadata(metadataArg);

          // Call Pinecone API
          await index.namespace(factoryNamespace).upsert([
            {
              id,
              values: Array.from(vector.data),
              metadata,
            },
          ]);

          // Build result
          const result = {
            id,
            success: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:upsert',
            subsystem: 'extension:pinecone',
            duration,
            id,
          });

          return result as RillValue;
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

          // Emit success event
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
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;

          // Get index handle
          const index = client.Index(factoryIndex);

          // Call Pinecone API
          const response = await index.namespace(factoryNamespace).fetch([id]);

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

          // Build result
          const result = {
            id,
            vector,
            metadata: record.metadata ?? {},
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:get',
            subsystem: 'extension:pinecone',
            duration,
            id,
          });

          return result as RillValue;
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
      description: 'Fetch vector by ID',
      returnType: 'dict',
    },

    // IR-5: pinecone::delete
    delete: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const id = args[0] as string;

          // Get index handle
          const index = client.Index(factoryIndex);

          // Call Pinecone API
          const ns = factoryNamespace || '';
          await index.namespace(ns).deleteOne(id);

          // Build result
          const result = {
            id,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:delete',
            subsystem: 'extension:pinecone',
            duration,
            id,
          });

          return result as RillValue;
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
        const startTime = Date.now();

        try {
          checkDisposed();

          // Get index handle
          const index = client.Index(factoryIndex);

          // Call Pinecone API to get index stats
          const stats = await index.describeIndexStats();

          // Extract count from the target namespace
          const count = stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:count',
            subsystem: 'extension:pinecone',
            duration,
            count,
          });

          return count as RillValue;
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

          // Validate dimensions
          if (
            !dimensions ||
            typeof dimensions !== 'number' ||
            dimensions <= 0
          ) {
            throw new RuntimeError(
              'RILL-R004',
              'pinecone: dimensions must be a positive integer'
            );
          }

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

          // Build result
          const result = {
            name,
            created: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:create_collection',
            subsystem: 'extension:pinecone',
            duration,
            name,
          });

          return result as RillValue;
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
      description: 'Create new vector collection',
      returnType: 'dict',
    },

    // IR-9: pinecone::delete_collection
    delete_collection: {
      params: [{ name: 'name', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Extract arguments
          const name = args[0] as string;

          // Call Pinecone API to delete index
          await client.deleteIndex(name);

          // Build result
          const result = {
            name,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:delete_collection',
            subsystem: 'extension:pinecone',
            duration,
            name,
          });

          return result as RillValue;
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
      description: 'Delete vector collection',
      returnType: 'dict',
    },

    // IR-10: pinecone::list_collections
    list_collections: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Call Pinecone API to list indexes
          const response = await client.listIndexes();

          // Extract index names
          const names =
            response.indexes?.map((index) => index.name ?? '') ?? [];

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:list_collections',
            subsystem: 'extension:pinecone',
            duration,
            count: names.length,
          });

          return names as RillValue;
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
      description: 'List all collection names',
      returnType: 'list',
    },

    // IR-11: pinecone::describe
    describe: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed();

          // Get index handle for stats
          const index = client.Index(factoryIndex);

          // Call Pinecone API to get index stats (data plane)
          const stats = await index.describeIndexStats();

          // Call Pinecone API to get index metadata (control plane)
          const indexInfo = await client.describeIndex(factoryIndex);

          // Extract collection info
          const dimensions = stats.dimension ?? 0;
          const count = stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;

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

          // Build result
          const result = {
            name: factoryIndex,
            count,
            dimensions,
            distance,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'pinecone:describe',
            subsystem: 'extension:pinecone',
            duration,
            name: factoryIndex,
          });

          return result as RillValue;
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
      description: 'Describe configured collection',
      returnType: 'dict',
    },
  };

  // Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
