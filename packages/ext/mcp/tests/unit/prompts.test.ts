/**
 * Unit tests for prompt function generation.
 *
 * Coverage:
 * - IR-5: Generated prompt function signature
 * - IR-5: Calls MCP prompts/get with name and arguments
 * - IR-5: Returns list of dicts with role and content
 * - AC-10: Multi-part content concatenation
 * - AC-10: Message format validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpPrompt, McpPromptResult } from '../../src/prompts.js';
import { generatePromptFunctions } from '../../src/prompts.js';

describe('Prompt Function Generation', () => {
  let mockClient: Client;
  const timeoutMs = 5000;

  beforeEach(() => {
    mockClient = {
      getPrompt: vi.fn(),
    } as unknown as Client;
  });

  describe('IR-5: Generated prompt function signature', () => {
    it('generates prompt_{name} function with correct parameters', () => {
      const prompts: McpPrompt[] = [
        {
          name: 'code-review',
          description: 'Review code for issues',
          arguments: [
            { name: 'code', required: true },
            { name: 'language', required: false },
          ],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      expect(functions).toHaveProperty('prompt_code_review');
      const fn = functions.prompt_code_review!;

      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]).toMatchObject({
        name: 'code',
        type: 'string',
      });
      expect(fn.params[0]?.defaultValue).toBeUndefined(); // Required param

      expect(fn.params[1]).toMatchObject({
        name: 'language',
        type: 'string',
        defaultValue: '',
      });

      expect(fn.description).toBe('Review code for issues');
      expect(fn.returnType).toBe('list');
    });

    it('generates function with no parameters for prompt without arguments', () => {
      const prompts: McpPrompt[] = [
        {
          name: 'greeting',
          description: 'Get a greeting prompt',
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      expect(functions).toHaveProperty('prompt_greeting');
      const fn = functions.prompt_greeting!;

      expect(fn.params).toHaveLength(0);
      expect(fn.returnType).toBe('list');
    });

    it('sets defaultValue for optional arguments only', () => {
      const prompts: McpPrompt[] = [
        {
          name: 'test',
          arguments: [
            { name: 'required_arg', required: true },
            { name: 'optional_arg', required: false },
            { name: 'default_optional', required: undefined },
          ],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);
      const fn = functions.prompt_test!;

      expect(fn.params[0]?.defaultValue).toBeUndefined(); // required: true
      expect(fn.params[1]?.defaultValue).toBe(''); // required: false
      expect(fn.params[2]?.defaultValue).toBe(''); // required: undefined
    });
  });

  describe('IR-5: Calls MCP prompts/get with name and arguments', () => {
    it('calls client.getPrompt with prompt name and arguments dict', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'Test message' },
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [
        {
          name: 'test-prompt',
          arguments: [
            { name: 'arg1', required: true },
            { name: 'arg2', required: false },
          ],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);
      await functions.prompt_test_prompt!.fn(['value1', 'value2'], {
        _lifecycle: { connectEmitted: false },
      } as any);

      expect(mockGetPrompt).toHaveBeenCalledTimes(1);
      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: 'test-prompt',
        arguments: {
          arg1: 'value1',
          arg2: 'value2',
        },
      });
    });

    it('omits optional arguments when not provided', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [
        {
          name: 'test',
          arguments: [
            { name: 'required', required: true },
            { name: 'optional', required: false },
          ],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);
      await functions.prompt_test!.fn(['req-value', undefined], {
        _lifecycle: { connectEmitted: false },
      } as any);

      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: 'test',
        arguments: {
          required: 'req-value',
          // optional is omitted
        },
      });
    });

    it('throws for missing required arguments', async () => {
      const prompts: McpPrompt[] = [
        {
          name: 'test',
          arguments: [{ name: 'required', required: true }],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([undefined], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('required parameter required is missing');
    });

    it('validates argument types are strings', async () => {
      const prompts: McpPrompt[] = [
        {
          name: 'test',
          arguments: [{ name: 'arg', required: true }],
        },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([123], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('expected string for parameter arg, got number');
    });
  });

  describe('IR-5 & AC-10: Returns list of dicts with role and content', () => {
    it('returns list of message dicts with role and content fields', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'Hello' },
          },
          {
            role: 'assistant',
            content: { type: 'text', text: 'Hi there!' },
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);

      const msg1 = result[0] as { [key: string]: unknown };
      expect(msg1.role).toBe('user');
      expect(msg1.content).toBe('Hello');

      const msg2 = result[1] as { [key: string]: unknown };
      expect(msg2.role).toBe('assistant');
      expect(msg2.content).toBe('Hi there!');
    });

    it('handles empty message list', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('AC-10: Multi-part content concatenation', () => {
    it('concatenates multi-part text content with newlines', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'First part' },
              { type: 'text', text: 'Second part' },
              { type: 'text', text: 'Third part' },
            ],
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const msg = result[0] as { [key: string]: unknown };

      expect(msg.content).toBe('First part\nSecond part\nThird part');
    });

    it('handles single content object (not array)', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'Single content' },
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const msg = result[0] as { [key: string]: unknown };

      expect(msg.content).toBe('Single content');
    });

    it('skips non-text content parts', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Text part' },
              { type: 'image', data: 'base64data', mimeType: 'image/png' },
              { type: 'text', text: 'More text' },
            ],
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const msg = result[0] as { [key: string]: unknown };

      // Image part skipped, only text parts concatenated
      expect(msg.content).toBe('Text part\nMore text');
    });

    it('returns empty string for non-text single content', async () => {
      const mockGetPrompt = vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: { type: 'image', data: 'base64', mimeType: 'image/png' },
          },
        ],
      } as McpPromptResult);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result = await functions.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const msg = result[0] as { [key: string]: unknown };

      expect(msg.content).toBe('');
    });
  });

  describe('Name sanitization', () => {
    it('sanitizes prompt names to valid rill identifiers', () => {
      const prompts: McpPrompt[] = [
        { name: 'code-review' },
        { name: 'fetch.data' },
        { name: 'camelCaseName' },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      expect(functions).toHaveProperty('prompt_code_review');
      expect(functions).toHaveProperty('prompt_fetch_data');
      expect(functions).toHaveProperty('prompt_camel_case_name');
    });

    it('handles name collisions with numeric suffixes', () => {
      const prompts: McpPrompt[] = [
        { name: 'test-name' },
        { name: 'test_name' }, // Collides after sanitization
        { name: 'testName' }, // Also collides
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      expect(functions).toHaveProperty('prompt_test_name');
      expect(functions).toHaveProperty('prompt_test_name_2');
      expect(functions).toHaveProperty('prompt_test_name_3');
    });
  });

  describe('Error handling', () => {
    it('handles timeout errors', async () => {
      const mockGetPrompt = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          })
      );

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, 50); // 50ms timeout

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow();
    });

    it('handles connection lost errors', async () => {
      const mockGetPrompt = vi
        .fn()
        .mockRejectedValue(new Error('connection closed unexpectedly'));

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('connection lost');
    });

    it('handles authentication errors', async () => {
      const mockGetPrompt = vi
        .fn()
        .mockRejectedValue(new Error('unauthorized access'));

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('authentication failed');
    });

    it('handles protocol errors', async () => {
      const mockGetPrompt = vi
        .fn()
        .mockRejectedValue(new Error('invalid response format'));

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('protocol');
    });

    it('wraps generic errors as tool errors', async () => {
      const mockGetPrompt = vi
        .fn()
        .mockRejectedValue(new Error('Something went wrong'));

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('Something went wrong');
    });

    it('preserves RuntimeError instances without wrapping', async () => {
      const runtimeError = new Error('Runtime error');
      runtimeError.name = 'RuntimeError';

      const mockGetPrompt = vi.fn().mockRejectedValue(runtimeError);

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'test' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      await expect(
        functions.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow(runtimeError);
    });
  });

  describe('Multiple prompts', () => {
    it('generates functions for multiple prompts', () => {
      const prompts: McpPrompt[] = [
        { name: 'prompt1', description: 'First prompt' },
        { name: 'prompt2', description: 'Second prompt' },
        { name: 'prompt3', description: 'Third prompt' },
      ];

      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      expect(Object.keys(functions)).toHaveLength(3);
      expect(functions).toHaveProperty('prompt_prompt1');
      expect(functions).toHaveProperty('prompt_prompt2');
      expect(functions).toHaveProperty('prompt_prompt3');
    });

    it('each function operates independently', async () => {
      const mockGetPrompt = vi
        .fn()
        .mockResolvedValueOnce({
          messages: [{ role: 'user', content: { type: 'text', text: 'A' } }],
        })
        .mockResolvedValueOnce({
          messages: [{ role: 'user', content: { type: 'text', text: 'B' } }],
        });

      mockClient.getPrompt = mockGetPrompt;

      const prompts: McpPrompt[] = [{ name: 'p1' }, { name: 'p2' }];
      const functions = generatePromptFunctions(prompts, mockClient, timeoutMs);

      const result1 = await functions.prompt_p1!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const result2 = await functions.prompt_p2!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      const msg1 = result1[0] as { [key: string]: unknown };
      const msg2 = result2[0] as { [key: string]: unknown };

      expect(msg1.content).toBe('A');
      expect(msg2.content).toBe('B');
    });
  });
});
