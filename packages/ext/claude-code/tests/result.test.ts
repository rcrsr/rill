/**
 * Tests for result extraction from Claude Code message streams.
 */

import { describe, it, expect } from 'vitest';
import { extractResult } from '../src/result.js';
import type {
  ClaudeMessage,
  AssistantMessage,
  ResultMessage,
  SystemMessage,
  UserMessage,
} from '../src/types.js';

describe('extractResult', () => {
  describe('basic extraction', () => {
    // AC-1: Basic prompt returns result dict with text, tokens, cost, exitCode 0
    it('extracts complete result dict from single assistant message', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello, world!' }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0.001,
          duration_ms: 1500,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('Hello, world!');
      expect(result.tokens.prompt).toBe(10);
      expect(result.tokens.output).toBe(5);
      expect(result.cost).toBe(0.001);
      expect(result.duration).toBe(1500);
      expect(result.exitCode).toBe(0);
    });

    it('sets exitCode to 1 when result is_error is true', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'result',
          cost_usd: 0.001,
          duration_ms: 1500,
          is_error: true,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('text extraction', () => {
    it('concatenates text from multiple assistant messages', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First part. ' }],
            usage: {},
          },
        } as AssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Second part.' }],
            usage: {},
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('First part. Second part.');
    });

    it('extracts multiple text blocks from single assistant message', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Block 1. ' },
              { type: 'text', text: 'Block 2.' },
            ],
            usage: {},
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('Block 1. Block 2.');
    });

    it('ignores tool_use blocks when extracting text', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Text before tool' },
              {
                type: 'tool_use',
                id: 'tool_1',
                name: 'read_file',
                input: { path: 'file.txt' },
              },
              { type: 'text', text: 'Text after tool' },
            ],
            usage: {},
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('Text before toolText after tool');
    });

    // AC-12: Empty result (no assistant messages with text) returns empty string
    it('returns empty string when no assistant messages with text', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-3-5-sonnet',
        } as SystemMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 100,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('');
    });

    it('returns empty string when assistant messages have no text blocks', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool_1',
                name: 'read_file',
                input: {},
              },
            ],
            usage: {},
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 100,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('');
    });
  });

  describe('token accumulation', () => {
    // AC-4: Token tracking extracts 5-field breakdown from usage events
    it('accumulates tokens from single assistant message usage', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 20,
              cache_creation: {
                ephemeral_5m_input_tokens: 30,
                ephemeral_1h_input_tokens: 10,
              },
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.prompt).toBe(100);
      expect(result.tokens.output).toBe(50);
      expect(result.tokens.cacheRead).toBe(20);
      expect(result.tokens.cacheWrite5m).toBe(30);
      expect(result.tokens.cacheWrite1h).toBe(10);
    });

    // AC-4: Multiple usage fields accumulated correctly
    it('accumulates tokens across multiple assistant messages', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        } as AssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Second' }],
            usage: {
              input_tokens: 200,
              output_tokens: 75,
              cache_read_input_tokens: 30,
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0.005,
          duration_ms: 2000,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.prompt).toBe(300); // 100 + 200
      expect(result.tokens.output).toBe(125); // 50 + 75
      expect(result.tokens.cacheRead).toBe(30);
    });

    it('accumulates cache write tokens across messages', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [],
            usage: {
              cache_creation: {
                ephemeral_5m_input_tokens: 100,
                ephemeral_1h_input_tokens: 50,
              },
            },
          },
        } as AssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [],
            usage: {
              cache_creation: {
                ephemeral_5m_input_tokens: 150,
                ephemeral_1h_input_tokens: 75,
              },
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.cacheWrite5m).toBe(250); // 100 + 150
      expect(result.tokens.cacheWrite1h).toBe(125); // 50 + 75
    });

    it('includes usage tokens from result message', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [],
            usage: {
              input_tokens: 100,
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
          },
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.prompt).toBe(150); // 100 + 50
      expect(result.tokens.output).toBe(25);
    });

    // AC-13: Zero tokens (no usage fields) returns all-zero TokenCounts
    it('returns all-zero tokens when no usage fields present', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            usage: undefined,
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 100,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.prompt).toBe(0);
      expect(result.tokens.cacheWrite5m).toBe(0);
      expect(result.tokens.cacheWrite1h).toBe(0);
      expect(result.tokens.cacheRead).toBe(0);
      expect(result.tokens.output).toBe(0);
    });

    it('handles partial usage fields correctly', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [],
            usage: {
              input_tokens: 100,
              // output_tokens missing
              cache_creation: {
                ephemeral_5m_input_tokens: 20,
                // ephemeral_1h_input_tokens missing
              },
            },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0,
          duration_ms: 0,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.tokens.prompt).toBe(100);
      expect(result.tokens.output).toBe(0);
      expect(result.tokens.cacheWrite5m).toBe(20);
      expect(result.tokens.cacheWrite1h).toBe(0);
    });
  });

  describe('cost and duration extraction', () => {
    // AC-5: Cost extraction reads `cost_usd` from ResultMessage
    it('extracts cost from result message', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'result',
          cost_usd: 0.0123,
          duration_ms: 5000,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.cost).toBe(0.0123);
      expect(result.duration).toBe(5000);
    });

    it('returns zero cost when no result message present', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            usage: {},
          },
        } as AssistantMessage,
      ];

      const result = extractResult(messages);

      expect(result.cost).toBe(0);
      expect(result.duration).toBe(0);
    });
  });

  describe('message type filtering', () => {
    it('ignores system messages', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-3-5-sonnet',
        } as SystemMessage,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0.001,
          duration_ms: 100,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      expect(result.result).toBe('Response');
      expect(result.tokens.prompt).toBe(10);
    });

    it('ignores user messages', () => {
      const messages: ClaudeMessage[] = [
        {
          type: 'user',
          message: {
            content: [{ type: 'text', text: 'User input' }],
          },
        } as UserMessage,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Assistant response' }],
            usage: { input_tokens: 20, output_tokens: 10 },
          },
        } as AssistantMessage,
        {
          type: 'result',
          cost_usd: 0.002,
          duration_ms: 200,
          is_error: false,
          usage: {},
        } as ResultMessage,
      ];

      const result = extractResult(messages);

      // Only assistant text extracted
      expect(result.result).toBe('Assistant response');
      expect(result.tokens.prompt).toBe(20);
    });
  });

  describe('empty stream handling', () => {
    it('handles empty message array', () => {
      const messages: ClaudeMessage[] = [];

      const result = extractResult(messages);

      expect(result.result).toBe('');
      expect(result.tokens.prompt).toBe(0);
      expect(result.tokens.cacheWrite5m).toBe(0);
      expect(result.tokens.cacheWrite1h).toBe(0);
      expect(result.tokens.cacheRead).toBe(0);
      expect(result.tokens.output).toBe(0);
      expect(result.cost).toBe(0);
      expect(result.duration).toBe(0);
      expect(result.exitCode).toBe(0);
    });
  });
});
