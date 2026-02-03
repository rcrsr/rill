/**
 * Tests for renderMessage template function.
 * Covers AC-5, AC-6, AC-12, AC-13, AC-14, EC-4, EC-5, EC-6.
 */

import { describe, it, expect } from 'vitest';
import { renderMessage } from '../../src/types.js';

describe('renderMessage', () => {
  describe('basic placeholder replacement', () => {
    it('replaces single placeholder with context value (AC-5)', () => {
      const result = renderMessage('Expected {expected}, got {actual}', {
        expected: 'string',
        actual: 'number',
      });
      expect(result).toBe('Expected string, got number');
    });

    it('replaces multiple occurrences of same placeholder', () => {
      const result = renderMessage('{name} says hello, {name}!', {
        name: 'Alice',
      });
      expect(result).toBe('Alice says hello, Alice!');
    });

    it('handles multiple different placeholders', () => {
      const result = renderMessage(
        'Function {function} expects parameter {param} (position {position}) to be {expected}, got {actual}',
        {
          function: 'greet',
          param: 'name',
          position: '0',
          expected: 'string',
          actual: 'number',
        }
      );
      expect(result).toBe(
        'Function greet expects parameter name (position 0) to be string, got number'
      );
    });
  });

  describe('missing placeholders', () => {
    it('renders missing placeholder as empty string (AC-6)', () => {
      const result = renderMessage('Hello {name}, welcome!', {});
      expect(result).toBe('Hello , welcome!');
    });

    it('renders empty string when context is empty (AC-12)', () => {
      const result = renderMessage('Hello {name}', {});
      expect(result).toBe('Hello ');
    });

    it('handles mix of present and missing placeholders', () => {
      const result = renderMessage('{greeting} {name}, {message}', {
        greeting: 'Hello',
      });
      expect(result).toBe('Hello , ');
    });
  });

  describe('templates without placeholders', () => {
    it('returns template unchanged when no placeholders (AC-13)', () => {
      const result = renderMessage('No placeholders', {});
      expect(result).toBe('No placeholders');
    });

    it('ignores context when no placeholders (AC-14)', () => {
      const result = renderMessage('Static message', { x: 1 });
      expect(result).toBe('Static message');
    });

    it('handles empty template', () => {
      const result = renderMessage('', {});
      expect(result).toBe('');
    });
  });

  describe('error handling', () => {
    it('returns template unchanged when brace is unclosed (EC-4)', () => {
      const result = renderMessage('Hello {name', { name: 'Alice' });
      expect(result).toBe('Hello {name');
    });

    it('returns template unchanged with multiple unclosed braces', () => {
      const result = renderMessage('Error {code at {location', {
        code: 'E001',
        location: 'line 5',
      });
      expect(result).toBe('Error {code at {location');
    });

    it('coerces non-string context values via String() (EC-5)', () => {
      const result = renderMessage('Count: {count}, Active: {active}', {
        count: 42,
        active: true,
      });
      expect(result).toBe('Count: 42, Active: true');
    });

    it('coerces null via String() (EC-5)', () => {
      const result = renderMessage('Value: {value}', { value: null });
      expect(result).toBe('Value: null');
    });

    it('handles objects that fail String() coercion (EC-6)', () => {
      const obj = Object.create(null);
      const result = renderMessage('Object: {obj}', { obj });
      // Should render as "[object Object]" or equivalent
      expect(result).toMatch(/Object: \[object/);
    });

    it('handles nested objects', () => {
      const result = renderMessage('Data: {data}', {
        data: { nested: 'value' },
      });
      expect(result).toBe('Data: [object Object]');
    });
  });

  describe('special characters', () => {
    it('handles placeholders at start of template', () => {
      const result = renderMessage('{greeting} world', { greeting: 'Hello' });
      expect(result).toBe('Hello world');
    });

    it('handles placeholders at end of template', () => {
      const result = renderMessage('Hello {name}', { name: 'Alice' });
      expect(result).toBe('Hello Alice');
    });

    it('handles consecutive placeholders', () => {
      const result = renderMessage('{a}{b}{c}', { a: '1', b: '2', c: '3' });
      expect(result).toBe('123');
    });

    it('preserves text between placeholders', () => {
      const result = renderMessage('{a} and {b} but not {c}', {
        a: 'this',
        b: 'that',
        c: 'other',
      });
      expect(result).toBe('this and that but not other');
    });

    it('handles empty placeholder names gracefully', () => {
      const result = renderMessage('Test {} value', {});
      expect(result).toBe('Test  value');
    });
  });

  describe('placeholder name extraction', () => {
    it('extracts placeholder names correctly', () => {
      const result = renderMessage(
        '{camelCase} {snake_case} {PascalCase} {number123}',
        {
          camelCase: 'a',
          snake_case: 'b',
          PascalCase: 'c',
          number123: 'd',
        }
      );
      expect(result).toBe('a b c d');
    });

    it('handles whitespace in placeholder names', () => {
      const result = renderMessage('Test {name with spaces}', {
        'name with spaces': 'value',
      });
      expect(result).toBe('Test value');
    });
  });

  describe('performance characteristics', () => {
    it('handles large templates efficiently (O(n))', () => {
      const largeTemplate = 'Start ' + '{placeholder} '.repeat(1000) + 'End';
      const context = { placeholder: 'x' };
      const start = Date.now();
      const result = renderMessage(largeTemplate, context);
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 100ms for 1000 placeholders)
      expect(duration).toBeLessThan(100);
      expect(result).toContain('Start');
      expect(result).toContain('End');
    });

    it('handles large context objects efficiently', () => {
      const context: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        context[`key${i}`] = `value${i}`;
      }
      const result = renderMessage('Test {key500}', context);
      expect(result).toBe('Test value500');
    });
  });
});
