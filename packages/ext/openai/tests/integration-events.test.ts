/**
 * Integration tests for event emission
 * Validates §4.10 extension event patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock OpenAI API response.
 */
function createMockResponse(content: string, model = 'gpt-4-turbo') {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

// Mock the OpenAI SDK at module level
const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: any,
      message: string,
      _headers: any
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// EVENT EMISSION TESTS
// ============================================================

describe('extension event emission', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('message() events', () => {
    it('emits openai:message event on success', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
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
        event: 'openai:message',
        subsystem: 'extension:openai',
        model: 'gpt-4-turbo',
        usage: { input: 10, output: 20 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits openai:error event on API failure', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(401, {}, 'Invalid API key', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
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
        event: 'openai:error',
        subsystem: 'extension:openai',
        error: 'OpenAI: authentication failed (401)',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('messages() events', () => {
    it('emits openai:messages event on success', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
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
        event: 'openai:messages',
        subsystem: 'extension:openai',
        model: 'gpt-4-turbo',
        usage: { input: 10, output: 20 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits openai:error event on API failure', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(new APIError(429, {}, 'Rate limit', {}));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
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
        event: 'openai:error',
        subsystem: 'extension:openai',
        error: 'OpenAI: rate limit',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });
});
