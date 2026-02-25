/**
 * generate() function tests
 * Covers remaining AC/EC items not tested in functions.test.ts
 *
 * Already covered in functions.test.ts:
 *   AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12
 *   AC-18/EC-3, AC-25/EC-3, AC-19/EC-4, AC-21/EC-5
 *   AC-22/EC-5, AC-27/EC-6, AC-33, AC-35
 *
 * This file adds:
 *   AC-1: data field contains schema-matching keys
 *   AC-19/EC-4: no HTTP call when unsupported type (mockCreate not called)
 *   AC-23/EC-5: parse error is RuntimeError instance with RILL-R004 code
 *   AC-24/EC-5: parse failure returns no partial dict (rejects, does not resolve)
 *   AC-27/EC-6: openai:error event emitted on provider API error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, RuntimeError } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: unknown,
      message: string,
      _headers: unknown
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
      embeddings = {
        create: vi.fn(),
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

function createGenerateMockResponse(jsonContent: string, model = 'gpt-4o') {
  return {
    id: 'chatcmpl_123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content: jsonContent },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  };
}

const baseConfig: OpenAIExtensionConfig = {
  api_key: 'test-key',
  model: 'gpt-4o',
};

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-1: data field contains schema-matching keys
    it('returns data dict with keys matching the schema', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['describe a person', { schema: { name: 'string', age: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(data).toBeDefined();
      expect(data['name']).toBe('Alice');
      expect(data['age']).toBe(30);
      expect(Object.keys(data).sort()).toEqual(['age', 'name']);
    });

    // AC-1: data field is the parsed object, not the raw string
    it('returns data as parsed object, not raw string', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"score":99}'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['rate something', { schema: { score: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      expect(typeof result['data']).toBe('object');
      expect(result['data']).not.toBe('{"score":99}');
    });
  });

  describe('error cases', () => {
    // AC-19/EC-4: no HTTP call when unsupported type
    it('makes no API call when schema contains unsupported type', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(
          ['prompt', { schema: { field: 'unsupported_type' } }],
          ctx
        )
      ).rejects.toThrow();

      expect(mockCreate).not.toHaveBeenCalled();
    });

    // AC-23/EC-5: parse error is a RuntimeError instance
    it('throws a RuntimeError instance when response is not valid JSON', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('not json'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
    });

    // AC-23/EC-5: parse error has RILL-R004 error code
    it('parse error RuntimeError has RILL-R004 code', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{broken'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    // AC-22/EC-5: "{broken" response throws with original parse error detail
    it('includes original parse error detail in thrown message', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{broken'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx)
      ).rejects.toThrow('generate: failed to parse response JSON:');

      // Verify message contains the native JSON parse error detail
      let thrown: unknown;
      try {
        await ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx);
      } catch (err) {
        thrown = err;
      }

      const message = (thrown as RuntimeError).message;
      // Message must contain detail beyond just the prefix
      expect(message.length).toBeGreaterThan(
        'generate: failed to parse response JSON:'.length
      );
    });

    // AC-24/EC-5: parse failure returns no partial dict (promise rejects, not resolves)
    it('rejects rather than resolving with partial data on parse failure', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('not json'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      // Must reject, never resolve to a value
      await expect(
        ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx)
      ).rejects.toThrow();
    });

    // AC-27/EC-6: provider API error emits openai:error event
    it('emits openai:error event when provider API returns an error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(429, {}, 'Rate limit exceeded', {})
      );

      const events: Array<Record<string, unknown>> = [];
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(
        ext.generate.fn(['prompt', { schema: { x: 'number' } }], ctx)
      ).rejects.toThrow();

      const errorEvent = events.find((e) => e['event'] === 'openai:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['error']).toBe('string');
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });
});
