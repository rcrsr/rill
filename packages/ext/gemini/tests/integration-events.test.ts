/**
 * Integration tests for event emission
 * Validates §4.10 extension event patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock Google API response for generateContent.
 */
function createMockGenerateContentResponse(content: string) {
  return {
    text: content,
    functionCalls: undefined,
  };
}

/**
 * Create mock Google API response for embedContent.
 */
function createMockEmbedContentResponse(dimensions = 768) {
  return {
    embeddings: [
      {
        values: Array.from({ length: dimensions }, (_, i) => i * 0.01),
      },
    ],
  };
}

// Mock the Google GenAI SDK at module level
const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        embedContent: mockEmbedContent,
      };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      BOOLEAN: 'BOOLEAN',
      INTEGER: 'INTEGER',
      OBJECT: 'OBJECT',
    },
  };
});

// ============================================================
// EVENT EMISSION TESTS
// ============================================================

describe('extension event emission', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockEmbedContent.mockReset();
  });

  describe('message() events', () => {
    it('emits gemini:message event on success', async () => {
      mockGenerateContent.mockResolvedValue(
        createMockGenerateContentResponse('Response')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await ext.message.fn(['Test'], ctx);

      // Verify event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:message',
        subsystem: 'extension:gemini',
        model: 'gemini-2.0-flash',
        usage: { input: 0, output: 0 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits gemini:error event on API failure', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('API request failed (401)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(ext.message.fn(['Test'], ctx)).rejects.toThrow();

      // Verify error event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
        error: 'Gemini API error (HTTP 401): API request failed (401)',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('messages() events', () => {
    it('emits gemini:messages event on success', async () => {
      mockGenerateContent.mockResolvedValue(
        createMockGenerateContentResponse('Response')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const messages = [{ role: 'user', content: 'Test' }];
      await ext.messages.fn([messages], ctx);

      // Verify event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:messages',
        subsystem: 'extension:gemini',
        model: 'gemini-2.0-flash',
        usage: { input: 0, output: 0 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits gemini:error event on API failure', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('API request failed (429)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const messages = [{ role: 'user', content: 'Test' }];
      await expect(ext.messages.fn([messages], ctx)).rejects.toThrow();

      // Verify error event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
        error: 'Gemini API error (HTTP 429): API request failed (429)',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('embed() events', () => {
    it('emits gemini:embed event on success', async () => {
      mockEmbedContent.mockResolvedValue(createMockEmbedContentResponse(768));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await ext.embed.fn(['Test text'], ctx);

      // Verify event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:embed',
        subsystem: 'extension:gemini',
        model: 'text-embedding-004',
        dimensions: 768,
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits gemini:error event on API failure', async () => {
      mockEmbedContent.mockRejectedValue(new Error('timeout'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(ext.embed.fn(['Test text'], ctx)).rejects.toThrow();

      // Verify error event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
        error: 'Gemini API error: timeout',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('embed_batch() events', () => {
    it('emits gemini:embed_batch event on success', async () => {
      mockEmbedContent.mockResolvedValue({
        embeddings: [
          { values: Array.from({ length: 768 }, (_, i) => i * 0.01) },
          { values: Array.from({ length: 768 }, (_, i) => i * 0.02) },
          { values: Array.from({ length: 768 }, (_, i) => i * 0.03) },
        ],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const texts = ['Text 1', 'Text 2', 'Text 3'];
      await ext.embed_batch.fn([texts], ctx);

      // Verify event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:embed_batch',
        subsystem: 'extension:gemini',
        model: 'text-embedding-004',
        dimensions: 768,
        count: 3,
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits gemini:error event on API failure', async () => {
      mockEmbedContent.mockRejectedValue(new Error('API error'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const texts = ['Text 1', 'Text 2'];
      await expect(ext.embed_batch.fn([texts], ctx)).rejects.toThrow();

      // Verify error event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
        error: 'Gemini API error: API error',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('tool_loop() events', () => {
    it('emits gemini:tool_call, gemini:tool_result, and gemini:tool_loop events on success', async () => {
      // First call: model calls a tool
      mockGenerateContent.mockResolvedValueOnce({
        text: '',
        functionCalls: [
          {
            name: 'test_tool',
            args: { value: 'test' },
            id: 'call_123',
          },
        ],
      });

      // Second call: model returns final response
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Final response',
        functionCalls: undefined,
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      // Create mock tool
      const mockTool = {
        name: 'test_tool',
        fn: {
          __type: 'callable' as const,
          kind: 'application' as const,
          fn: vi.fn().mockResolvedValue('Tool result'),
        },
        description: 'Test tool',
        params: {},
      };

      const options = {
        tools: [mockTool],
        max_turns: 5,
      };

      await ext.tool_loop.fn(['Test prompt', options], ctx);

      // Verify event sequence (§4.10)
      expect(events.length).toBeGreaterThanOrEqual(3);

      // Find events by type
      const toolCallEvents = events.filter(
        (e) => e['event'] === 'gemini:tool_call'
      );
      const toolResultEvents = events.filter(
        (e) => e['event'] === 'gemini:tool_result'
      );
      const toolLoopEvents = events.filter(
        (e) => e['event'] === 'gemini:tool_loop'
      );

      // Verify tool_call event
      expect(toolCallEvents).toHaveLength(1);
      expect(toolCallEvents[0]).toMatchObject({
        event: 'gemini:tool_call',
        subsystem: 'extension:gemini',
        tool_name: 'test_tool',
      });
      expect(typeof toolCallEvents[0]?.['args']).toBe('object');

      // Verify tool_result event
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0]).toMatchObject({
        event: 'gemini:tool_result',
        subsystem: 'extension:gemini',
        tool_name: 'test_tool',
      });

      // Verify tool_loop event
      expect(toolLoopEvents).toHaveLength(1);
      expect(toolLoopEvents[0]).toMatchObject({
        event: 'gemini:tool_loop',
        subsystem: 'extension:gemini',
        turns: 2,
        usage: { input: 0, output: 0 },
      });
      expect(typeof toolLoopEvents[0]?.['total_duration']).toBe('number');
    });

    it('emits gemini:error event on API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const mockTool = {
        name: 'test_tool',
        fn: {
          __type: 'callable' as const,
          kind: 'application' as const,
          fn: vi.fn(),
        },
        description: 'Test tool',
        params: {},
      };

      const options = {
        tools: [mockTool],
      };

      await expect(
        ext.tool_loop.fn(['Test prompt', options], ctx)
      ).rejects.toThrow();

      // Verify error event structure (§4.10)
      const errorEvents = events.filter((e) => e['event'] === 'gemini:error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
        error: 'Provider API error: API error',
      });
      expect(typeof errorEvents[0]?.['duration']).toBe('number');
    });

    it('emits tool_result event with error field when tool execution fails', async () => {
      // First call: model calls a tool
      mockGenerateContent.mockResolvedValueOnce({
        text: '',
        functionCalls: [
          {
            name: 'test_tool',
            args: { value: 'test' },
            id: 'call_123',
          },
        ],
      });

      // Second call: model returns final response after tool error
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Final response after error',
        functionCalls: undefined,
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      // Create mock tool that throws an error
      const mockTool = {
        name: 'test_tool',
        fn: {
          __type: 'callable' as const,
          kind: 'application' as const,
          fn: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
        },
        description: 'Test tool',
        params: {},
      };

      const options = {
        tools: [mockTool],
        max_turns: 5,
        max_errors: 3,
      };

      await ext.tool_loop.fn(['Test prompt', options], ctx);

      // Find tool_result event
      const toolResultEvents = events.filter(
        (e) => e['event'] === 'gemini:tool_result'
      );
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0]).toMatchObject({
        event: 'gemini:tool_result',
        subsystem: 'extension:gemini',
        tool_name: 'test_tool',
        error: 'Tool execution failed',
      });
    });
  });
});
