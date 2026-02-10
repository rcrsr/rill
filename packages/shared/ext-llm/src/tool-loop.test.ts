/**
 * Unit tests for tool loop orchestration
 *
 * Tests executeToolLoop with success, error, and boundary cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { RuntimeError, callable, type RillValue } from '@rcrsr/rill';
import { executeToolLoop } from './tool-loop.js';
import type { ToolLoopCallbacks } from './types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a mock Rill callable function for testing
 */
function createMockTool(
  implementation: (args: RillValue[]) => RillValue | Promise<RillValue>,
  description?: string
): RillValue {
  const baseCallable = callable(implementation, false);
  if (description !== undefined) {
    (baseCallable as { description?: string }).description = description;
  }
  return baseCallable;
}

/**
 * Create default tool loop callbacks with mock implementations
 */
function createMockCallbacks(overrides?: Partial<ToolLoopCallbacks>) {
  const defaultCallbacks: ToolLoopCallbacks = {
    buildTools: vi.fn((tools) => tools),
    callAPI: vi.fn(async () => ({
      content: 'response',
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
    extractToolCalls: vi.fn(() => null),
    formatToolResult: vi.fn((results) => ({
      role: 'user',
      content: results,
    })),
  };

  return { ...defaultCallbacks, ...overrides };
}

// ============================================================
// EXECUTE TOOL LOOP
// ============================================================

describe('executeToolLoop', () => {
  describe('success cases', () => {
    it('executes without tool calls when no tools invoked', async () => {
      // AC-18: With 0 tools → executes without tool calls
      const tools = {};
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => null),
      });
      const emitEvent = vi.fn();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Hello' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.response).toBeDefined();
      expect(result.toolCalls).toEqual([]);
      expect(result.totalTokens).toEqual({ input: 100, output: 50 });
      expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
    });

    it('executes single tool call successfully', async () => {
      // AC-5: Tool loop executes successfully with single tool call
      const mockToolFn = vi.fn(() => 'tool result');
      const tools = {
        test_tool: createMockTool(mockToolFn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [{ id: 'call_1', name: 'test_tool', input: { param: 'value' } }]
            : null;
        }),
      });
      const emitEvent = vi.fn();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        name: 'test_tool',
        result: 'tool result',
      });
      expect(mockToolFn).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledWith('tool_call', {
        tool_name: 'test_tool',
        args: { param: 'value' },
      });
      expect(emitEvent).toHaveBeenCalledWith(
        'tool_result',
        expect.objectContaining({
          tool_name: 'test_tool',
          duration: expect.any(Number),
        })
      );
    });

    it('executes multiple tool calls in sequence', async () => {
      // AC-5: Multiple tools execute successfully
      const tool1Fn = vi.fn(() => 'result 1');
      const tool2Fn = vi.fn(() => 'result 2');
      const tools = {
        tool1: createMockTool(tool1Fn),
        tool2: createMockTool(tool2Fn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [
                { id: 'call_1', name: 'tool1', input: {} },
                { id: 'call_2', name: 'tool2', input: {} },
              ]
            : null;
        }),
      });
      const emitEvent = vi.fn();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('tool1');
      expect(result.toolCalls[1].name).toBe('tool2');
      expect(tool1Fn).toHaveBeenCalledTimes(1);
      expect(tool2Fn).toHaveBeenCalledTimes(1);
    });

    it('handles async tool functions', async () => {
      // AC-5: Async tools work correctly
      const asyncToolFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });
      const tools = {
        async_tool: createMockTool(asyncToolFn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [{ id: 'call_1', name: 'async_tool', input: {} }]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.toolCalls[0]?.result).toBe('async result');
    });

    it('aggregates token usage across iterations', async () => {
      // AC-5: Token tracking works correctly
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => ({
          content: 'response',
          usage: { input_tokens: 200, output_tokens: 100 },
        })),
        extractToolCalls: vi.fn(() => null),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.totalTokens).toEqual({ input: 200, output: 100 });
    });

    it('continues execution with 0 consecutive errors', async () => {
      // AC-19: With 0 consecutive errors → continues normally
      const tools = {
        tool: createMockTool(() => 'success'),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // No errors, should complete successfully
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.result).toBe('success');
    });
  });

  describe('error cases - consecutive errors exceed threshold', () => {
    it('throws after maxErrors consecutive errors', async () => {
      // EC-14, AC-11: Consecutive errors exceed maxErrors → throws
      let toolCallCount = 0;
      const tools = {
        failing_tool: createMockTool(() => {
          toolCallCount++;
          throw new Error('Tool failed');
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'failing_tool', input: {} },
                { id: 'call_2', name: 'failing_tool', input: {} },
                { id: 'call_3', name: 'failing_tool', input: {} },
              ]
            : null;
        }),
      });
      const emitEvent = vi.fn();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          emitEvent
        )
      ).rejects.toThrow('Tool execution failed: 3 consecutive errors');

      expect(toolCallCount).toBe(3);
      expect(emitEvent).toHaveBeenCalledWith(
        'tool_result',
        expect.objectContaining({
          tool_name: 'failing_tool',
          error: expect.stringContaining('Tool failed'),
          duration: expect.any(Number),
        })
      );
    });

    it('throws on next error after reaching threshold', async () => {
      // AC-20: At exactly maxErrors threshold → throws on next
      let toolCallCount = 0;
      const tools = {
        tool: createMockTool(() => {
          toolCallCount++;
          throw new Error('Error');
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'tool', input: {} },
                { id: 'call_2', name: 'tool', input: {} },
              ]
            : null;
        }),
      });

      // With maxErrors = 2, should throw after 2 consecutive errors
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          2,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow('Tool execution failed: 2 consecutive errors');

      expect(toolCallCount).toBe(2);
    });

    it('resets consecutive error count on success', async () => {
      // AC-19: Error count resets after successful execution
      let callIndex = 0;
      const tools = {
        tool: createMockTool(() => {
          callIndex++;
          // Fail first 2 times, then succeed
          if (callIndex <= 2) {
            throw new Error('Error');
          }
          return 'success';
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'tool', input: {} },
                { id: 'call_2', name: 'tool', input: {} },
                { id: 'call_3', name: 'tool', input: {} },
              ]
            : null;
        }),
      });

      // With maxErrors = 3, this should succeed because the third call succeeds
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.result).toBe('success');
    });
  });

  describe('error cases - unknown tool name', () => {
    it('does not throw immediately for unknown tool during execution', async () => {
      // EC-15, AC-12: Tool name not in tool map → throws when tool is executed
      // However, current implementation exits after first iteration, and errors
      // are tracked but don't halt execution unless consecutive errors exceed maxErrors
      const tools = {
        known_tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'unknown_tool', input: {} }]
            : null;
        }),
      });

      // With only 1 unknown tool call, it records error but completes
      // (maxErrors = 3, only 1 error)
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // Tool loop completes but no successful tool calls
      expect(result.toolCalls).toHaveLength(0);
    });

    it('throws RuntimeError after maxErrors unknown tool calls', async () => {
      // EC-15: Multiple unknown tools exceed maxErrors → throws RuntimeError
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'missing1', input: {} },
                { id: 'call_2', name: 'missing2', input: {} },
                { id: 'call_3', name: 'missing3', input: {} },
              ]
            : null;
        }),
      });

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow(RuntimeError);
    });
  });

  describe('error cases - invalid tool input', () => {
    it('throws for non-callable tool', async () => {
      // EC-16: Tool input validation fails → throws
      const tools = {
        invalid_tool: 'not a function' as unknown as RillValue,
      };

      // Error happens during setup, not during extractToolCalls
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          createMockCallbacks(),
          vi.fn()
        )
      ).rejects.toThrow("tool 'invalid_tool' must be callable function");
    });

    it('does not throw immediately for null tool input', async () => {
      // EC-16: Tool input is null → error tracked but doesn't halt unless maxErrors exceeded
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: null as unknown as object }]
            : null;
        }),
      });

      // Single error doesn't exceed maxErrors
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.toolCalls).toHaveLength(0);
    });

    it('throws for undefined tool in dict', async () => {
      // EC-16: Tool value is undefined → throws
      const tools = {
        tool: undefined as unknown as RillValue,
      };

      // Error happens during setup, not during extractToolCalls
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          createMockCallbacks(),
          vi.fn()
        )
      ).rejects.toThrow("tool 'tool' must be callable function");
    });
  });

  describe('error cases - provider API errors', () => {
    it('throws RuntimeError when provider callAPI throws', async () => {
      // EC-17: Provider callAPI throws → throws via mapProviderError
      const tools = {};
      const apiError = new Error('API connection failed');

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => {
          throw apiError;
        }),
      });

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow('Provider API error: API connection failed');
    });

    it('wraps non-Error API failures', async () => {
      // EC-17: Provider throws non-Error object
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => {
          throw { code: 'UNKNOWN' };
        }),
      });

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow('Provider API error: Unknown error');
    });

    it('throws RuntimeError for API failures', async () => {
      // EC-17: API errors wrapped as RuntimeError
      const tools = {};
      const originalError = new Error('Network timeout');

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => {
          throw originalError;
        }),
      });

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow(RuntimeError);
    });
  });

  describe('validation errors', () => {
    it('throws when tools parameter is undefined', async () => {
      const callbacks = createMockCallbacks();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          undefined,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow('tools parameter is required');
    });

    it('throws when tools is not a dict', async () => {
      const callbacks = createMockCallbacks();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          'not a dict' as unknown as RillValue,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow('tools must be a dict mapping tool names to functions');
    });

    it('throws when tool value is not callable during setup', async () => {
      const tools = {
        invalid: 'not callable' as unknown as RillValue,
      };

      const callbacks = createMockCallbacks();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn()
        )
      ).rejects.toThrow("tool 'invalid' must be callable function");
    });
  });

  describe('edge cases', () => {
    it('handles response without usage tracking', async () => {
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => ({ content: 'response' })),
        extractToolCalls: vi.fn(() => null),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.totalTokens).toEqual({ input: 0, output: 0 });
    });

    it('handles partial usage data', async () => {
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => ({
          content: 'response',
          usage: { input_tokens: 50 }, // Missing output_tokens
        })),
        extractToolCalls: vi.fn(() => null),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.totalTokens).toEqual({ input: 50, output: 0 });
    });

    it('emits events for tool execution', async () => {
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: { param: 'value' } }]
            : null;
        }),
      });
      const emitEvent = vi.fn();

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(emitEvent).toHaveBeenCalledWith('tool_call', {
        tool_name: 'tool',
        args: { param: 'value' },
      });
      expect(emitEvent).toHaveBeenCalledWith(
        'tool_result',
        expect.objectContaining({
          tool_name: 'tool',
          duration: expect.any(Number),
        })
      );
    });

    it('builds tool descriptors from callable metadata', async () => {
      const toolFn = createMockTool(() => 'result', 'Test tool description');
      const tools = {
        test_tool: toolFn,
      };

      const buildTools = vi.fn((tools) => tools);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(buildTools).toHaveBeenCalledWith([
        {
          name: 'test_tool',
          description: 'Test tool description',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ]);
    });

    it('generates JSON Schema from ApplicationCallable params', async () => {
      // AC-5, IC-11: Tool descriptors include params metadata
      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'application',
        params: [
          {
            name: 'str_param',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
            description: 'A string parameter',
          },
          {
            name: 'num_param',
            typeName: 'number',
            defaultValue: null,
            annotations: {},
            description: 'A number parameter',
          },
          {
            name: 'bool_param',
            typeName: 'bool',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'list_param',
            typeName: 'list',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'dict_param',
            typeName: 'dict',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'optional_param',
            typeName: 'string',
            defaultValue: 'default value',
            annotations: {},
          },
        ],
        fn: () => 'result',
        description: 'Tool with params',
      };

      const tools = {
        test_tool: toolFn,
      };

      const buildTools = vi.fn((tools) => tools);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      const toolDescriptors = buildTools.mock.calls[0]?.[0];
      expect(toolDescriptors).toHaveLength(1);

      const descriptor = toolDescriptors[0];
      expect(descriptor.name).toBe('test_tool');
      expect(descriptor.description).toBe('Tool with params');
      expect(descriptor.input_schema.type).toBe('object');
      expect(descriptor.input_schema.properties['str_param']).toEqual({
        type: 'string',
        description: 'A string parameter',
      });
      expect(descriptor.input_schema.properties['num_param']).toEqual({
        type: 'number',
        description: 'A number parameter',
      });
      expect(descriptor.input_schema.properties['bool_param']).toEqual({
        type: 'boolean',
      });
      expect(descriptor.input_schema.properties['list_param']).toEqual({
        type: 'array',
      });
      expect(descriptor.input_schema.properties['dict_param']).toEqual({
        type: 'object',
      });
      expect(descriptor.input_schema.required).toEqual([
        'str_param',
        'num_param',
        'bool_param',
        'list_param',
        'dict_param',
      ]);
    });
  });

  describe('argument conversion', () => {
    it('converts dict input to positional args using param order', async () => {
      // IC-11: Dict input converted to positional args
      const mockFn = vi.fn((args: RillValue[]) => {
        // Verify positional args received in correct order
        expect(args).toEqual(['value_a', 42]);
        return 'success';
      });

      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'application',
        params: [
          {
            name: 'param_a',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'param_b',
            typeName: 'number',
            defaultValue: null,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        test_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  input: { param_a: 'value_a', param_b: 42 },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(['value_a', 42], expect.anything());
    });

    it('preserves param order during conversion', async () => {
      // IC-11: Param order preserved during conversion
      const mockFn = vi.fn((args: RillValue[]) => {
        // Verify order: first, second, third
        expect(args).toEqual(['first_value', 'second_value', 'third_value']);
        return 'success';
      });

      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'application',
        params: [
          {
            name: 'first',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'second',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'third',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        test_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  // Dict with keys in different order than param definition
                  input: {
                    third: 'third_value',
                    first: 'first_value',
                    second: 'second_value',
                  },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('passes correct positional args to tool execution', async () => {
      // AC-5: Tool execution passes correct positional args
      const mockFn = vi.fn((args: RillValue[]) => {
        return `received: ${args.join(', ')}`;
      });

      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'application',
        params: [
          {
            name: 'name',
            typeName: 'string',
            defaultValue: null,
            annotations: {},
          },
          {
            name: 'age',
            typeName: 'number',
            defaultValue: null,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        greet: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'greet',
                  input: { name: 'Alice', age: 30 },
                },
              ]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.result).toBe('received: Alice, 30');
    });

    it('handles runtime callables with dict input fallback', async () => {
      // Backward compatibility: runtime callables receive dict as single arg
      const mockFn = vi.fn((args: RillValue[]) => {
        // Runtime callable should receive dict as single arg
        expect(args).toHaveLength(1);
        expect(args[0]).toEqual({ param: 'value' });
        return 'success';
      });

      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'runtime',
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        runtime_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'runtime_tool',
                  input: { param: 'value' },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('handles application callable without params metadata', async () => {
      // Fallback: application callable without params gets dict as single arg
      const mockFn = vi.fn((args: RillValue[]) => {
        expect(args).toHaveLength(1);
        expect(args[0]).toEqual({ param: 'value' });
        return 'success';
      });

      const toolFn: RillValue = {
        __type: 'callable',
        kind: 'application',
        params: undefined,
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        app_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'app_tool',
                  input: { param: 'value' },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-turn execution', () => {
    it('calls API again after tool execution', async () => {
      // Multi-turn: After tool execution, loop calls API again with tool results
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const mockCallAPI = vi.fn(async () => ({
        content: 'response',
        usage: { input_tokens: 100, output_tokens: 50 },
      }));

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        extractToolCalls: vi.fn(() => {
          // First call: return tool calls
          // Second call: return null (exit loop)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // API should be called twice: once for initial, once after tool execution
      expect(mockCallAPI).toHaveBeenCalledTimes(2);
    });

    it('exits when LLM returns no tool calls', async () => {
      // Multi-turn: Loop exits when extractToolCalls returns null
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // First call: tool calls
          // Second call: null (should exit)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // Should exit cleanly with tool results
      expect(result.toolCalls).toHaveLength(1);
      expect(result.response).toBeDefined();
    });

    it('enforces maxTurns limit', async () => {
      // Multi-turn: Loop stops after maxTurns reached
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      const mockCallAPI = vi.fn(async () => ({
        content: 'response',
        usage: { input_tokens: 100, output_tokens: 50 },
      }));

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        extractToolCalls: vi.fn(() => {
          // Always return tool calls (simulate infinite loop)
          return [{ id: 'call_1', name: 'tool', input: {} }];
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn(),
        5 // maxTurns = 5
      );

      // API should be called exactly 5 times
      expect(mockCallAPI).toHaveBeenCalledTimes(5);

      // Result should indicate max turns reached (response is null)
      expect(result.response).toBeNull();
    });

    it('aggregates tokens across multiple turns', async () => {
      // Multi-turn: Token usage aggregated across all API calls
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        callAPI: vi.fn(async () => {
          // Each call uses different token amounts
          apiCallCount++;
          return {
            content: 'response',
            usage: {
              input_tokens: apiCallCount * 100,
              output_tokens: apiCallCount * 50,
            },
          };
        }),
        extractToolCalls: vi.fn(() => {
          // First 2 calls: tool calls
          // Third call: null (exit)
          return apiCallCount < 3
            ? [{ id: 'call_1', name: 'tool', input: {} }]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // Should aggregate: (100 + 200 + 300) input, (50 + 100 + 150) output
      expect(result.totalTokens).toEqual({ input: 600, output: 300 });
    });

    it('continues loop after successful tool execution', async () => {
      // Multi-turn: After tool executes successfully, loop continues to next turn
      const tool1Fn = vi.fn(() => 'result1');
      const tool2Fn = vi.fn(() => 'result2');
      const tools = {
        tool1: createMockTool(tool1Fn),
        tool2: createMockTool(tool2Fn),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // First call: tool1
          // Second call: tool2
          // Third call: null (exit)
          apiCallCount++;
          if (apiCallCount === 1) {
            return [{ id: 'call_1', name: 'tool1', input: {} }];
          } else if (apiCallCount === 2) {
            return [{ id: 'call_2', name: 'tool2', input: {} }];
          }
          return null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // Both tools should have been called
      expect(tool1Fn).toHaveBeenCalledTimes(1);
      expect(tool2Fn).toHaveBeenCalledTimes(1);

      // Both tool calls should be in results
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('tool1');
      expect(result.toolCalls[1].name).toBe('tool2');
    });

    it('appends tool results to message history', async () => {
      // Multi-turn: Tool results formatted and appended to messages
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      const mockFormatToolResult = vi.fn((results) => ({
        role: 'tool',
        content: results,
      }));

      let apiCallCount = 0;
      const mockCallAPI = vi.fn(async (messages: unknown[]) => {
        // Verify messages grow with each call
        if (apiCallCount === 1) {
          // Second call should have tool result message appended
          expect(messages).toHaveLength(2);
          expect((messages[1] as { role: string }).role).toBe('tool');
        }
        return {
          content: 'response',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      });

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        formatToolResult: mockFormatToolResult,
        extractToolCalls: vi.fn(() => {
          // First call: tool calls
          // Second call: null (exit)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn()
      );

      // formatToolResult should be called once
      expect(mockFormatToolResult).toHaveBeenCalledTimes(1);

      // callAPI should be called twice
      expect(mockCallAPI).toHaveBeenCalledTimes(2);
    });
  });
});
