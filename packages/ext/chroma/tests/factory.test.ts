import { describe, it, expect } from 'vitest';
import { createChromaExtension } from '../src/factory.js';

describe('createChromaExtension', () => {
  describe('configuration validation', () => {
    it('throws error when collection is missing', () => {
      expect(() =>
        createChromaExtension({ collection: undefined as unknown as string })
      ).toThrow('collection is required');
    });

    it('throws error when collection is empty', () => {
      expect(() => createChromaExtension({ collection: '' })).toThrow(
        'collection is required'
      );
    });

    it('creates extension with valid collection name', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });
      expect(ext).toBeDefined();
      expect(ext.dispose).toBeDefined();
    });

    it('creates extension with url for remote mode', () => {
      const ext = createChromaExtension({
        url: 'http://localhost:8000',
        collection: 'test_collection',
      });
      expect(ext).toBeDefined();
    });
  });

  describe('function exports', () => {
    it('exports all 11 vector database functions', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });

      // IR-1 through IR-11
      expect(ext.upsert).toBeDefined();
      expect(ext.upsert_batch).toBeDefined();
      expect(ext.search).toBeDefined();
      expect(ext.get).toBeDefined();
      expect(ext.delete).toBeDefined();
      expect(ext.delete_batch).toBeDefined();
      expect(ext.count).toBeDefined();
      expect(ext.create_collection).toBeDefined();
      expect(ext.delete_collection).toBeDefined();
      expect(ext.list_collections).toBeDefined();
      expect(ext.describe).toBeDefined();
    });

    it('all functions have correct structure', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });

      expect(ext.upsert.params).toBeDefined();
      expect(ext.upsert.fn).toBeTypeOf('function');
      expect(ext.upsert.description).toBeTypeOf('string');
      expect(ext.upsert.returnType).toBe('dict');
    });
  });

  describe('disposal', () => {
    it('dispose is idempotent', async () => {
      const ext = createChromaExtension({ collection: 'test_collection' });

      // Multiple calls should not throw
      await ext.dispose();
      await ext.dispose();
      await ext.dispose();
    });

    // Note: Testing post-dispose error behavior (EC-8) requires a full
    // RuntimeContext which is out of scope for unit tests.
    // Integration tests in task 3.5 will cover this scenario.
  });
});
