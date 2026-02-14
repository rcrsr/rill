/**
 * Tests for JSON Schema to rill type mapping utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  mapJsonSchemaTypeToRillType,
  getDefaultValueForType,
  sanitizeParameterName,
  generateParametersFromSchema,
  parseResourceContent,
  type JsonSchema,
  type JsonSchemaProperty,
  type ResourceReadResult,
} from './parsing.js';

describe('mapJsonSchemaTypeToRillType', () => {
  describe('IC-7: Type Mapping', () => {
    it('maps string to string', () => {
      const property: JsonSchemaProperty = { type: 'string' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('string');
    });

    it('maps integer to number', () => {
      const property: JsonSchemaProperty = { type: 'integer' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('number');
    });

    it('maps number to number', () => {
      const property: JsonSchemaProperty = { type: 'number' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('number');
    });

    it('maps boolean to bool', () => {
      const property: JsonSchemaProperty = { type: 'boolean' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('bool');
    });

    it('maps object to dict', () => {
      const property: JsonSchemaProperty = { type: 'object' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('dict');
    });

    it('maps array to list', () => {
      const property: JsonSchemaProperty = { type: 'array' };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('list');
    });

    it('maps enum to string', () => {
      const property: JsonSchemaProperty = {
        type: 'string',
        enum: ['option1', 'option2'],
      };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('string');
    });

    it('maps oneOf to string', () => {
      const property: JsonSchemaProperty = {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('string');
    });

    it('maps anyOf to string', () => {
      const property: JsonSchemaProperty = {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('string');
    });

    it('maps missing type to dict', () => {
      const property: JsonSchemaProperty = {};
      expect(mapJsonSchemaTypeToRillType(property)).toBe('dict');
    });

    it('maps unknown type to dict', () => {
      const property: JsonSchemaProperty = { type: undefined };
      expect(mapJsonSchemaTypeToRillType(property)).toBe('dict');
    });
  });
});

describe('getDefaultValueForType', () => {
  describe('AC-8: Default Values', () => {
    it('returns empty string for string type', () => {
      expect(getDefaultValueForType('string')).toBe('');
    });

    it('returns 0 for number type', () => {
      expect(getDefaultValueForType('number')).toBe(0);
    });

    it('returns false for bool type', () => {
      expect(getDefaultValueForType('bool')).toBe(false);
    });

    it('returns empty array for list type', () => {
      expect(getDefaultValueForType('list')).toEqual([]);
    });

    it('returns empty object for dict type', () => {
      expect(getDefaultValueForType('dict')).toEqual({});
    });

    it('returns empty array for vector type', () => {
      expect(getDefaultValueForType('vector')).toEqual([]);
    });

    it('returns empty object for any type', () => {
      expect(getDefaultValueForType('any')).toEqual({});
    });
  });
});

describe('sanitizeParameterName', () => {
  it('replaces hyphens with underscores', () => {
    expect(sanitizeParameterName('file-path')).toBe('file_path');
  });

  it('replaces dots with underscores', () => {
    expect(sanitizeParameterName('config.option')).toBe('config_option');
  });

  it('converts camelCase to snake_case', () => {
    expect(sanitizeParameterName('fileName')).toBe('file_name');
  });

  it('converts PascalCase to snake_case', () => {
    expect(sanitizeParameterName('FileName')).toBe('file_name');
  });

  it('handles multiple transformations', () => {
    expect(sanitizeParameterName('get.fileName')).toBe('get_file_name');
  });

  it('handles consecutive uppercase letters', () => {
    expect(sanitizeParameterName('XMLParser')).toBe('xml_parser');
  });

  it('preserves already snake_case names', () => {
    expect(sanitizeParameterName('file_name')).toBe('file_name');
  });

  it('normalizes consecutive underscores', () => {
    expect(sanitizeParameterName('file__name')).toBe('file_name');
  });

  it('strips leading underscores', () => {
    expect(sanitizeParameterName('_fileName')).toBe('file_name');
  });

  it('strips trailing underscores', () => {
    expect(sanitizeParameterName('fileName_')).toBe('file_name');
  });
});

describe('generateParametersFromSchema', () => {
  describe('AC-8: Parameter Generation', () => {
    it('generates parameters from properties', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'integer', description: 'User age' },
        },
        required: ['name'],
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({
        name: 'name',
        type: 'string',
        description: 'User name',
      });
      expect(params[1]).toEqual({
        name: 'age',
        type: 'number',
        description: 'User age',
        defaultValue: 0,
      });
    });

    it('sets defaultValue for optional parameters', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          optional_string: { type: 'string' },
          optional_number: { type: 'number' },
          optional_bool: { type: 'boolean' },
          optional_list: { type: 'array' },
          optional_dict: { type: 'object' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(5);
      expect(params[0].defaultValue).toBe('');
      expect(params[1].defaultValue).toBe(0);
      expect(params[2].defaultValue).toBe(false);
      expect(params[3].defaultValue).toEqual([]);
      expect(params[4].defaultValue).toEqual({});
    });

    it('omits defaultValue for required parameters', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          required_param: { type: 'string' },
        },
        required: ['required_param'],
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({
        name: 'required_param',
        type: 'string',
        description: undefined,
      });
      expect('defaultValue' in params[0]).toBe(false);
    });

    it('preserves Object.entries iteration order', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          zulu: { type: 'string' },
          alpha: { type: 'string' },
          bravo: { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(3);
      expect(params[0].name).toBe('zulu');
      expect(params[1].name).toBe('alpha');
      expect(params[2].name).toBe('bravo');
    });

    it('sanitizes parameter names', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          'file-path': { type: 'string' },
          fileName: { type: 'string' },
          'config.option': { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(3);
      expect(params[0].name).toBe('file_path');
      expect(params[1].name).toBe('file_name');
      expect(params[2].name).toBe('config_option');
    });

    it('passes through description', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param: { type: 'string', description: 'Test parameter' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].description).toBe('Test parameter');
    });

    it('omits description when absent', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param: { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].description).toBeUndefined();
    });

    it('returns empty array for missing properties', () => {
      const schema: JsonSchema = {
        type: 'object',
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toEqual([]);
    });

    it('treats all parameters as optional when required is missing', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param1: { type: 'string' },
          param2: { type: 'number' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(2);
      expect(params[0].defaultValue).toBe('');
      expect(params[1].defaultValue).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty properties object', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {},
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toEqual([]);
    });

    it('handles empty required array', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param: { type: 'string' },
        },
        required: [],
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].defaultValue).toBe('');
    });

    it('handles mixed required and optional parameters', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          required1: { type: 'string' },
          optional1: { type: 'string' },
          required2: { type: 'number' },
          optional2: { type: 'number' },
        },
        required: ['required1', 'required2'],
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(4);
      expect('defaultValue' in params[0]).toBe(false); // required1
      expect(params[1].defaultValue).toBe(''); // optional1
      expect('defaultValue' in params[2]).toBe(false); // required2
      expect(params[3].defaultValue).toBe(0); // optional2
    });

    it('handles enum types', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].type).toBe('string');
    });

    it('handles oneOf types', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].type).toBe('string');
    });

    it('handles anyOf types', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].type).toBe('string');
    });

    it('handles missing type in property', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          value: { description: 'A value' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0].type).toBe('dict');
    });
  });
});

describe('parseResourceContent', () => {
  describe('IC-7: Resource Content Parsing', () => {
    it('parses text content as string', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://test.txt',
            text: 'plain text content',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('plain text content');
    });

    it('parses valid JSON text content as dict', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://config.json',
            text: '{"key": "value", "num": 42}',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({ key: 'value', num: 42 });
    });

    it('parses invalid JSON text as string', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://data.txt',
            text: '{not valid json}',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('{not valid json}');
    });

    it('parses blob content as dict with type/data/mime', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://image.png',
            blob: 'iVBORw0KGgoAAAANS',
            mimeType: 'image/png',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'iVBORw0KGgoAAAANS',
        mime: 'image/png',
      });
    });

    it('uses default mime type for blob without mimeType', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://binary.dat',
            blob: 'YmluYXJ5IGRhdGE=',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'YmluYXJ5IGRhdGE=',
        mime: 'application/octet-stream',
      });
    });

    it('concatenates multiple text blocks with newlines', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://part1.txt', text: 'first line' },
          { uri: 'file://part2.txt', text: 'second line' },
          { uri: 'file://part3.txt', text: 'third line' },
        ],
      };

      expect(parseResourceContent(result)).toBe(
        'first line\nsecond line\nthird line'
      );
    });
  });

  describe('BC-6: Zero-Byte Resource', () => {
    it('returns empty string for empty content array', () => {
      const result: ResourceReadResult = {
        contents: [],
      };

      expect(parseResourceContent(result)).toBe('');
    });

    it('returns empty string for empty text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://empty.txt',
            text: '',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('');
    });

    it('returns empty string for content with no text or blob', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://nothing.dat',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles JSON array in text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://array.json',
            text: '[1, 2, 3]',
          },
        ],
      };

      // JSON arrays are returned as-is (not wrapped in dict)
      expect(parseResourceContent(result)).toEqual([1, 2, 3]);
    });

    it('handles JSON primitive in text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://number.json',
            text: '42',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe(42);
    });

    it('handles whitespace-only text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://whitespace.txt',
            text: '   \n\t  ',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('   \n\t  ');
    });

    it('returns first content block for mixed text and blob', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://text.txt', text: 'text content' },
          {
            uri: 'file://image.png',
            blob: 'base64data',
            mimeType: 'image/png',
          },
        ],
      };

      // First block is text, so return that
      expect(parseResourceContent(result)).toBe('text content');
    });

    it('returns first blob for multiple blob blocks', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://image1.png', blob: 'data1', mimeType: 'image/png' },
          { uri: 'file://image2.png', blob: 'data2', mimeType: 'image/png' },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'data1',
        mime: 'image/png',
      });
    });

    it('handles empty text in multiple text blocks', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://part1.txt', text: 'first' },
          { uri: 'file://part2.txt', text: '' },
          { uri: 'file://part3.txt', text: 'third' },
        ],
      };

      expect(parseResourceContent(result)).toBe('first\n\nthird');
    });

    it('handles nested JSON objects', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://nested.json',
            text: '{"outer": {"inner": {"deep": "value"}}}',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        outer: { inner: { deep: 'value' } },
      });
    });
  });
});
