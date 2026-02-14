/**
 * Integration tests for Anthropic extension event emission.
 * Tests that all event types (§4.10) are emitted correctly with proper fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicExtension } from '../src/factory.js';
import {
  createRuntimeContext,
  callable,
  type ExtensionEvent,
} from '@rcrsr/rill';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Helper to create event collector for onLogEvent callback.
 * Returns array that gets populated with emitted events.
 */
function createEventCollector(): ExtensionEvent[] {
  return [];
}

// Mock the Anthropic SDK at module level
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    constructor(
      status: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _error: any,
      message: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _headers: any
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

describe('Anthropic Extension Integration Tests - Event Emission', () => {
  const TEST_API_KEY = 'test-api-key-12345';
  const TEST_MODEL = 'claude-sonnet-4-5-20250929';

  // Reset mocks before each test
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('IC-12: anthropic:message event with duration, model, usage', () => {
    it('emits event after successful message() call', async () => {
      // Mock Anthropic SDK response
      const mockResponse = {
        id: 'msg_123',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Test response' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 8,
        },
      };

      mockCreate.mockResolvedValue(mockResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      await ext.message.fn(['Hello Claude', {}], ctx);

      // Verify event was emitted
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.event).toBe('anthropic:message');
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.model).toBe(TEST_MODEL);
      expect(event.usage).toEqual({ input: 10, output: 8 });
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });
  });

  describe('IC-12: anthropic:messages event with duration, model, usage', () => {
    it('emits event after successful messages() call', async () => {
      const mockResponse = {
        id: 'msg_456',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Multi-turn response' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: {
          input_tokens: 20,
          output_tokens: 15,
        },
      };

      mockCreate.mockResolvedValue(mockResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      await ext.messages.fn([messages, {}], ctx);

      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.event).toBe('anthropic:messages');
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.model).toBe(TEST_MODEL);
      expect(event.usage).toEqual({ input: 20, output: 15 });
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });
  });

  describe('IC-12: anthropic:embed event (API not available)', () => {
    it('emits error event when embed() raises unsupported error', async () => {
      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
        embed_model: 'text-embedding-3', // Required to pass validation
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // embed() throws "embeddings API not available"
      await expect(ext.embed.fn(['test text'], ctx)).rejects.toThrow(
        'embeddings API not available'
      );

      // Should emit error event
      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.error).toContain('embeddings API not available');
      expect(typeof event.duration).toBe('number');
      expect(typeof event.timestamp).toBe('string');
    });
  });

  describe('IC-12: anthropic:embed_batch event (API not available)', () => {
    it('emits error event when embed_batch() raises unsupported error', async () => {
      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
        embed_model: 'text-embedding-3',
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      await expect(
        ext.embed_batch.fn([['text1', 'text2']], ctx)
      ).rejects.toThrow('embeddings API not available');

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.error).toContain('embeddings API not available');
    });
  });

  describe('IC-12: anthropic:tool_call event with tool_name, args', () => {
    it('emits tool_call event for each tool invocation', async () => {
      // Mock API responses for tool_loop
      const toolUseResponse = {
        id: 'msg_tool1',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'San Francisco', unit: 'celsius' },
          },
        ],
        model: TEST_MODEL,
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const finalResponse = {
        id: 'msg_final',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: "It's 18°C in San Francisco" },
        ],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 20 },
      };

      mockCreate
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Define tool
      const weatherTool = {
        name: 'get_weather',
        description: 'Get weather for location',
        params: {
          location: { type: 'string', description: 'City name' },
          unit: { type: 'string', description: 'Temperature unit' },
        },
        fn: callable(vi.fn().mockReturnValue('18°C, partly cloudy')),
      };

      await ext.tool_loop.fn(
        ['What is the weather in San Francisco?', { tools: [weatherTool] }],
        ctx
      );

      // Find tool_call event
      const toolCallEvents = events.filter(
        (e) => e.event === 'anthropic:tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const event = toolCallEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.tool_name).toBe('get_weather');
      expect(event.args).toEqual({
        location: 'San Francisco',
        unit: 'celsius',
      });
      expect(typeof event.timestamp).toBe('string');

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('IC-12: anthropic:tool_result event with tool_name, duration', () => {
    it('emits tool_result event after tool execution completes', async () => {
      const toolUseResponse = {
        id: 'msg_tool2',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_456',
            name: 'calculate',
            input: { a: 5, b: 3 },
          },
        ],
        model: TEST_MODEL,
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 30 },
      };

      const finalResponse = {
        id: 'msg_final2',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'The answer is 8' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 60, output_tokens: 10 },
      };

      mockCreate
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const calculateTool = {
        name: 'calculate',
        description: 'Add two numbers',
        params: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
        fn: callable(vi.fn().mockReturnValue(8)),
      };

      await ext.tool_loop.fn(
        ['Calculate 5 + 3', { tools: [calculateTool] }],
        ctx
      );

      // Find tool_result event
      const toolResultEvents = events.filter(
        (e) => e.event === 'anthropic:tool_result'
      );
      expect(toolResultEvents).toHaveLength(1);

      const event = toolResultEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.tool_name).toBe('calculate');
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });

    it('includes error field in tool_result event when tool execution fails', async () => {
      const toolUseResponse = {
        id: 'msg_tool_error',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_789',
            name: 'failing_tool',
            input: {},
          },
        ],
        model: TEST_MODEL,
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 30, output_tokens: 20 },
      };

      const finalResponse = {
        id: 'msg_final3',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Tool failed, sorry' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 15 },
      };

      mockCreate
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const failingTool = {
        name: 'failing_tool',
        description: 'Always fails',
        params: {},
        fn: callable(() => {
          throw new Error('Tool execution error');
        }),
      };

      await ext.tool_loop.fn(
        ['Test failing tool', { tools: [failingTool] }],
        ctx
      );

      // Find tool_result event with error
      const toolResultEvents = events.filter(
        (e) => e.event === 'anthropic:tool_result'
      );
      expect(toolResultEvents).toHaveLength(1);

      const event = toolResultEvents[0]!;
      expect(event.tool_name).toBe('failing_tool');
      expect(event.error).toBe('Tool execution error');
      expect(typeof event.duration).toBe('number');
    });
  });

  describe('IC-12: anthropic:tool_loop event with turns, total_duration, usage', () => {
    it('emits tool_loop event after loop completes successfully', async () => {
      // No tool use - immediate response
      const noToolResponse = {
        id: 'msg_no_tool',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Direct answer' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 10 },
      };

      mockCreate.mockResolvedValue(noToolResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      await ext.tool_loop.fn(['Simple question', { tools: [] }], ctx);

      // Find tool_loop event
      const toolLoopEvents = events.filter(
        (e) => e.event === 'anthropic:tool_loop'
      );
      expect(toolLoopEvents).toHaveLength(1);

      const event = toolLoopEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.turns).toBe(1);
      expect(event.usage).toEqual({ input: 25, output: 10 });
      expect(typeof event.total_duration).toBe('number');
      expect(event.total_duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });

    it('includes accumulated usage from multiple turns', async () => {
      const toolUseResponse = {
        id: 'msg_turn1',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_multi1',
            name: 'step1',
            input: {},
          },
        ],
        model: TEST_MODEL,
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const turn2Response = {
        id: 'msg_turn2',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_multi2',
            name: 'step2',
            input: {},
          },
        ],
        model: TEST_MODEL,
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 60 },
      };

      const finalResponse = {
        id: 'msg_final_multi',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Complete' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 130, output_tokens: 20 },
      };

      mockCreate
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(turn2Response)
        .mockResolvedValueOnce(finalResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const step1Tool = {
        name: 'step1',
        description: 'First step',
        params: {},
        fn: callable(vi.fn().mockReturnValue('step1 done')),
      };

      const step2Tool = {
        name: 'step2',
        description: 'Second step',
        params: {},
        fn: callable(vi.fn().mockReturnValue('step2 done')),
      };

      await ext.tool_loop.fn(
        ['Multi-step task', { tools: [step1Tool, step2Tool] }],
        ctx
      );

      // Find tool_loop event
      const toolLoopEvents = events.filter(
        (e) => e.event === 'anthropic:tool_loop'
      );
      expect(toolLoopEvents).toHaveLength(1);

      const event = toolLoopEvents[0]!;
      expect(event.turns).toBe(3);
      // Accumulated usage: 100+120+130 input, 50+60+20 output
      expect(event.usage).toEqual({ input: 350, output: 130 });
    });
  });

  describe('IC-12: anthropic:error event with error, duration', () => {
    it('emits error event on message() API failure', async () => {
      // Use the mocked Anthropic.APIError class
      const apiError = new Anthropic.APIError(
        401,
        {
          type: 'error',
          error: { type: 'authentication_error', message: 'Invalid API key' },
        },
        'Authentication failed',
        {}
      );

      mockCreate.mockRejectedValue(apiError);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      await expect(ext.message.fn(['Test', {}], ctx)).rejects.toThrow();

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.error).toContain('Authentication failed');
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });

    it('emits error event on messages() validation failure', async () => {
      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Empty messages list triggers validation error
      await expect(ext.messages.fn([[], {}], ctx)).rejects.toThrow(
        'messages list cannot be empty'
      );

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.error).toContain('messages list cannot be empty');
    });

    it('emits error event on tool_loop failure', async () => {
      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Missing tools option triggers validation error
      await expect(ext.tool_loop.fn(['Test', {}], ctx)).rejects.toThrow(
        "tool_loop requires 'tools' option"
      );

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.error).toContain("tool_loop requires 'tools' option");
    });
  });

  describe('Event timestamp auto-generation', () => {
    it('adds ISO timestamp to all events via emitExtensionEvent', async () => {
      const mockResponse = {
        id: 'msg_timestamp',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 3 },
      };

      mockCreate.mockResolvedValue(mockResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      await ext.message.fn(['Test', {}], ctx);

      expect(events).toHaveLength(1);
      const event = events[0]!;

      // Verify timestamp is valid ISO string
      expect(event.timestamp).toBeDefined();
      const parsed = new Date(event.timestamp!);
      expect(parsed.toISOString()).toBe(event.timestamp);
    });
  });

  describe('Subsystem consistency', () => {
    it('uses extension:anthropic subsystem for all events', async () => {
      const mockMessageResponse = {
        id: 'msg_sub1',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response 1' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const mockMessagesResponse = {
        id: 'msg_sub2',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response 2' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 15, output_tokens: 8 },
      };

      const mockToolLoopResponse = {
        id: 'msg_sub3',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response 3' }],
        model: TEST_MODEL,
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
      };

      mockCreate
        .mockResolvedValueOnce(mockMessageResponse)
        .mockResolvedValueOnce(mockMessagesResponse)
        .mockResolvedValueOnce(mockToolLoopResponse);

      const events = createEventCollector();
      const ext = createAnthropicExtension({
        api_key: TEST_API_KEY,
        model: TEST_MODEL,
      });

      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Test all three main functions
      await ext.message.fn(['Test message', {}], ctx);
      await ext.messages.fn([[{ role: 'user', content: 'Test' }], {}], ctx);
      await ext.tool_loop.fn(['Test tool loop', { tools: [] }], ctx);

      expect(mockCreate).toHaveBeenCalledTimes(3);

      // Should have 3 success events
      expect(events).toHaveLength(3);
      events.forEach((event) => {
        expect(event.subsystem).toBe('extension:anthropic');
      });
    });
  });
});
