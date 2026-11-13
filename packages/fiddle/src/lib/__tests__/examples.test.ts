/**
 * Tests for code examples registry
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

import { buildContextResolverConfig } from '../context.js';
import { EXAMPLE_ORDER, loadExample } from '../examples.js';
import { executeRill } from '../execution.js';

// ============================================================
// HELPERS
// ============================================================

describe('loadExample', () => {
  describe('required examples', () => {
    it('keeps the anchor examples registered', () => {
      expect(EXAMPLE_ORDER).toEqual(
        expect.arrayContaining(['hello-world', 'pipes', 'closures', 'fold'])
      );
    });

    it.each(EXAMPLE_ORDER)('returns %s example', (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      expect(example?.id).toBe(id);
      expect(example?.label).toBeTruthy();
      expect(example?.source.length).toBeGreaterThan(0);
    });
  });

  describe('example validation', () => {
    it.each(EXAMPLE_ORDER)('%s parses without error', (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      expect(() => parse(example!.source)).not.toThrow();
    });

    it.each(EXAMPLE_ORDER)('%s executes without error', async (id) => {
      const example = loadExample(id);
      expect(example).toBeDefined();
      const result = await executeRill(
        example!.source,
        buildContextResolverConfig()
      );
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

describe('examples demonstrate their construct', () => {
  it.each<[string, unknown, string[]]>([
    ['guard-status', 'recovered', ['true', 'TYPE_MISMATCH']],
    ['retry', 'fallback', ['true', 'TYPE_MISMATCH']],
    ['streams', [5, 6, 7, 8], []],
    [
      'batching',
      [
        [1, 2, 3],
        [3, 4, 5],
        [5, 6],
      ],
      [
        'list[3, 4, 5]',
        'list[1, 2, 3, 1, 2, 3, 1]',
        'list[list[1, 2, 3], list[4, 5, 6], list[7]]',
        'list[list[1, 2, 3], list[4, 5, 6]]',
      ],
    ],
    [
      'tuples-ordered',
      { x: 1, y: 2 },
      ['true', 'true', 'list["1/3", "1/9", "2/1"]', '7'],
    ],
    ['datetime-duration', '2024-01-16T12:30:00Z', ['2024', '1', '15', '60d']],
    [
      'closure-reflection',
      42,
      ['Doubles a number', 'ordered[x: number]', 'number'],
    ],
    [
      'context-use',
      'playground allows 4096 tokens, timeout 30',
      ['playground', '4096'],
    ],
  ])('%s ends on its expected value and logs', async (id, expected, logs) => {
    const example = loadExample(id);
    expect(example).toBeDefined();
    const result = await executeRill(
      example!.source,
      buildContextResolverConfig()
    );
    expect(result.status).toBe('success');
    expect((JSON.parse(result.result!) as { value: unknown }).value).toEqual(
      expected
    );
    expect(result.logs).toEqual(logs);
  });
});
