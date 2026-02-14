/**
 * Tool function generation tests.
 *
 * Tests tool function generation, result parsing, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { generateToolFunctions } from '../../src/tools.js';
import type {
  McpTool,
  McpToolResult,
  McpToolContent,
} from '../../src/tools.js';

// ============================================================
// MOCK CLIENT
// ============================================================

interface MockClient {
  callTool: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
  return {
    callTool: vi.fn(),
  };
}

// ============================================================
// TEST TOOLS
// ============================================================

const TOOL_WITH_PARAMS: McpTool = {
  name: 'calculate-bmi',
  description: 'Calculate Body Mass Index',
  inputSchema: {
    type: 'object',
    properties: {
      weightKg: { type: 'number', description: 'Weight in kilograms' },
      heightM: { type: 'number', description: 'Height in meters' },
    },
    required: ['weightKg', 'heightM'],
  },
};

const TOOL_NO_PARAMS: McpTool = {
  name: 'get-status',
  description: 'Get server status',
  inputSchema: {
    type: 'object',
  },
};

const TOOL_OPTIONAL_PARAMS: McpTool = {
  name: 'search',
  description: 'Search for items',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'integer', description: 'Result limit' },
    },
    required: ['query'],
  },
};

// ============================================================
// RESULT HELPERS
// ============================================================

function textResult(text: string): McpToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

function jsonResult(data: unknown): McpToolResult {
  return textResult(JSON.stringify(data));
}

function imageResult(data: string, mimeType = 'image/png'): McpToolResult {
  return {
    content: [{ type: 'image', data, mimeType }],
  };
}

function multiTextResult(texts: string[]): McpToolResult {
  return {
    content: texts.map((text) => ({ type: 'text', text })),
  };
}

function mixedResult(blocks: McpToolContent[]): McpToolResult {
  return { content: blocks };
}

function errorResult(errorText: string): McpToolResult {
  return {
    content: [{ type: 'text', text: errorText }],
    isError: true,
  };
}

// ============================================================
// IR-2: TOOL FUNCTION GENERATION
// ============================================================

describe('generateToolFunctions', () => {
  describe('IR-2: HostFunctionDefinition generation', () => {
    it('generates function with params from schema', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([TOOL_WITH_PARAMS], mockClient);

      expect(functions).toHaveProperty('calculate_bmi');
      const fn = functions.calculate_bmi!;

      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]).toMatchObject({
        name: 'weight_kg',
        type: 'number',
        description: 'Weight in kilograms',
      });
      expect(fn.params[1]).toMatchObject({
        name: 'height_m',
        type: 'number',
        description: 'Height in meters',
      });
      expect(fn.description).toBe('Calculate Body Mass Index');
      expect(fn.returnType).toBe('any');
      expect(typeof fn.fn).toBe('function');
    });

    it('generates function with no params', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([TOOL_NO_PARAMS], mockClient);

      expect(functions).toHaveProperty('get_status');
      const fn = functions.get_status!;

      expect(fn.params).toHaveLength(0);
      expect(fn.returnType).toBe('any');
    });

    it('generates function with optional params', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions(
        [TOOL_OPTIONAL_PARAMS],
        mockClient
      );

      const fn = functions.search!;
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]).not.toHaveProperty('defaultValue');
      expect(fn.params[1]).toHaveProperty('defaultValue', 0);
    });

    it('applies name sanitization', () => {
      const tools: McpTool[] = [
        { name: 'get-user', inputSchema: { type: 'object' } },
        { name: 'getUserProfile', inputSchema: { type: 'object' } },
        { name: 'get.user.data', inputSchema: { type: 'object' } },
      ];

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions(tools, mockClient);

      expect(functions).toHaveProperty('get_user');
      expect(functions).toHaveProperty('get_user_profile');
      expect(functions).toHaveProperty('get_user_data');
    });
  });

  // ============================================================
  // AC-8: RESULT TYPE CONVERSION
  // ============================================================

  describe('AC-8: Result type conversion', () => {
    let mockClient: MockClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('converts JSON text to dict', async () => {
      const mockData = { status: 'ok', count: 42 };
      mockClient.callTool.mockResolvedValue(jsonResult(mockData));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toEqual(mockData);
    });

    it('returns plain text as string', async () => {
      mockClient.callTool.mockResolvedValue(textResult('success'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toBe('success');
    });

    it('converts image to dict with type, data, mime', async () => {
      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      mockClient.callTool.mockResolvedValue(
        imageResult(base64Data, 'image/png')
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toEqual({
        type: 'image',
        data: base64Data,
        mime: 'image/png',
      });
    });

    it('concatenates multiple text blocks', async () => {
      mockClient.callTool.mockResolvedValue(
        multiTextResult(['line 1', 'line 2', 'line 3'])
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toBe('line 1\nline 2\nline 3');
    });

    it('returns structured dict for mixed content blocks', async () => {
      const blocks: McpToolContent[] = [
        { type: 'text', text: 'Description' },
        { type: 'image', data: 'abc123', mimeType: 'image/jpeg' },
      ];
      mockClient.callTool.mockResolvedValue(mixedResult(blocks));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toEqual({
        content: [
          { type: 'text', text: 'Description' },
          { type: 'image', data: 'abc123', mime: 'image/jpeg' },
        ],
      });
    });

    it('handles empty content array', async () => {
      mockClient.callTool.mockResolvedValue({ content: [] });

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toBe('');
    });

    it('handles JSON array result', async () => {
      const arrayData = [1, 2, 3];
      mockClient.callTool.mockResolvedValue(jsonResult(arrayData));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toEqual(arrayData);
    });

    it('handles JSON primitive result', async () => {
      mockClient.callTool.mockResolvedValue(jsonResult(42));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );
      const result = await functions.get_status!.fn([], {} as any);

      expect(result).toBe(42);
    });
  });

  // ============================================================
  // EC-6: TOOL ERROR
  // ============================================================

  describe('EC-6: Tool error handling', () => {
    it('throws RuntimeError for tool error response', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(errorResult('invalid input'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp tool "get-status": invalid input'
      );
    });

    it('includes tool name in error message', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(errorResult('validation failed'));

      const functions = generateToolFunctions(
        [TOOL_WITH_PARAMS],
        mockClient as unknown as Client
      );

      await expect(
        functions.calculate_bmi!.fn([70, 1.75], {} as any)
      ).rejects.toThrow('mcp tool "calculate-bmi"');
    });
  });

  // ============================================================
  // EC-7: PROTOCOL ERROR
  // ============================================================

  describe('EC-7: Protocol error handling', () => {
    it('throws RuntimeError for malformed response', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(
        new Error('protocol error: invalid json')
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: protocol error'
      );
    });

    it('handles parse errors', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('parse failed'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: protocol error'
      );
    });
  });

  // ============================================================
  // EC-8: TIMEOUT
  // ============================================================

  describe('EC-8: Timeout handling', () => {
    it('throws RuntimeError after timeout exceeded', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client,
        50 // 50ms timeout
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp tool "get-status": timeout after 50ms'
      );
    });

    it('includes timeout duration in error', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      );

      const functions = generateToolFunctions(
        [TOOL_WITH_PARAMS],
        mockClient as unknown as Client,
        100
      );

      await expect(
        functions.calculate_bmi!.fn([70, 1.75], {} as any)
      ).rejects.toThrow('timeout after 100ms');
    });

    it('succeeds if call completes before timeout', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(textResult('ok')), 10)
          )
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client,
        100
      );

      const result = await functions.get_status!.fn([], {} as any);
      expect(result).toBe('ok');
    });
  });

  // ============================================================
  // EC-9: CONNECTION LOST
  // ============================================================

  describe('EC-9: Connection lost handling', () => {
    it('throws RuntimeError for connection closed', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('connection closed'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: connection lost'
      );
    });

    it('handles disconnected error', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(
        new Error('disconnected from server')
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: connection lost'
      );
    });
  });

  // ============================================================
  // EC-10: AUTH FAILED
  // ============================================================

  describe('EC-10: Authentication failure handling', () => {
    it('throws RuntimeError for unauthorized', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('unauthorized'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: authentication failed'
      );
    });

    it('handles authentication failed error', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('authentication failed'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'token may be expired'
      );
    });

    it('handles token error', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('invalid token'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expect(functions.get_status!.fn([], {} as any)).rejects.toThrow(
        'mcp: authentication failed'
      );
    });
  });

  // ============================================================
  // ARGUMENT MAPPING
  // ============================================================

  describe('Argument mapping', () => {
    it('maps positional args to tool parameters', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(textResult('ok'));

      const functions = generateToolFunctions(
        [TOOL_WITH_PARAMS],
        mockClient as unknown as Client
      );

      await functions.calculate_bmi!.fn([70, 1.75], {} as any);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'calculate-bmi',
        arguments: {
          weight_kg: 70,
          height_m: 1.75,
        },
      });
    });

    it('applies default values for missing optional args', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(textResult('ok'));

      const functions = generateToolFunctions(
        [TOOL_OPTIONAL_PARAMS],
        mockClient as unknown as Client
      );

      await functions.search!.fn(['test'], {} as any);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          query: 'test',
          limit: 0, // default value from type
        },
      });
    });
  });

  // ============================================================
  // BOUNDARY CONDITIONS
  // ============================================================

  describe('BC-3: Large parameter schemas', () => {
    it('handles tool with 100 parameters', () => {
      // Create a tool with 100 input parameters
      const largeSchema: McpTool = {
        name: 'large-tool',
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            Array.from({ length: 100 }, (_, i) => [
              `param${i}`,
              { type: 'string', description: `Parameter ${i}` },
            ])
          ),
          required: Array.from({ length: 50 }, (_, i) => `param${i}`), // First 50 required
        },
      };

      const mockClient = createMockClient();
      const functions = generateToolFunctions(
        [largeSchema],
        mockClient as unknown as Client
      );

      const fn = functions.large_tool;
      expect(fn).toBeDefined();
      expect(fn!.params).toHaveLength(100);

      // Verify first 50 params are required (no defaultValue)
      for (let i = 0; i < 50; i++) {
        const param = fn!.params[i]!;
        expect(param.name).toBe(`param${i}`);
        expect(param.type).toBe('string');
        expect(param.defaultValue).toBeUndefined();
      }

      // Verify last 50 params are optional (have defaultValue)
      for (let i = 50; i < 100; i++) {
        const param = fn!.params[i]!;
        expect(param.name).toBe(`param${i}`);
        expect(param.type).toBe('string');
        expect(param.defaultValue).toBe(''); // default for string
      }
    });
  });

  describe('BC-4: Concurrent tool calls', () => {
    it('handles 10 simultaneous tool invocations', async () => {
      const mockClient = createMockClient();
      let callCount = 0;

      // Each call returns unique result after random delay
      mockClient.callTool.mockImplementation(
        (args: any) =>
          new Promise((resolve) => {
            const id = callCount++;
            setTimeout(
              () => resolve(textResult(`result-${id}`)),
              Math.random() * 50
            );
          })
      );

      // Create 10 different tools
      const tools: McpTool[] = Array.from({ length: 10 }, (_, i) => ({
        name: `tool${i}`,
        inputSchema: { type: 'object' },
      }));

      const functions = generateToolFunctions(
        tools,
        mockClient as unknown as Client
      );

      // Call all 10 tools simultaneously
      const calls = Object.values(functions).map((fn) => fn!.fn([], {} as any));
      const results = await Promise.all(calls);

      // Verify all completed independently
      expect(results).toHaveLength(10);
      expect(mockClient.callTool).toHaveBeenCalledTimes(10);

      // Each result should be unique (verifies no shared state)
      const resultSet = new Set(results);
      expect(resultSet.size).toBe(10);
    });
  });
});
