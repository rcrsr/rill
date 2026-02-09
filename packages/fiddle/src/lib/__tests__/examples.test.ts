/**
 * Tests for code examples registry
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

import { loadExample } from '../examples.js';

describe('loadExample', () => {
  describe('required examples', () => {
    it('returns hello-world example', () => {
      const example = loadExample('hello-world');
      expect(example).toBeDefined();
      expect(example?.id).toBe('hello-world');
      expect(example?.label).toBe('Hello World');
      expect(example?.source).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });

    it('returns variables example', () => {
      const example = loadExample('variables');
      expect(example).toBeDefined();
      expect(example?.id).toBe('variables');
      expect(example?.label).toBe('Variables');
      expect(example?.source).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });

    it('returns pipes example', () => {
      const example = loadExample('pipes');
      expect(example).toBeDefined();
      expect(example?.id).toBe('pipes');
      expect(example?.label).toBe('Pipes');
      expect(example?.source).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });

    it('returns functions example', () => {
      const example = loadExample('functions');
      expect(example).toBeDefined();
      expect(example?.id).toBe('functions');
      expect(example?.label).toBe('Functions');
      expect(example?.source).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });

    it('returns conditionals example', () => {
      const example = loadExample('conditionals');
      expect(example).toBeDefined();
      expect(example?.id).toBe('conditionals');
      expect(example?.label).toBe('Conditionals');
      expect(example?.source).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });

    it('returns all new examples', () => {
      const newIds = [
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
      ];
      for (const id of newIds) {
        const example = loadExample(id);
        expect(example).toBeDefined();
        expect(example?.id).toBe(id);
        expect(example?.label).toBeTruthy();
        expect(example?.source.length).toBeGreaterThan(0);
      }
    });
  });

  describe('example validation', () => {
    it('all required examples parse without error', () => {
      const requiredIds = [
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
      ];

      for (const id of requiredIds) {
        const example = loadExample(id);
        expect(example).toBeDefined();

        // Verify source parses as valid Rill code
        expect(() => parse(example!.source)).not.toThrow();
      }
    });

    it('all examples have matching id property', () => {
      const requiredIds = [
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
      ];

      for (const id of requiredIds) {
        const example = loadExample(id);
        expect(example?.id).toBe(id);
      }
    });

    it('all examples have non-empty labels', () => {
      const requiredIds = [
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
      ];

      for (const id of requiredIds) {
        const example = loadExample(id);
        expect(example?.label).toBeTruthy();
        expect(example!.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('unknown example ID', () => {
    it('returns undefined for unknown ID', () => {
      const example = loadExample('nonexistent-example');
      expect(example).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      const example = loadExample('');
      expect(example).toBeUndefined();
    });

    it('returns undefined for special characters', () => {
      const example = loadExample('!!!invalid!!!');
      expect(example).toBeUndefined();
    });
  });

  describe('example structure', () => {
    it('returns readonly CodeExample interface', () => {
      const example = loadExample('hello-world');
      expect(example).toBeDefined();

      // Verify structure matches CodeExample interface
      expect(example).toHaveProperty('id');
      expect(example).toHaveProperty('label');
      expect(example).toHaveProperty('source');

      expect(typeof example?.id).toBe('string');
      expect(typeof example?.label).toBe('string');
      expect(typeof example?.source).toBe('string');
    });
  });
});
