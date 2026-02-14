/**
 * Unit tests for AC-8: Tool result type conversion.
 *
 * Tests parseToolResult logic directly without SDK dependencies.
 * Validates conversion rules for text, JSON, images, and multi-block content.
 */

import { describe, it, expect } from 'vitest';
import type { McpToolResult, McpToolContent } from '../../src/tools.js';

// Test helper to access internal parseToolResult via tool function generation
import { generateToolFunctions, type McpTool } from '../../src/tools.js';

/**
 * Helper to extract parseToolResult behavior by generating a tool function
 * and calling it with a mocked client that returns the test result.
 */
async function testParseToolResult(result: McpToolResult): Promise<any> {
  const mockTool: McpTool = {
    name: 'test_tool',
    description: 'Test tool',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  // Mock client that returns our test result
  const mockClient = {
    callTool: async () => result,
  } as any;

  const mockContext = {
    variables: new Map(),
    pipeValue: undefined,
  };

  const functions = generateToolFunctions(
    [mockTool],
    mockClient,
    30000,
    { connectEmitted: true } // Skip lifecycle event
  );

  // Call the generated function with empty args
  return await functions.test_tool!.fn([], mockContext);
}

describe('AC-8: Type conversion', () => {
  describe('Single text block', () => {
    it('parses valid JSON object to dict', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '{"status": "ok", "count": 42}',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBe(null);
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed.status).toBe('ok');
      expect(parsed.count).toBe(42);
    });

    it('parses valid JSON array as-is', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '[1, 2, 3]',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual([1, 2, 3]);
    });

    it('returns plain text string when not JSON', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: 'Plain text response',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('string');
      expect(parsed).toBe('Plain text response');
    });

    it('returns plain text for malformed JSON', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '{invalid json',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('string');
      expect(parsed).toBe('{invalid json');
    });

    it('handles empty text block', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('');
    });

    it('handles missing text property', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
          } as McpToolContent,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('');
    });
  });

  describe('Single image block', () => {
    it('converts image to structured dict with type/data/mime', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'image',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mimeType: 'image/png',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBe(null);
      expect(parsed.type).toBe('image');
      expect(typeof parsed.data).toBe('string');
      expect(parsed.data.length).toBeGreaterThan(0);
      expect(parsed.mime).toBe('image/png');
    });

    it('defaults to image/png when mimeType missing', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'image',
            data: 'base64data',
          } as McpToolContent,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed.type).toBe('image');
      expect(parsed.mime).toBe('image/png');
    });

    it('handles missing data property', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
          } as McpToolContent,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed.type).toBe('image');
      expect(parsed.data).toBe('');
      expect(parsed.mime).toBe('image/jpeg');
    });
  });

  describe('Single resource block', () => {
    it('returns text content for resource blocks', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'resource',
            text: 'Resource content',
          } as McpToolContent,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('string');
      expect(parsed).toBe('Resource content');
    });

    it('handles missing text in resource block', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'resource',
          } as McpToolContent,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('');
    });
  });

  describe('Multiple text blocks', () => {
    it('concatenates text blocks with newlines', async () => {
      const result: McpToolResult = {
        content: [
          { type: 'text', text: 'First line' },
          { type: 'text', text: 'Second line' },
          { type: 'text', text: 'Third line' },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('string');
      expect(parsed).toBe('First line\nSecond line\nThird line');
    });

    it('handles missing text properties in multi-block', async () => {
      const result: McpToolResult = {
        content: [
          { type: 'text', text: 'First' },
          { type: 'text' } as McpToolContent,
          { type: 'text', text: 'Third' },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('First\n\nThird');
    });
  });

  describe('Mixed content blocks', () => {
    it('returns structured dict for mixed text and image', async () => {
      const result: McpToolResult = {
        content: [
          { type: 'text', text: 'Description' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBe(null);
      expect(Array.isArray(parsed.content)).toBe(true);
      expect(parsed.content).toHaveLength(2);

      const [textBlock, imageBlock] = parsed.content;
      expect(textBlock.type).toBe('text');
      expect(textBlock.text).toBe('Description');
      expect(imageBlock.type).toBe('image');
      expect(imageBlock.data).toBe('base64');
      expect(imageBlock.mime).toBe('image/png');
    });

    it('returns structured dict for multiple images', async () => {
      const result: McpToolResult = {
        content: [
          { type: 'image', data: 'image1', mimeType: 'image/png' },
          { type: 'image', data: 'image2', mimeType: 'image/jpeg' },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(Array.isArray(parsed.content)).toBe(true);
      expect(parsed.content).toHaveLength(2);

      const [img1, img2] = parsed.content;
      expect(img1.type).toBe('image');
      expect(img1.data).toBe('image1');
      expect(img1.mime).toBe('image/png');
      expect(img2.type).toBe('image');
      expect(img2.data).toBe('image2');
      expect(img2.mime).toBe('image/jpeg');
    });

    it('handles unknown content types in mixed content', async () => {
      const result: McpToolResult = {
        content: [
          { type: 'text', text: 'Known' },
          { type: 'unknown', text: 'Mystery content' } as any,
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(Array.isArray(parsed.content)).toBe(true);
      expect(parsed.content).toHaveLength(2);

      const [textBlock, unknownBlock] = parsed.content;
      expect(textBlock.type).toBe('text');
      expect(unknownBlock.type).toBe('unknown');
      expect(unknownBlock.text).toBe('Mystery content');
    });
  });

  describe('Empty content', () => {
    it('returns empty string for empty content array', async () => {
      const result: McpToolResult = {
        content: [],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('');
    });
  });

  describe('Error results', () => {
    it('throws for isError=true results', async () => {
      const result: McpToolResult = {
        content: [{ type: 'text', text: 'Error message' }],
        isError: true,
      };

      await expect(testParseToolResult(result)).rejects.toThrow();
    });

    it('throws with error text from content', async () => {
      const result: McpToolResult = {
        content: [{ type: 'text', text: 'Custom error message' }],
        isError: true,
      };

      await expect(testParseToolResult(result)).rejects.toThrow(
        'Custom error message'
      );
    });

    it('handles isError with empty content', async () => {
      const result: McpToolResult = {
        content: [],
        isError: true,
      };

      await expect(testParseToolResult(result)).rejects.toThrow(
        'unknown error'
      );
    });
  });

  describe('Complex JSON structures', () => {
    it('parses nested JSON objects', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '{"user":{"id":123,"name":"Alice"},"timestamp":"2024-01-01"}',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(typeof parsed).toBe('object');
      expect(parsed.user).toBeDefined();
      expect(parsed.user.id).toBe(123);
      expect(parsed.user.name).toBe('Alice');
      expect(parsed.timestamp).toBe('2024-01-01');
    });

    it('handles JSON with null values', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '{"value":null,"active":false}',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed.value).toBe(null);
      expect(parsed.active).toBe(false);
    });

    it('handles JSON primitives (number)', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '42',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe(42);
    });

    it('handles JSON primitives (boolean)', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: 'true',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe(true);
    });

    it('handles JSON primitives (string)', async () => {
      const result: McpToolResult = {
        content: [
          {
            type: 'text',
            text: '"quoted string"',
          },
        ],
      };

      const parsed = await testParseToolResult(result);

      expect(parsed).toBe('quoted string');
    });
  });
});
