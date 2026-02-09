/**
 * Function behavior tests for message() and messages()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock Anthropic API response.
 */
function createMockResponse(
  content: string,
  model = 'claude-sonnet-4-5-20250929'
) {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/**
 * Create mock API error with status property.
 */
async function createMockAPIError(status: number, message: string) {
  const { APIError } = await import('@anthropic-ai/sdk');
  return new APIError(status, {}, message, {});
}

// Mock the Anthropic SDK at module level
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, _error: any, message: string, _headers: any) {
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
      mockCreate.mockResolvedValue(createMockResponse('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.message.fn(['Hello'], ctx)) as Record<
        string,
        unknown
      >;

      expect(result).toBeDefined();
      expect(result['content']).toBe('Hello from Claude!');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from Claude!' },
      ]);
    });

    it('sends correct parameters to Anthropic API', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['What is 2+2?'], ctx);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        temperature: 0.7,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('accepts options dict with system override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        system: 'Default system.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn(['Test', { system: 'Override system.' }], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Override system.',
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
      };

      const ext = createAnthropicExtension(config);
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

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
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
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn([''], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('prompt text cannot be empty'),
      });
    });

    it('throws RuntimeError for whitespace-only prompt', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['   \n\t  '], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('prompt text cannot be empty'),
      });
    });

    // EC-6: API rate limit (429)
    it('maps 429 rate limit error correctly', async () => {
      const mockError = await createMockAPIError(429, 'Rate limit exceeded');
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: rate limit',
      });
    });

    // EC-7: API auth failure (401)
    it('maps 401 auth error correctly', async () => {
      const mockError = await createMockAPIError(401, 'Invalid API key');
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: authentication failed (401)',
      });
    });

    // EC-8: Network timeout
    it('maps timeout error correctly', async () => {
      const mockError = new Error('Request timeout');
      mockError.name = 'AbortError';
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: request timeout',
      });
    });

    // EC-9: API error with status code
    it('maps API error with status code correctly', async () => {
      const mockError = await createMockAPIError(500, 'Internal server error');
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: Internal server error (500)',
      });
    });

    it('maps unknown error correctly', async () => {
      const mockError = { unknown: 'error' };
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn(['Test'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: unknown error',
      });
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
    // AC-3: messages([...]) returns dict with required fields
    it('returns dict with content, model, usage, stop_reason, id, messages', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = (await ext.messages.fn(
        [conversationHistory],
        ctx
      )) as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result['content']).toBe('Claude response');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');

      // Verify full conversation history including new response
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'Claude response' },
      ]);
    });

    it('sends correct parameters to Anthropic API', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.5,
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ];

      await ext.messages.fn([conversationHistory], ctx);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        temperature: 0.5,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });
    });

    it('accepts single user message', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [{ role: 'user', content: 'Hello' }];

      const result = (await ext.messages.fn(
        [conversationHistory],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('Claude response');
    });

    it('accepts options dict with system override', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        system: 'Default system.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await ext.messages.fn(
        [[{ role: 'user', content: 'Test' }], { system: 'Override system.' }],
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Override system.',
        })
      );
    });
  });

  describe('error cases', () => {
    // AC-23: Empty messages list
    it('throws RuntimeError for empty messages list', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.messages.fn([[]], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('messages list cannot be empty'),
      });
    });

    // EC-10: Missing role field
    it('throws RuntimeError when message is missing role', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ content: 'Hello' }];

      await expect(
        ext.messages.fn([invalidMessages], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining(
          "message missing required 'role' field"
        ),
      });
    });

    // EC-11: Unknown role value
    it('throws RuntimeError for unknown role value', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'system', content: 'Hello' }];

      await expect(
        ext.messages.fn([invalidMessages], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining("invalid role 'system'"),
      });
    });

    // EC-12: User message missing content
    it('throws RuntimeError when user message missing content', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user' }];

      await expect(
        ext.messages.fn([invalidMessages], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining("user message requires 'content'"),
      });
    });

    it('throws RuntimeError when user content is not string', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user', content: 123 }];

      await expect(
        ext.messages.fn([invalidMessages], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining("user message requires 'content'"),
      });
    });

    // EC-13: Assistant missing both content and tool_calls
    it('throws RuntimeError when assistant missing content and tool_calls', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant' },
      ];

      await expect(
        ext.messages.fn([invalidMessages], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining(
          "assistant message requires 'content' or 'tool_calls'"
        ),
      });
    });

    it('accepts assistant message with content', async () => {
      mockCreate.mockResolvedValue(createMockResponse('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      await expect(
        ext.messages.fn([validMessages], ctx)
      ).resolves.toBeDefined();
    });

    // EC-14: API errors (same as message function)
    it('maps 429 rate limit error correctly', async () => {
      const mockError = await createMockAPIError(429, 'Rate limit exceeded');
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.messages.fn([[{ role: 'user', content: 'Test' }]], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: rate limit',
      });
    });

    it('maps 401 auth error correctly', async () => {
      const mockError = await createMockAPIError(401, 'Invalid API key');
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.messages.fn([[{ role: 'user', content: 'Test' }]], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: authentication failed (401)',
      });
    });

    it('maps timeout error correctly', async () => {
      const mockError = new Error('Request timeout');
      mockError.name = 'AbortError';
      mockCreate.mockRejectedValue(mockError);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.messages.fn([[{ role: 'user', content: 'Test' }]], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: request timeout',
      });
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  describe('error cases', () => {
    // EC-15: Empty text raises error
    it('raises error for empty text', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn([''], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'embed text cannot be empty',
      });
    });

    // EC-16: No embed_model configured raises error
    it('raises error when embed_model not configured', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        // embed_model not provided
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['test text'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'embed_model not configured',
      });
    });

    // EC-17: API errors mapped correctly (currently raises "not available")
    it('raises error indicating embeddings API not available', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn(['test text'], ctx)).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: embeddings API not available',
      });
    });
  });

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed.params).toEqual([{ name: 'text', type: 'string' }]);
    });

    it('has correct description', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed.description).toBe('Generate embedding vector for text');
    });

    it('has correct return type', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed.returnType).toBe('vector');
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  describe('success cases', () => {
    // AC-24: Empty list returns empty list without API call
    it('returns empty list for empty input without API call', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = await ext.embed_batch.fn([[]], ctx);

      expect(result).toEqual([]);
    });
  });

  describe('error cases', () => {
    // EC-18: Non-string element raises error
    it('raises error for non-string element', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['text1', 123, 'text3']], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'embed_batch requires list of strings',
      });
    });

    // EC-19: Empty string at index raises error
    it('raises error for empty string element with index', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['text1', '', 'text3']], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'embed text cannot be empty at index 1',
      });
    });

    // EC-20: No embed_model configured raises error
    it('raises error when embed_model not configured', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        // embed_model not provided
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['text1', 'text2']], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'embed_model not configured',
      });
    });

    // EC-21: API errors mapped correctly (currently raises "not available")
    it('raises error indicating embeddings API not available', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn([['text1', 'text2']], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: 'Anthropic: embeddings API not available',
      });
    });
  });

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed_batch.params).toEqual([{ name: 'texts', type: 'list' }]);
    });

    it('has correct description', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed_batch.description).toBe(
        'Generate embedding vectors for multiple texts'
      );
    });

    it('has correct return type', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(ext.embed_batch.returnType).toBe('list');
    });
  });
});
