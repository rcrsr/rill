/**
 * Extension factory for ChromaDB vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { ChromaClient } from 'chromadb';
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
  createDisposalState,
  checkDisposed,
  dispose,
  assertRequired,
  type DisposalState,
} from '@rcrsr/rill-ext-vector-shared';
import type { ChromaConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create ChromaDB extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with 11 vector database functions and dispose
 * @throws Error for invalid configuration (AC-10)
 *
 * @example
 * ```typescript
 * // Embedded mode
 * const ext = createChromaExtension({
 *   collection: 'my_vectors',
 * });
 *
 * // HTTP mode
 * const ext = createChromaExtension({
 *   url: 'http://localhost:8000',
 *   collection: 'my_vectors',
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createChromaExtension(config: ChromaConfig): ExtensionResult {
  // Validate required fields (AC-10)
  assertRequired(config.collection, 'collection');

  // Instantiate SDK client at factory time
  // Use embedded mode if url undefined, remote otherwise
  const clientConfig: {
    path?: string;
  } = {};

  if (config.url !== undefined) {
    clientConfig.path = config.url;
  }

  const client = new ChromaClient(clientConfig);

  // Store config values for use in functions
  const factoryCollection = config.collection;

  // Track disposal state (EC-8)
  const disposalState: DisposalState = createDisposalState('chroma');

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-1: chroma::upsert
    upsert: {
      params: [
        { name: 'id', type: 'string' },
        { name: 'vector', type: 'vector' },
        { name: 'metadata', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const id = args[0] as string;
          const vector = args[1] as RillVector;
          const metadata = (args[2] ?? {}) as Record<string, unknown>;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Call ChromaDB API
          await collection.upsert({
            ids: [id],
            embeddings: [Array.from(vector.data)],
            metadatas: [metadata as Record<string, string | number | boolean>],
          });

          // Build result
          const result = {
            id,
            success: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:upsert',
            subsystem: 'extension:chroma',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Insert or update single vector with metadata',
      returnType: 'dict',
    },

    // IR-2: chroma::upsert_batch
    upsert_batch: {
      params: [{ name: 'items', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const items = args[0] as Array<Record<string, RillValue>>;

          let succeeded = 0;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

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
                event: 'chroma:upsert_batch',
                subsystem: 'extension:chroma',
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
              // Call ChromaDB API
              await collection.upsert({
                ids: [id],
                embeddings: [Array.from(vector.data)],
                metadatas: [
                  metadata as Record<string, string | number | boolean>,
                ],
              });

              succeeded++;
            } catch (error: unknown) {
              // Halt on first failure
              const rillError = mapVectorError('chroma', error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'chroma:upsert_batch',
                subsystem: 'extension:chroma',
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
            event: 'chroma:upsert_batch',
            subsystem: 'extension:chroma',
            duration,
            count: items.length,
            succeeded,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Batch insert/update vectors',
      returnType: 'dict',
    },

    // IR-3: chroma::search
    search: {
      params: [
        { name: 'vector', type: 'vector' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const vector = args[0] as RillVector;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // Extract options with defaults
          const k = typeof options['k'] === 'number' ? options['k'] : 10;
          const filter = (options['filter'] ?? {}) as Record<string, unknown>;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Build query request
          const queryRequest: {
            queryEmbeddings: number[][];
            nResults: number;
            where?: Record<string, unknown>;
          } = {
            queryEmbeddings: [Array.from(vector.data)],
            nResults: k,
          };

          if (Object.keys(filter).length > 0) {
            queryRequest.where = filter;
          }

          // Call ChromaDB API
          const response = await collection.query(queryRequest);

          // Build result list from first query results
          const results = response.ids[0]!.map((id, idx) => ({
            id: String(id),
            score: response.distances?.[0]?.[idx] ?? 0,
            metadata: response.metadatas?.[0]?.[idx] ?? {},
          }));

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:search',
            subsystem: 'extension:chroma',
            duration,
            result_count: results.length,
            k,
          });

          return results as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Search k nearest neighbors',
      returnType: 'list',
    },

    // IR-4: chroma::get
    get: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const id = args[0] as string;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Call ChromaDB API
          const response = await collection.get({
            ids: [id],
          });

          // EC-7: ID not found
          if (response.ids.length === 0) {
            throw new RuntimeError('RILL-R004', 'chroma: id not found');
          }

          const embedding = response.embeddings?.[0];
          const metadata = response.metadatas?.[0];

          // Convert embedding to Float32Array
          if (!embedding || !Array.isArray(embedding)) {
            throw new RuntimeError(
              'RILL-R004',
              'chroma: invalid vector format'
            );
          }

          const float32Data = new Float32Array(embedding);
          const vector = createVector(float32Data, factoryCollection);

          // Build result
          const result = {
            id: String(response.ids[0]),
            vector,
            metadata: metadata ?? {},
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:get',
            subsystem: 'extension:chroma',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Fetch vector by ID',
      returnType: 'dict',
    },

    // IR-5: chroma::delete
    delete: {
      params: [{ name: 'id', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const id = args[0] as string;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Call ChromaDB API
          await collection.delete({
            ids: [id],
          });

          // Build result
          const result = {
            id,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:delete',
            subsystem: 'extension:chroma',
            duration,
            id,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Delete vector by ID',
      returnType: 'dict',
    },

    // IR-6: chroma::delete_batch
    delete_batch: {
      params: [{ name: 'ids', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const ids = args[0] as Array<string>;

          let succeeded = 0;

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Process sequentially; halt on first failure
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i]!;

            try {
              // Call ChromaDB API
              await collection.delete({
                ids: [id],
              });

              succeeded++;
            } catch (error: unknown) {
              // Halt on first failure
              const rillError = mapVectorError('chroma', error);
              const result = {
                succeeded,
                failed: id,
                error: rillError.message,
              };
              const duration = Date.now() - startTime;
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'chroma:delete_batch',
                subsystem: 'extension:chroma',
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
            event: 'chroma:delete_batch',
            subsystem: 'extension:chroma',
            duration,
            count: ids.length,
            succeeded,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Batch delete vectors',
      returnType: 'dict',
    },

    // IR-7: chroma::count
    count: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Call ChromaDB API
          const count = await collection.count();

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:count',
            subsystem: 'extension:chroma',
            duration,
            count,
          });

          return count as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Return total vector count in collection',
      returnType: 'number',
    },

    // IR-8: chroma::create_collection
    create_collection: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const name = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // Extract metadata options
          const metadata = (options['metadata'] ?? {}) as Record<
            string,
            unknown
          >;

          // Call ChromaDB API
          await client.createCollection({
            name,
            metadata,
          });

          // Build result
          const result = {
            name,
            created: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:create_collection',
            subsystem: 'extension:chroma',
            duration,
            name,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Create new vector collection',
      returnType: 'dict',
    },

    // IR-9: chroma::delete_collection
    delete_collection: {
      params: [{ name: 'name', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Extract arguments
          const name = args[0] as string;

          // Call ChromaDB API
          await client.deleteCollection({ name });

          // Build result
          const result = {
            name,
            deleted: true,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:delete_collection',
            subsystem: 'extension:chroma',
            duration,
            name,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Delete vector collection',
      returnType: 'dict',
    },

    // IR-10: chroma::list_collections
    list_collections: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Call ChromaDB API
          const names = await client.listCollections();

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:list_collections',
            subsystem: 'extension:chroma',
            duration,
            count: names.length,
          });

          return names as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'List all collection names',
      returnType: 'list',
    },

    // IR-11: chroma::describe
    describe: {
      params: [],
      fn: async (_args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          checkDisposed(disposalState, 'chroma');

          // Get or create collection
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          // Call ChromaDB API
          const count = await collection.count();

          // Build result (ChromaDB doesn't expose dimensions/distance in collection metadata)
          const result = {
            name: factoryCollection,
            count,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:describe',
            subsystem: 'extension:chroma',
            duration,
            name: factoryCollection,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapVectorError('chroma', error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'chroma:error',
            subsystem: 'extension:chroma',
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

  // Attach dispose lifecycle method using shared utility
  result.dispose = async (): Promise<void> => {
    await dispose(disposalState, async () => {
      // Cleanup SDK HTTP connections
      // Note: ChromaDB SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    });
  };

  return result;
}
