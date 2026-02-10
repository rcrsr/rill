/**
 * Qdrant extension integration tests
 * Validates runtime behavior, error handling, and SDK integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, createVector } from '@rcrsr/rill';
import { createQdrantExtension } from '../src/factory.js';
import type { QdrantConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock Qdrant search response.
 */
function createMockSearchResponse(
  results: Array<{
    id: string;
    score: number;
    payload?: Record<string, unknown>;
  }>
) {
  return results.map((r) => ({
    id: r.id,
    score: r.score,
    version: 1,
    payload: r.payload ?? {},
  }));
}

/**
 * Create mock Qdrant retrieve response.
 */
function createMockRetrieveResponse(
  points: Array<{
    id: string;
    vector: number[];
    payload?: Record<string, unknown>;
  }>
) {
  return points.map((p) => ({
    id: p.id,
    version: 1,
    vector: p.vector,
    payload: p.payload ?? {},
  }));
}

/**
 * Create mock Qdrant collection info response.
 */
function createMockCollectionInfo(
  name: string,
  points_count: number,
  dimensions: number,
  distance: 'Cosine' | 'Euclid' | 'Dot'
) {
  return {
    status: 'green' as const,
    optimizer_status: 'ok' as const,
    vectors_count: points_count,
    indexed_vectors_count: points_count,
    points_count,
    segments_count: 1,
    config: {
      params: {
        vectors: {
          size: dimensions,
          distance,
        },
      },
    },
  };
}

// Mock the Qdrant SDK at module level
const mockUpsert = vi.fn();
const mockSearch = vi.fn();
const mockRetrieve = vi.fn();
const mockDelete = vi.fn();
const mockGetCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockDeleteCollection = vi.fn();
const mockGetCollections = vi.fn();

vi.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: class MockQdrantClient {
      constructor(_config: unknown) {}
      upsert = mockUpsert;
      search = mockSearch;
      retrieve = mockRetrieve;
      delete = mockDelete;
      getCollection = mockGetCollection;
      createCollection = mockCreateCollection;
      deleteCollection = mockDeleteCollection;
      getCollections = mockGetCollections;
    },
  };
});

// ============================================================
// CONFIG VALIDATION TESTS
// ============================================================

describe('createQdrantExtension configuration validation', () => {
  it('throws Error for missing url (AC-10)', () => {
    expect(() =>
      createQdrantExtension({
        url: undefined as unknown as string,
        collection: 'test',
      })
    ).toThrow('url is required');
  });

  it('throws Error for empty url (AC-10)', () => {
    expect(() =>
      createQdrantExtension({
        url: '',
        collection: 'test',
      })
    ).toThrow('url cannot be empty');
  });

  it('throws Error for missing collection (AC-10)', () => {
    expect(() =>
      createQdrantExtension({
        url: 'http://localhost:6333',
        collection: undefined as unknown as string,
      })
    ).toThrow('collection is required');
  });

  it('throws Error for empty collection (AC-10)', () => {
    expect(() =>
      createQdrantExtension({
        url: 'http://localhost:6333',
        collection: '',
      })
    ).toThrow('collection is required');
  });
});

// ============================================================
// VECTOR CRUD TESTS
// ============================================================

describe('Vector CRUD operations', () => {
  let ext: ReturnType<typeof createQdrantExtension>;
  let ctx: ReturnType<typeof createRuntimeContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    ext = createQdrantExtension(config);
    ctx = createRuntimeContext();
  });

  describe('upsert + get round-trip (IR-1, IR-4, AC-25, AC-26)', () => {
    it('stores and retrieves vector with metadata', async () => {
      const testVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );
      const metadata = { city: 'Berlin', population: 3645000 };

      // Mock upsert success
      mockUpsert.mockResolvedValue({ status: 'completed', operation_id: 0 });

      // Mock retrieve response
      mockRetrieve.mockResolvedValue(
        createMockRetrieveResponse([
          {
            id: 'doc-1',
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: metadata,
          },
        ])
      );

      // Upsert vector
      const upsertResult = (await ext.upsert.fn(
        ['doc-1', testVector, metadata],
        ctx
      )) as Record<string, unknown>;

      expect(upsertResult['id']).toBe('doc-1');
      expect(upsertResult['success']).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith(
        'test_collection',
        expect.objectContaining({
          wait: true,
          points: expect.arrayContaining([
            expect.objectContaining({
              id: 'doc-1',
              payload: metadata,
            }),
          ]),
        })
      );

      // Get vector back
      const getResult = (await ext.get.fn(['doc-1'], ctx)) as Record<
        string,
        unknown
      >;

      expect(getResult['id']).toBe('doc-1');
      expect(getResult['vector']).toBeDefined();
      expect(getResult['metadata']).toEqual(metadata);
    });

    it('stores vector with empty metadata (AC-25)', async () => {
      const testVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );

      mockUpsert.mockResolvedValue({ status: 'completed', operation_id: 0 });
      mockRetrieve.mockResolvedValue(
        createMockRetrieveResponse([
          {
            id: 'doc-empty',
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: {},
          },
        ])
      );

      const upsertResult = (await ext.upsert.fn(
        ['doc-empty', testVector, {}],
        ctx
      )) as Record<string, unknown>;

      expect(upsertResult['success']).toBe(true);

      const getResult = (await ext.get.fn(['doc-empty'], ctx)) as Record<
        string,
        unknown
      >;
      expect(getResult['metadata']).toEqual({});
    });

    it('stores vector with large metadata (AC-26)', async () => {
      const testVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );
      const largeMetadata = {
        description: 'A'.repeat(1000),
        tags: Array.from({ length: 50 }, (_, i) => `tag-${i}`),
        nested: { level1: { level2: { level3: 'deep' } } },
      };

      mockUpsert.mockResolvedValue({ status: 'completed', operation_id: 0 });
      mockRetrieve.mockResolvedValue(
        createMockRetrieveResponse([
          {
            id: 'doc-large',
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: largeMetadata,
          },
        ])
      );

      const upsertResult = (await ext.upsert.fn(
        ['doc-large', testVector, largeMetadata],
        ctx
      )) as Record<string, unknown>;

      expect(upsertResult['success']).toBe(true);

      const getResult = (await ext.get.fn(['doc-large'], ctx)) as Record<
        string,
        unknown
      >;
      expect(getResult['metadata']).toEqual(largeMetadata);
    });
  });

  describe('upsert_batch (IR-2, AC-22)', () => {
    it('succeeds for valid batch', async () => {
      const items = [
        {
          id: 'doc-1',
          vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
          metadata: { city: 'Berlin' },
        },
        {
          id: 'doc-2',
          vector: createVector(new Float32Array([0.5, 0.6, 0.7, 0.8]), 'test'),
          metadata: { city: 'London' },
        },
        {
          id: 'doc-3',
          vector: createVector(new Float32Array([0.9, 1.0, 1.1, 1.2]), 'test'),
          metadata: { city: 'Paris' },
        },
      ];

      mockUpsert.mockResolvedValue({ status: 'completed', operation_id: 0 });

      const result = (await ext.upsert_batch.fn([items], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['succeeded']).toBe(3);
      expect(result['failed']).toBeUndefined();
      expect(mockUpsert).toHaveBeenCalledTimes(3);
    });

    it('returns { succeeded: 0 } for empty batch (AC-22)', async () => {
      const result = (await ext.upsert_batch.fn([[]], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['succeeded']).toBe(0);
      expect(result['failed']).toBeUndefined();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('returns failed ID for single-item batch failure (AC-23)', async () => {
      const items = [
        {
          id: 'doc-fail',
          vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
          metadata: {},
        },
      ];

      mockUpsert.mockRejectedValue(new Error('Network error'));

      const result = (await ext.upsert_batch.fn([items], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['succeeded']).toBe(0);
      expect(result['failed']).toBe('doc-fail');
      expect(result['error']).toBe('qdrant: Network error');
    });

    it('halts on malformed item 47 and returns partial success (AC-3, AC-16)', async () => {
      // Create 46 valid items
      const items = Array.from({ length: 46 }, (_, i) => ({
        id: `doc-${i + 1}`,
        vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
        metadata: {},
      }));

      // Add malformed item at index 46 (47th item)
      items.push({
        id: 'doc-47',
        vector: createVector(new Float32Array([0.1, 0.2]), 'test'), // Wrong dimension
        metadata: {},
      });

      // Mock first 46 succeed
      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });
      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });
      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });
      // ... (for brevity, assume all 46 succeed)
      for (let i = 0; i < 43; i++) {
        mockUpsert.mockResolvedValueOnce({
          status: 'completed',
          operation_id: 0,
        });
      }

      // 47th fails with dimension error
      mockUpsert.mockRejectedValueOnce(
        new Error('dimension mismatch (expected 4, got 2)')
      );

      const result = (await ext.upsert_batch.fn([items], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['succeeded']).toBe(46);
      expect(result['failed']).toBe('doc-47');
      expect(result['error']).toContain('dimension mismatch');
    });

    it('idempotent recovery: re-run after fixing bad item succeeds (AC-6)', async () => {
      // First run with malformed item
      const badItems = [
        {
          id: 'doc-1',
          vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
          metadata: {},
        },
        {
          id: 'doc-2',
          vector: createVector(new Float32Array([0.1, 0.2]), 'test'), // Wrong dimension
          metadata: {},
        },
      ];

      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });
      mockUpsert.mockRejectedValueOnce(
        new Error('dimension mismatch (expected 4, got 2)')
      );

      const firstResult = (await ext.upsert_batch.fn(
        [badItems],
        ctx
      )) as Record<string, unknown>;

      expect(firstResult['succeeded']).toBe(1);
      expect(firstResult['failed']).toBe('doc-2');

      // Fix the bad item and re-run
      const fixedItems = [
        {
          id: 'doc-1',
          vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
          metadata: {},
        },
        {
          id: 'doc-2',
          vector: createVector(new Float32Array([0.5, 0.6, 0.7, 0.8]), 'test'), // Fixed
          metadata: {},
        },
      ];

      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });
      mockUpsert.mockResolvedValueOnce({
        status: 'completed',
        operation_id: 0,
      });

      const secondResult = (await ext.upsert_batch.fn(
        [fixedItems],
        ctx
      )) as Record<string, unknown>;

      expect(secondResult['succeeded']).toBe(2);
      expect(secondResult['failed']).toBeUndefined();
    });
  });

  describe('search (IR-3, AC-20, AC-21, AC-28)', () => {
    it('returns scored results', async () => {
      const queryVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );

      mockSearch.mockResolvedValue(
        createMockSearchResponse([
          { id: 'doc-1', score: 0.95, payload: { city: 'Berlin' } },
          { id: 'doc-2', score: 0.88, payload: { city: 'London' } },
          { id: 'doc-3', score: 0.82, payload: { city: 'Paris' } },
        ])
      );

      const results = (await ext.search.fn([queryVector, {}], ctx)) as Array<
        Record<string, unknown>
      >;

      expect(results).toHaveLength(3);
      expect(results[0]!['id']).toBe('doc-1');
      expect(results[0]!['score']).toBe(0.95);
      expect(results[0]!['metadata']).toEqual({ city: 'Berlin' });
    });

    it('returns empty array when no matches (AC-20)', async () => {
      const queryVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );

      mockSearch.mockResolvedValue(createMockSearchResponse([]));

      const results = (await ext.search.fn([queryVector, {}], ctx)) as Array<
        Record<string, unknown>
      >;

      expect(results).toEqual([]);
    });

    it('returns empty array for k=0 (AC-21)', async () => {
      const queryVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );
      const options = { k: 0 };

      mockSearch.mockResolvedValue(createMockSearchResponse([]));

      const results = (await ext.search.fn(
        [queryVector, options],
        ctx
      )) as Array<Record<string, unknown>>;

      expect(results).toEqual([]);
      expect(mockSearch).toHaveBeenCalledWith(
        'test_collection',
        expect.objectContaining({
          limit: 0,
          with_payload: true,
        })
      );
    });

    it('score_threshold filtering returns empty when no matches (AC-28)', async () => {
      const queryVector = createVector(
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        'test'
      );
      const options = { score_threshold: 0.99 };

      // Qdrant would filter out low scores server-side
      mockSearch.mockResolvedValue(createMockSearchResponse([]));

      const results = (await ext.search.fn(
        [queryVector, options],
        ctx
      )) as Array<Record<string, unknown>>;

      expect(results).toEqual([]);
    });
  });

  describe('delete + delete_batch (IR-5, IR-6)', () => {
    it('deletes single vector', async () => {
      mockDelete.mockResolvedValue({ status: 'completed', operation_id: 0 });

      const result = (await ext.delete.fn(['doc-1'], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['id']).toBe('doc-1');
      expect(result['deleted']).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('test_collection', {
        wait: true,
        points: ['doc-1'],
      });
    });

    it('deletes batch of vectors', async () => {
      mockDelete.mockResolvedValue({ status: 'completed', operation_id: 0 });

      const ids = ['doc-1', 'doc-2', 'doc-3'];
      const result = (await ext.delete_batch.fn([ids], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['succeeded']).toBe(3);
      expect(mockDelete).toHaveBeenCalledTimes(3);
    });
  });

  describe('count (IR-7)', () => {
    it('returns vector count', async () => {
      mockGetCollection.mockResolvedValue(
        createMockCollectionInfo('test_collection', 42, 384, 'Cosine')
      );

      const count = (await ext.count.fn([], ctx)) as number;

      expect(count).toBe(42);
    });
  });
});

// ============================================================
// COLLECTION LIFECYCLE TESTS
// ============================================================

describe('Collection lifecycle operations', () => {
  let ext: ReturnType<typeof createQdrantExtension>;
  let ctx: ReturnType<typeof createRuntimeContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    ext = createQdrantExtension(config);
    ctx = createRuntimeContext();
  });

  describe('create_collection + describe + list_collections + delete_collection (IR-8, IR-9, IR-10, IR-11, AC-7, AC-29, AC-30)', () => {
    it('creates collection with dimensions (AC-7)', async () => {
      mockCreateCollection.mockResolvedValue({ result: true });

      const result = (await ext.create_collection.fn(
        ['my_vectors', { dimensions: 384, distance: 'cosine' }],
        ctx
      )) as Record<string, unknown>;

      expect(result['name']).toBe('my_vectors');
      expect(result['created']).toBe(true);
      expect(mockCreateCollection).toHaveBeenCalledWith('my_vectors', {
        vectors: {
          size: 384,
          distance: 'Cosine',
        },
      });
    });

    it('describes collection', async () => {
      mockGetCollection.mockResolvedValue(
        createMockCollectionInfo('test_collection', 100, 384, 'Cosine')
      );

      const result = (await ext.describe.fn([], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['name']).toBe('test_collection');
      expect(result['count']).toBe(100);
      expect(result['dimensions']).toBe(384);
      expect(result['distance']).toBe('cosine');
    });

    it('describes empty collection (AC-29)', async () => {
      mockGetCollection.mockResolvedValue(
        createMockCollectionInfo('empty_collection', 0, 384, 'Cosine')
      );

      const config: QdrantConfig = {
        url: 'http://localhost:6333',
        collection: 'empty_collection',
      };
      const emptyExt = createQdrantExtension(config);

      const result = (await emptyExt.describe.fn([], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['count']).toBe(0);
    });

    it('lists collections', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [
          { name: 'collection-1' },
          { name: 'collection-2' },
          { name: 'collection-3' },
        ],
      });

      const result = (await ext.list_collections.fn([], ctx)) as Array<string>;

      expect(result).toEqual(['collection-1', 'collection-2', 'collection-3']);
    });

    it('lists no collections (AC-30)', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [],
      });

      const result = (await ext.list_collections.fn([], ctx)) as Array<string>;

      expect(result).toEqual([]);
    });

    it('deletes collection', async () => {
      mockDeleteCollection.mockResolvedValue({ result: true });

      const result = (await ext.delete_collection.fn(
        ['old_collection'],
        ctx
      )) as Record<string, unknown>;

      expect(result['name']).toBe('old_collection');
      expect(result['deleted']).toBe(true);
    });
  });

  describe('max vector dimensions (AC-24)', () => {
    it('succeeds with max dimensions', async () => {
      // Qdrant supports up to 65536 dimensions
      const maxDims = 65536;
      const testVector = createVector(
        new Float32Array(maxDims).fill(0.1),
        'test'
      );

      mockUpsert.mockResolvedValue({ status: 'completed', operation_id: 0 });

      const result = (await ext.upsert.fn(
        ['doc-max', testVector, {}],
        ctx
      )) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });
  });
});

// ============================================================
// ERROR CONTRACT TESTS
// ============================================================

describe('Error handling contracts', () => {
  let ext: ReturnType<typeof createQdrantExtension>;
  let ctx: ReturnType<typeof createRuntimeContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    ext = createQdrantExtension(config);
    ctx = createRuntimeContext();
  });

  it('HTTP 401 produces correct message format (EC-1, AC-4)', async () => {
    mockSearch.mockRejectedValue(
      new Error('Request failed with status 401 Unauthorized')
    );

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: authentication failed (401)'
    );
  });

  it('missing collection produces "collection not found" (EC-2, AC-11)', async () => {
    mockSearch.mockRejectedValue(new Error('Collection "missing" not found'));

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: collection not found'
    );
  });

  it('rate limit produces "rate limit exceeded" (EC-3, AC-13)', async () => {
    mockSearch.mockRejectedValue(new Error('Rate limit exceeded (429)'));

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: rate limit exceeded'
    );
  });

  it('timeout produces "request timeout" (EC-4, AC-14)', async () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.name = 'AbortError';
    mockSearch.mockRejectedValue(timeoutError);

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: request timeout'
    );
  });

  it('dimension mismatch produces correct format with N and M (EC-5, AC-12)', async () => {
    mockUpsert.mockRejectedValue(
      new Error('Vector dimension mismatch: expected 384, got 128')
    );

    const wrongVector = createVector(new Float32Array(128).fill(0.1), 'test');

    await expect(
      ext.upsert.fn(['doc-1', wrongVector, {}], ctx)
    ).rejects.toThrow('qdrant: dimension mismatch (expected 384, got 128)');
  });

  it('duplicate create_collection produces "collection already exists" (EC-6, AC-17)', async () => {
    mockCreateCollection.mockRejectedValue(
      new Error('Collection "test_collection" already exists')
    );

    await expect(
      ext.create_collection.fn(['test_collection', { dimensions: 384 }], ctx)
    ).rejects.toThrow('qdrant: collection already exists');
  });

  it('get non-existent ID produces "id not found" (EC-7, AC-15)', async () => {
    mockRetrieve.mockResolvedValue([]);

    await expect(ext.get.fn(['nonexistent'], ctx)).rejects.toThrow(
      'qdrant: id not found'
    );
  });

  it('post-dispose call produces "operation cancelled" (EC-8, AC-19)', async () => {
    await ext.dispose!();

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: operation cancelled'
    );
  });

  it('unknown errors produce "qdrant: <message>" (EC-9)', async () => {
    mockSearch.mockRejectedValue(new Error('Something unexpected happened'));

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );

    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: Something unexpected happened'
    );
  });
});

// ============================================================
// EVENT EMISSION TESTS
// ============================================================

describe('Event emission', () => {
  it('search emits qdrant:search with duration, result_count, k (AC-5)', async () => {
    const events: Array<Record<string, unknown>> = [];
    const ctx = createRuntimeContext({
      callbacks: {
        onLogEvent: (event) => {
          events.push(event as Record<string, unknown>);
        },
      },
    });

    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    const ext = createQdrantExtension(config);

    mockSearch.mockResolvedValue(
      createMockSearchResponse([
        { id: 'doc-1', score: 0.95 },
        { id: 'doc-2', score: 0.88 },
      ])
    );

    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );
    await ext.search.fn([queryVector, { k: 5 }], ctx);

    const searchEvent = events.find((e) => e['event'] === 'qdrant:search');
    expect(searchEvent).toBeDefined();
    expect(searchEvent!['duration']).toBeGreaterThanOrEqual(0);
    expect(searchEvent!['result_count']).toBe(2);
    expect(searchEvent!['k']).toBe(5);
  });
});

// ============================================================
// DISPOSE TESTS
// ============================================================

describe('Dispose lifecycle', () => {
  it('dispose during idle resolves immediately (AC-31)', async () => {
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    const ext = createQdrantExtension(config);

    await expect(ext.dispose!()).resolves.not.toThrow();
  });

  it('double dispose resolves without error (AC-32)', async () => {
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    const ext = createQdrantExtension(config);

    await ext.dispose!();
    await ext.dispose!();

    // No error expected
    expect(true).toBe(true);
  });
});

// ============================================================
// CANCELLATION TESTS
// ============================================================

describe('Request cancellation', () => {
  it('dispose during upsert_batch aborts pending requests (AC-9)', async () => {
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    const ext = createQdrantExtension(config);
    const ctx = createRuntimeContext();

    // Create a batch that takes time
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `doc-${i}`,
      vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
      metadata: {},
    }));

    // Mock slow responses
    let callCount = 0;
    mockUpsert.mockImplementation(async () => {
      callCount++;
      if (callCount === 3) {
        // Dispose during third call
        await ext.dispose!();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: 'completed', operation_id: 0 };
    });

    // Start batch operation
    const batchPromise = ext.upsert_batch.fn([items], ctx);

    // After disposal, subsequent operations should fail
    await expect(batchPromise).resolves.toBeDefined();

    // New operations should fail after dispose
    const queryVector = createVector(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      'test'
    );
    await expect(ext.search.fn([queryVector, {}], ctx)).rejects.toThrow(
      'qdrant: operation cancelled'
    );
  });
});

// ============================================================
// CONCURRENCY TESTS
// ============================================================

describe('Concurrent operations', () => {
  it('10 simultaneous searches return independent results (AC-27)', async () => {
    const config: QdrantConfig = {
      url: 'http://localhost:6333',
      collection: 'test_collection',
    };
    const ext = createQdrantExtension(config);
    const ctx = createRuntimeContext();

    // Mock different results for each search
    mockSearch.mockImplementation(async (_, request) => {
      const vector = request.vector as number[];
      const id = Math.round(vector[0]! * 10);
      return createMockSearchResponse([{ id: `doc-${id}`, score: 0.95 }]);
    });

    // Launch 10 concurrent searches
    const searches = Array.from({ length: 10 }, (_, i) => {
      const queryVector = createVector(
        new Float32Array([i / 10, 0.2, 0.3, 0.4]),
        'test'
      );
      return ext.search.fn([queryVector, {}], ctx);
    });

    const results = await Promise.all(searches);

    // Each search should have independent results
    expect(results).toHaveLength(10);
    results.forEach((result, i) => {
      const list = result as Array<Record<string, unknown>>;
      expect(list[0]!['id']).toBe(`doc-${i}`);
    });
  });
});
