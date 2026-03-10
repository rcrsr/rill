/**
 * Tests for code examples registry
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

import { loadExample } from '../examples.js';
import { executeRill } from '../execution.js';

const ALL_EXAMPLE_IDS = [
  'hello-world',
  'variables',
  'pipes',
  'functions',
  'conditionals',
  'fold',
  'fizzbuzz',
  'dispatch',
  'closures',
  'collection-pipeline',
  'destructuring',
  'slicing',
  'type-checking',
  'string-processing',
  'dict-methods',
  'state-machine',
  'spread',
  'type-conversion',
  'while-loop',
  'typed-closures',
  'existence-defaults',
  'assert-error',
  'break-return',
  'pass-keyword',
  'enumerate',
  'dict-iteration',
  'list-dispatch',
  'comparison-methods',
];

describe('loadExample', () => {
  describe('required examples', () => {
    it.each(ALL_EXAMPLE_IDS)('returns %s example', (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      expect(example?.id).toBe(id);
      expect(example?.label).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });
  });

  describe('example validation', () => {
    it.each(ALL_EXAMPLE_IDS)('%s parses without error', (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      expect(() => parse(example!.source)).not.toThrow();
    });

    it.each(ALL_EXAMPLE_IDS)('%s executes without error', async (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      const result = await executeRill(example!.source);
      expect(result.status).toBe('success');
    });
  });

  describe('unknown example ID', () => {
    it('returns undefined for unknown ID', () => {
      expect(loadExample('nonexistent-example')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(loadExample('')).toBeUndefined();
    });

    it('returns undefined for special characters', () => {
      expect(loadExample('!!!invalid!!!')).toBeUndefined();
    });
  });

  describe('example structure', () => {
    it('returns readonly CodeExample interface', () => {
      const example = loadExample('hello-world');
      expect(example).toBeDefined();
      expect(example).toHaveProperty('id');
      expect(example).toHaveProperty('label');
      expect(example).toHaveProperty('source');
      expect(typeof example?.id).toBe('string');
      expect(typeof example?.label).toBe('string');
      expect(typeof example?.source).toBe('string');
    });
  });
});
