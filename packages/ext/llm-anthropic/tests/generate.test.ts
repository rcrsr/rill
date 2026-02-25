/**
 * Function behavior tests for generate()
 * Validates structured output, error handling, and event emission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, RuntimeError } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import type { ExtensionEvent } from '@rcrsr/rill';

// ============================================================
// TEST HELPERS
// ============================================================

const BASE_CONFIG: AnthropicExtensionConfig = {
  api_key: 'test-key',
  model: 'claude-3-5-sonnet-20241022',
};

/**
 * Create mock Anthropic API response for generate tests.
 * The content text field holds the JSON string returned by the model.
 */
function createMockGenerateResponse(
  jsonText: string,
  model = 'claude-3-5-sonnet-20241022'
) {
  return {
    id: 'msg_123',
    model,
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 20 },
    content: [{ type: 'text', text: jsonText }],
  };
}

/**
 * Create event collector array for onLogEvent callback.
 */
function createEventCollector(): ExtensionEvent[] {
  return [];
}

/**
 * Create runtime context with event collector attached.
 */
function createCtxWithEvents(events: ExtensionEvent[]) {
  return createRuntimeContext({
    callbacks: {
      onLog: vi.fn(),
      onLogEvent: (event) => events.push(event),
    },
  });
}

// ============================================================
// SDK MOCK
// ============================================================

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // --------------------------------------------------------
  // SUCCESS CASES
  // --------------------------------------------------------

  describe('success cases', () => {
    // AC-1: Returns data with schema-matching keys
    it('returns data with schema-matching keys', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['Generate a person', { schema: { name: 'string', age: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(data['name']).toBe('Alice');
      expect(data['age']).toBe(30);
    });

    // AC-3: Nested dict schema returns data.addr as dict with expected keys
    it('returns nested dict data when schema has nested dict', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse(
          '{"addr":{"street":"123 Main St","city":"Springfield"}}'
        )
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        [
          'Generate an address',
          {
            schema: {
              addr: {
                type: 'dict',
                properties: { street: 'string', city: 'string' },
              },
            },
          },
        ],
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      const addr = data['addr'] as Record<string, unknown>;
      expect(typeof addr).toBe('object');
      expect(addr['street']).toBe('123 Main St');
      expect(addr['city']).toBe('Springfield');
    });

    // AC-4: List schema returns data.tags as list
    it('returns list data when schema has list field', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"tags":["typescript","node","testing"]}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        [
          'Generate tags',
          { schema: { tags: { type: 'list', items: 'string' } } },
        ],
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(Array.isArray(data['tags'])).toBe(true);
      expect(data['tags']).toEqual(['typescript', 'node', 'testing']);
    });

    // AC-5: Enum constraint included in provider schema
    it('sends enum constraint in output_config schema to Anthropic API', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"status":"active"}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await ext.generate.fn(
        [
          'Get status',
          {
            schema: {
              status: {
                type: 'string',
                enum: ['active', 'inactive', 'pending'],
              },
            },
          },
        ],
        ctx
      );

      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      const outputConfig = callArgs['output_config'] as Record<string, unknown>;
      const format = outputConfig['format'] as Record<string, unknown>;
      const schema = format['schema'] as Record<string, unknown>;
      const properties = schema['properties'] as Record<string, unknown>;
      const statusProp = properties['status'] as Record<string, unknown>;

      expect(statusProp['enum']).toEqual(['active', 'inactive', 'pending']);
    });

    // AC-6: Return dict contains exactly 6 keys
    it('returns dict with exactly 6 keys', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['Generate', { schema: { name: 'string', age: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      expect(Object.keys(result)).toHaveLength(6);
      expect(Object.keys(result).sort()).toEqual(
        ['data', 'id', 'model', 'raw', 'stop_reason', 'usage'].sort()
      );
    });

    // AC-7: usage is dict with input: number and output: number
    it('usage contains input and output as numbers', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['Generate', { schema: { name: 'string', age: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      const usage = result['usage'] as Record<string, unknown>;
      expect(typeof usage['input']).toBe('number');
      expect(typeof usage['output']).toBe('number');
      expect(usage['input']).toBe(50);
      expect(usage['output']).toBe(20);
    });

    // AC-8: raw contains original JSON string from model
    it('raw contains original JSON string returned by the model', async () => {
      const jsonText = '{"name":"Alice","age":30}';
      mockCreate.mockResolvedValue(createMockGenerateResponse(jsonText));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await ext.generate.fn(
        ['Generate', { schema: { name: 'string', age: 'number' } }],
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonText);
    });

    // AC-9: system option overrides factory default
    it('system option overrides factory-configured system prompt', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension({
        ...BASE_CONFIG,
        system: 'Default system prompt.',
      });
      const ctx = createRuntimeContext();

      await ext.generate.fn(
        [
          'Generate',
          {
            schema: { name: 'string' },
            system: 'Override system prompt.',
          },
        ],
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'Override system prompt.' })
      );
    });

    // AC-10: max_tokens option caps output tokens
    it('max_tokens option is forwarded to Anthropic API', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await ext.generate.fn(
        ['Generate', { schema: { name: 'string' }, max_tokens: 512 }],
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 512 })
      );
    });

    // AC-11: messages option prepends conversation context
    it('messages option prepends conversation context before prompt', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prependedMessages = [
        { role: 'user', content: 'What format do you prefer?' },
        { role: 'assistant', content: 'I prefer JSON.' },
      ];

      await ext.generate.fn(
        [
          'Generate a name',
          { schema: { name: 'string' }, messages: prependedMessages },
        ],
        ctx
      );

      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<Record<string, unknown>>;

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'What format do you prefer?',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'I prefer JSON.',
      });
      expect(messages[2]).toEqual({ role: 'user', content: 'Generate a name' });
    });

    // AC-12: Absent system uses factory-configured default
    it('uses factory system prompt when no system option provided', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension({
        ...BASE_CONFIG,
        system: 'Factory system prompt.',
      });
      const ctx = createRuntimeContext();

      await ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'Factory system prompt.' })
      );
    });
  });

  // --------------------------------------------------------
  // ERROR CASES
  // --------------------------------------------------------

  describe('error cases', () => {
    // AC-18 / EC-3: Missing schema throws RILL-R004
    it('throws RILL-R004 when schema option is missing', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate something', {}], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: "generate requires 'schema' option",
      });
    });

    // AC-25 / EC-3: No HTTP call when schema is missing
    it('makes no HTTP call when schema option is missing', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate something', {}], ctx)
      ).rejects.toThrow();

      expect(mockCreate).not.toHaveBeenCalled();
    });

    // AC-19 / EC-4: Unsupported type throws RILL-R004 before HTTP
    it('throws RILL-R004 for unsupported type before making HTTP call', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate', { schema: { ts: 'timestamp' } }], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('timestamp'),
      });

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('throws RILL-R004 for "integer" type before HTTP call', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate', { schema: { count: 'integer' } }], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('integer'),
      });

      expect(mockCreate).not.toHaveBeenCalled();
    });

    // AC-26 / EC-2: Enum on number type throws RILL-R004 before HTTP
    it('throws RILL-R004 when enum is used on number type before HTTP call', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(
          [
            'Generate',
            {
              schema: {
                code: { type: 'number', enum: ['1', '2', '3'] },
              },
            },
          ],
          ctx
        )
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('enum'),
      });

      expect(mockCreate).not.toHaveBeenCalled();
    });

    // AC-21 / EC-5: "not json" response throws RILL-R004
    it('throws RILL-R004 when model returns non-JSON text', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
      });
    });

    // AC-22 / EC-5: "{broken" response includes original parse error detail
    it('throws RILL-R004 with original parse error detail for malformed JSON', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('{broken'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx)
      ).rejects.toMatchObject({
        errorId: 'RILL-R004',
        message: expect.stringContaining('failed to parse response JSON'),
      });
    });

    // AC-23 / EC-5: Parse failure error is instance of RuntimeError with RILL-R004
    it('parse failure throws RuntimeError instance with RILL-R004', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await ext.generate.fn(
          ['Generate', { schema: { name: 'string' } }],
          ctx
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    // AC-24 / EC-5: Parse failure never returns a partial dict
    it('parse failure does not return a partial result', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      let result: unknown = undefined;
      try {
        result = await ext.generate.fn(
          ['Generate', { schema: { name: 'string' } }],
          ctx
        );
      } catch {
        // expected
      }

      expect(result).toBeUndefined();
    });

    // AC-27 / EC-6: Provider API error emits anthropic:error event
    it('emits anthropic:error event when provider API throws', async () => {
      const { APIError } = await import('@anthropic-ai/sdk');
      const apiError = new APIError(429, {}, 'Rate limit exceeded', {});
      mockCreate.mockRejectedValue(apiError);

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expect(
        ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx)
      ).rejects.toThrow();

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.error).toContain('Rate limit exceeded');
    });
  });

  // --------------------------------------------------------
  // EVENT EMISSION
  // --------------------------------------------------------

  describe('event emission', () => {
    // AC-32: Successful call emits anthropic:generate with model, usage, duration
    it('emits anthropic:generate event with model, usage, and duration on success', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await ext.generate.fn(
        ['Generate', { schema: { name: 'string', age: 'number' } }],
        ctx
      );

      const generateEvents = events.filter(
        (e) => e.event === 'anthropic:generate'
      );
      expect(generateEvents).toHaveLength(1);

      const event = generateEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.model).toBe('claude-3-5-sonnet-20241022');
      expect(event.usage).toEqual({ input: 50, output: 20 });
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    // AC-35: Failed call emits anthropic:error event
    it('emits anthropic:error event when generate fails', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('{broken'));

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expect(
        ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx)
      ).rejects.toThrow();

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(typeof event.error).toBe('string');
      expect(typeof event.duration).toBe('number');
    });

    it('does not emit anthropic:generate event on failure', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expect(
        ext.generate.fn(['Generate', { schema: { name: 'string' } }], ctx)
      ).rejects.toThrow();

      const generateEvents = events.filter(
        (e) => e.event === 'anthropic:generate'
      );
      expect(generateEvents).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // FUNCTION METADATA
  // --------------------------------------------------------

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);

      expect(ext.generate.params).toEqual([
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict' },
      ]);
    });

    it('has correct return type', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);

      expect(ext.generate.returnType).toBe('dict');
    });

    it('has description string', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);

      expect(typeof ext.generate.description).toBe('string');
      expect(ext.generate.description.length).toBeGreaterThan(0);
    });
  });
});
