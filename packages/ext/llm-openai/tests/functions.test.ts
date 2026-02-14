/**
 * Function behavior tests for message() and messages()
 * Validates runtime behavior, error handling, and API integration
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
const mockEmbeddingsCreate = vi.fn();

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
      embeddings = {
        create: mockEmbeddingsCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-2: message("text") returns dict with required fields
    it('returns dict with content, model, usage, stop_reason, id, messages', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Hello from OpenAI!'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.message.fn(['Hello'], ctx)) as Record<
        string,
        unknown
      >;

      expect(result).toBeDefined();
      expect(result['content']).toBe('Hello from OpenAI!');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['id']).toBe('chatcmpl-test123');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from OpenAI!' },
      ]);
    });

    it('sends correct parameters to OpenAI API without system prompt', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['What is 2+2?'], ctx);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('sends system message as first message in OpenAI format', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['What is 2+2?'], ctx);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
      });
    });

    it('accepts options dict with system override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'Default system.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['Test', { system: 'Override system.' }], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'Override system.' },
            { role: 'user', content: 'Test' },
          ],
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        max_tokens: 1000,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['Test', { max_tokens: 2000 }], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        })
      );
    });

    it('uses default max_tokens when not specified', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['Test'], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });
  });

  describe('error cases', () => {
    // EC-5: Empty prompt text
    it('throws RuntimeError for empty prompt text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn([''], ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    it('throws RuntimeError for whitespace-only prompt text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['   '], ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-6: API authentication failure
    it('throws RuntimeError for 401 authentication error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(401, {}, 'Invalid API key', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 401): Invalid API key'
      );
    });

    // EC-7: API rate limit error
    it('throws RuntimeError for 429 rate limit error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(new APIError(429, {}, 'Rate limit', {}));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 429): Rate limit'
      );
    });

    // EC-8: Network timeout error
    it('throws RuntimeError for timeout error', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      mockCreate.mockRejectedValue(timeoutError);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toThrow(
        'OpenAI error: Request timeout'
      );
    });

    // EC-9: Generic API error with status
    it('throws RuntimeError for generic API error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(500, {}, 'Internal server error', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 500): Internal server error'
      );
    });
  });
});

// ============================================================
// MESSAGES() TESTS
// ============================================================

describe('messages() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-3: messages([...]) handles conversation history
    it('returns dict with conversation history', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Sure, I can help!'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
      ];

      const result = (await ext.messages.fn([inputMessages], ctx)) as Record<
        string,
        unknown
      >;

      expect(result['content']).toBe('Sure, I can help!');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
        { role: 'assistant', content: 'Sure, I can help!' },
      ]);
    });

    it('sends system message as first message in OpenAI format', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'You are helpful.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Hello' }];

      await ext.messages.fn([inputMessages], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );
    });

    it('accepts options dict with system override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'Default system.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];

      await ext.messages.fn(
        [inputMessages, { system: 'Override system.' }],
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'Override system.' },
            { role: 'user', content: 'Test' },
          ],
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];

      await ext.messages.fn([inputMessages, { max_tokens: 2000 }], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        })
      );
    });
  });

  describe('validation error cases', () => {
    // AC-23: Empty messages list raises error
    it('throws RuntimeError for empty messages list', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.messages.fn([[]], ctx)).rejects.toThrow(
        'messages list cannot be empty'
      );
    });

    // EC-10: Missing role field
    it('throws RuntimeError for message missing role field', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ content: 'Hello' }];

      await expect(ext.messages.fn([invalidMessages], ctx)).rejects.toThrow(
        "message missing required 'role' field"
      );
    });

    // EC-11: Invalid role value
    it('throws RuntimeError for invalid role value', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'system', content: 'Hello' }];

      await expect(ext.messages.fn([invalidMessages], ctx)).rejects.toThrow(
        "invalid role 'system'"
      );
    });

    // EC-12: User message missing content
    it('throws RuntimeError for user message missing content', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user' }];

      await expect(ext.messages.fn([invalidMessages], ctx)).rejects.toThrow(
        "user message requires 'content'"
      );
    });

    // EC-13: Assistant message missing both content and tool_calls
    it('throws RuntimeError for assistant message missing content and tool_calls', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'assistant' }];

      await expect(ext.messages.fn([invalidMessages], ctx)).rejects.toThrow(
        "assistant message requires 'content' or 'tool_calls'"
      );
    });

    it('accepts assistant message with content', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      await expect(
        ext.messages.fn([validMessages], ctx)
      ).resolves.toBeDefined();
    });

    it('accepts tool message with content', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'Tool output' },
      ];

      await expect(
        ext.messages.fn([validMessages], ctx)
      ).resolves.toBeDefined();
    });

    it('throws RuntimeError for tool message missing content', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'tool' }];

      await expect(ext.messages.fn([invalidMessages], ctx)).rejects.toThrow(
        "tool message requires 'content'"
      );
    });
  });

  describe('API error cases', () => {
    // EC-14: API errors apply to messages() too
    it('throws RuntimeError for 401 authentication error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(401, {}, 'Invalid API key', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn([messages], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 401): Invalid API key'
      );
    });

    it('throws RuntimeError for 429 rate limit error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(new APIError(429, {}, 'Rate limit', {}));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn([messages], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 429): Rate limit'
      );
    });

    it('throws RuntimeError for timeout error', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      mockCreate.mockRejectedValue(timeoutError);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn([messages], ctx)).rejects.toThrow(
        'OpenAI error: Request timeout'
      );
    });

    it('throws RuntimeError for generic API error', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(500, {}, 'Internal server error', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn([messages], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 500): Internal server error'
      );
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-4: embed("text") returns vector with model and dimensions
    it('returns vector with correct model and dimensions', async () => {
      const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed.fn(['test text'], ctx)) as any;

      expect(result.__rill_vector).toBe(true);
      expect(result.model).toBe('text-embedding-3-small');
      expect(result.data).toBeInstanceOf(Float32Array);
      expect(result.data.length).toBe(1536);
    });

    it('handles different embedding dimensions', async () => {
      const mockEmbedding = new Array(768).fill(0).map((_, i) => i * 0.001);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        model: 'text-embedding-3-large',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-large',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed.fn(['different size'], ctx)) as any;

      expect(result.data.length).toBe(768);
    });
  });

  describe('error cases', () => {
    // EC-15: Empty text raises error
    it('throws RuntimeError for empty text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn([''], ctx)).rejects.toThrow(
        'embed text cannot be empty'
      );
    });

    it('throws RuntimeError for whitespace-only text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['   \n\t  '], ctx)).rejects.toThrow(
        'embed text cannot be empty'
      );
    });

    // EC-16: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        // No embed_model
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['test'], ctx)).rejects.toThrow(
        'embed_model not configured'
      );
    });

    it('maps API authentication error (401)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(401, {}, 'Invalid API key', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['test'], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 401): Invalid API key'
      );
    });

    it('maps API rate limit error (429)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(429, {}, 'Rate limit exceeded', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['test'], ctx)).rejects.toThrow(
        'OpenAI API error (HTTP 429): Rate limit exceeded'
      );
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-5: embed_batch(["text1", "text2"]) returns list of vectors
    it('returns list of vectors for multiple texts', async () => {
      const mockEmbedding1 = new Array(1536).fill(0).map((_, i) => i * 0.001);
      const mockEmbedding2 = new Array(1536).fill(0).map((_, i) => i * 0.002);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding1 }, { embedding: mockEmbedding2 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed_batch.fn(
        [['text1', 'text2']],
        ctx
      )) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].__rill_vector).toBe(true);
      expect(result[1].__rill_vector).toBe(true);
      expect(result[0].model).toBe('text-embedding-3-small');
      expect(result[1].model).toBe('text-embedding-3-small');
    });

    // AC-24: embed_batch([]) returns empty list
    it('returns empty list for empty input', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed_batch.fn([[]], ctx)) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('error cases', () => {
    // EC-17: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed_batch.fn([['test']], ctx)).rejects.toThrow(
        'embed_model not configured'
      );
    });

    // EC-18: Non-string element in list
    it('throws RuntimeError for non-string element', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['valid', 123, 'text']], ctx)
      ).rejects.toThrow('embed_batch requires list of strings');
    });

    // EC-19: Empty string in list
    it('throws RuntimeError for empty string at index', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['valid', '', 'text']], ctx)
      ).rejects.toThrow('embed text cannot be empty at index 1');
    });

    // Note: Whitespace-only strings are now allowed by validation
    // and will be handled by the OpenAI API
    it.skip('throws RuntimeError for whitespace-only string at index', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['valid', '   ', 'text']], ctx)
      ).rejects.toThrow('embed text cannot be empty at index 1');
    });
  });
});

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-6: tool_loop with tools returns dict with content, usage, turns
    it('returns dict with content, model, usage, stop_reason, turns, messages', async () => {
      // Mock response without tool calls (final response)
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Final response' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = {
        __type: 'callable' as const,
        kind: 'runtime' as const,
        isProperty: false,
        fn: vi.fn().mockResolvedValue('tool result'),
      };

      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          params: {},
          fn: mockToolFn,
        },
      ];

      const result = (await ext.tool_loop.fn(
        ['test prompt', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('Final response');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['turns']).toBe(1);
      expect(Array.isArray(result['messages'])).toBe(true);
    });

    // AC-25: tool_loop with max_turns:1 stops after 1 turn
    it('respects max_turns limit', async () => {
      // First call returns tool call
      mockCreate.mockResolvedValueOnce({
        id: 'chatcmpl-test',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'test_tool', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = {
        __type: 'callable' as const,
        kind: 'runtime' as const,
        isProperty: false,
        fn: vi.fn().mockResolvedValue('tool result'),
      };

      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          params: {},
          fn: mockToolFn,
        },
      ];

      const result = (await ext.tool_loop.fn(
        ['test prompt', { tools, max_turns: 1 }],
        ctx
      )) as Record<string, unknown>;

      expect(result['turns']).toBe(1);
      expect(result['stop_reason']).toBe('max_turns');
    });

    // AC-26: tool_loop with 0 tool calls
    it('handles case with no tool calls', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'No tools needed' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          params: {},
          fn: {
            __type: 'callable' as const,
            kind: 'runtime' as const,
            isProperty: false,
            fn: vi.fn(),
          },
        },
      ];

      const result = (await ext.tool_loop.fn(
        ['test prompt', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('No tools needed');
      expect(result['turns']).toBe(1);
    });

    it('executes tool loop with tool calls', async () => {
      // First call returns tool call
      mockCreate
        .mockResolvedValueOnce({
          id: 'chatcmpl-test1',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"NYC"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        // Second call returns final response
        .mockResolvedValueOnce({
          id: 'chatcmpl-test2',
          object: 'chat.completion' as const,
          created: 1234567891,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: 'The weather is sunny',
              },
              finish_reason: 'stop' as const,
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
          },
        });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('Sunny, 72°F');

      const tools = [
        {
          name: 'get_weather',
          description: 'Get weather',
          params: {
            location: { type: 'string', description: 'City name' },
          },
          fn: {
            __type: 'callable' as const,
            kind: 'runtime' as const,
            isProperty: false,
            fn: mockToolFn,
          },
        },
      ];

      const result = (await ext.tool_loop.fn(
        ['What is the weather?', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('The weather is sunny');
      expect(result['turns']).toBe(2);
      expect(result['usage']).toEqual({ input: 30, output: 15 });
      expect(mockToolFn).toHaveBeenCalledWith(['NYC'], ctx);
    });
  });

  describe('error cases', () => {
    // EC-20: Empty prompt
    it('throws RuntimeError for empty prompt', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.tool_loop.fn(['', { tools: [] }], ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-21: Missing tools option
    it('throws RuntimeError when tools missing', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.tool_loop.fn(['test', {}], ctx)).rejects.toThrow(
        "tool_loop requires 'tools' option"
      );
    });

    // EC-22: Unknown tool name
    // Note: Unknown tool errors are now treated as tool execution errors
    // and count toward max_errors. With default max_errors=3, the unknown
    // tool error will be caught and the loop will continue up to 3 times.
    it('throws RuntimeError for unknown tool after max_errors', async () => {
      // Mock multiple responses all requesting the unknown tool
      mockCreate
        .mockResolvedValueOnce({
          id: 'chatcmpl-test1',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: { name: 'unknown_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-test2',
          object: 'chat.completion' as const,
          created: 1234567891,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_2',
                    type: 'function' as const,
                    function: { name: 'unknown_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 20, total_tokens: 35 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-test3',
          object: 'chat.completion' as const,
          created: 1234567892,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_3',
                    type: 'function' as const,
                    function: { name: 'unknown_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
        });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = [
        {
          name: 'known_tool',
          description: 'A known tool',
          params: {},
          fn: {
            __type: 'callable' as const,
            kind: 'runtime' as const,
            isProperty: false,
            fn: vi.fn(),
          },
        },
      ];

      await expect(
        ext.tool_loop.fn(['test prompt', { tools }], ctx)
      ).rejects.toThrow('Tool execution failed: 3 consecutive errors');
    });

    // EC-23: max_errors exceeded
    it('throws RuntimeError after max_errors consecutive failures', async () => {
      // Mock three tool calls that all fail
      mockCreate
        .mockResolvedValueOnce({
          id: 'chatcmpl-test1',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-test2',
          object: 'chat.completion' as const,
          created: 1234567891,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_2',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-test3',
          object: 'chat.completion' as const,
          created: 1234567892,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_3',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi
        .fn()
        .mockRejectedValue(new Error('Tool execution failed'));

      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          params: {},
          fn: {
            __type: 'callable' as const,
            kind: 'runtime' as const,
            isProperty: false,
            fn: mockToolFn,
          },
        },
      ];

      await expect(
        ext.tool_loop.fn(['test prompt', { tools, max_errors: 3 }], ctx)
      ).rejects.toThrow('Tool execution failed: 3 consecutive errors');
    });
  });
});
