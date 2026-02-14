import { describe, it, expect } from 'vitest';
import { sanitizeNames } from './naming.js';

describe('sanitizeNames', () => {
  describe('IC-6: Name Sanitization', () => {
    it('replaces hyphens with underscores', () => {
      const result = sanitizeNames(['read-file']);
      expect(result.get('read-file')).toBe('read_file');
    });

    it('replaces dots with underscores', () => {
      const result = sanitizeNames(['get.weather']);
      expect(result.get('get.weather')).toBe('get_weather');
    });

    it('converts camelCase to snake_case', () => {
      const result = sanitizeNames(['listTools']);
      expect(result.get('listTools')).toBe('list_tools');
    });

    it('converts PascalCase to snake_case', () => {
      const result = sanitizeNames(['ReadFile']);
      expect(result.get('ReadFile')).toBe('read_file');
    });

    it('handles multiple transformations together', () => {
      const result = sanitizeNames(['get.weatherData']);
      expect(result.get('get.weatherData')).toBe('get_weather_data');
    });

    it('handles consecutive uppercase letters correctly', () => {
      const result = sanitizeNames(['XMLParser']);
      expect(result.get('XMLParser')).toBe('xml_parser');
    });

    it('handles numbers in names', () => {
      const result = sanitizeNames(['read-file2', 'getItem3']);
      expect(result.get('read-file2')).toBe('read_file2');
      expect(result.get('getItem3')).toBe('get_item3');
    });

    it('preserves already snake_case names', () => {
      const result = sanitizeNames(['read_file']);
      expect(result.get('read_file')).toBe('read_file');
    });
  });

  describe('AC-5: Name Collision Resolution', () => {
    it('appends _2 to second occurrence when names collide', () => {
      const result = sanitizeNames(['read-file', 'readFile']);
      expect(result.get('read-file')).toBe('read_file');
      expect(result.get('readFile')).toBe('read_file_2');
    });

    it('appends _3 to third occurrence when names collide', () => {
      const result = sanitizeNames(['read-file', 'readFile', 'ReadFile']);
      expect(result.get('read-file')).toBe('read_file');
      expect(result.get('readFile')).toBe('read_file_2');
      expect(result.get('ReadFile')).toBe('read_file_3');
    });

    it('handles multiple independent collisions', () => {
      const result = sanitizeNames([
        'read-file',
        'readFile',
        'get-weather',
        'getWeather',
      ]);
      expect(result.get('read-file')).toBe('read_file');
      expect(result.get('readFile')).toBe('read_file_2');
      expect(result.get('get-weather')).toBe('get_weather');
      expect(result.get('getWeather')).toBe('get_weather_2');
    });

    it('both colliding names remain callable', () => {
      const result = sanitizeNames(['read-file', 'readFile']);
      expect(result.has('read-file')).toBe(true);
      expect(result.has('readFile')).toBe(true);
      expect(result.get('read-file')).toBe('read_file');
      expect(result.get('readFile')).toBe('read_file_2');
    });
  });

  describe('BC-2: Maximum name collision', () => {
    it('handles 50 tools all sanitizing to same name', () => {
      // Create 50 tool names that ALL sanitize to 'read'
      const collisionTest: string[] = [
        'read', // → read
        'Read', // → read (collision → read_2)
        'READ', // → read (collision → read_3)
        ...Array.from({ length: 47 }, (_, i) => '-'.repeat(i + 1) + 'read'), // All sanitize to read (collisions → read_4 through read_50)
      ];

      const result = sanitizeNames(collisionTest);

      // All 50 should be present in result map
      expect(result.size).toBe(50);

      // Verify all original names remain callable
      for (const name of collisionTest) {
        expect(result.has(name)).toBe(true);
      }

      // First occurrence gets base name 'read'
      expect(result.get('read')).toBe('read');

      // Second occurrence gets 'read_2'
      expect(result.get('Read')).toBe('read_2');

      // Third occurrence gets 'read_3'
      expect(result.get('READ')).toBe('read_3');

      // Subsequent occurrences numbered read_4 through read_50
      expect(result.get('-read')).toBe('read_4');
      expect(result.get('--read')).toBe('read_5');
      expect(result.get('-'.repeat(47) + 'read')).toBe('read_50');

      // Verify all sanitized names are unique
      const values = Array.from(result.values());
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(50);

      // Verify numbering goes up to read_50
      expect(values).toContain('read_50');

      // Verify all values match pattern: "read" or "read_N"
      for (const value of values) {
        expect(value).toMatch(/^read(_\d+)?$/);
      }
    });

    it('handles mixed collisions with different names', () => {
      const names = [
        'read-file',
        'readFile',
        'write-data',
        'ReadFile',
        'writeData',
        'delete-item',
        'read.file',
      ];

      const result = sanitizeNames(names);

      // Count occurrences of each pattern
      const values = Array.from(result.values());
      const readFileCounts = values.filter((v) =>
        v.startsWith('read_file')
      ).length;
      const writeDataCounts = values.filter((v) =>
        v.startsWith('write_data')
      ).length;
      const deleteItemCounts = values.filter((v) =>
        v.startsWith('delete_item')
      ).length;

      expect(readFileCounts).toBe(4);
      expect(writeDataCounts).toBe(2);
      expect(deleteItemCounts).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles empty array', () => {
      const result = sanitizeNames([]);
      expect(result.size).toBe(0);
    });

    it('handles single name', () => {
      const result = sanitizeNames(['readFile']);
      expect(result.get('readFile')).toBe('read_file');
    });

    it('preserves order in collision numbering', () => {
      // Use case variations only (no mixed case within word)
      // Only 'read', 'Read', 'READ', 'READ' work - but that's duplicate
      // Use different approach: test with hyphen/dot patterns
      const result = sanitizeNames([
        'read-file',
        'readFile',
        'ReadFile',
        'read.file',
      ]);
      const values = Array.from(result.entries());
      expect(values[0][1]).toBe('read_file');
      expect(values[1][1]).toBe('read_file_2');
      expect(values[2][1]).toBe('read_file_3');
      expect(values[3][1]).toBe('read_file_4');
    });
  });
});
