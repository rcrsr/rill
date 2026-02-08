import { describe, it, expect } from 'vitest';
import type {
  TokenCounts,
  TokenUsage,
  ClaudeMessage,
  SystemMessage,
  AssistantMessage,
  UserMessage,
  ResultMessage,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  ClaudeCodeConfig,
  PromptOptions,
  ClaudeCodeResult,
} from '../src/types.js';

describe('types module', () => {
  describe('TokenCounts structure', () => {
    it('has all 5 required fields', () => {
      const counts: TokenCounts = {
        prompt: 100,
        cacheWrite5m: 50,
        cacheWrite1h: 25,
        cacheRead: 75,
        output: 200,
      };

      expect(counts.prompt).toBe(100);
      expect(counts.cacheWrite5m).toBe(50);
      expect(counts.cacheWrite1h).toBe(25);
      expect(counts.cacheRead).toBe(75);
      expect(counts.output).toBe(200);
    });

    it('accepts zero-token boundary case', () => {
      const counts: TokenCounts = {
        prompt: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 0,
      };

      expect(counts.prompt).toBe(0);
      expect(counts.cacheWrite5m).toBe(0);
      expect(counts.cacheWrite1h).toBe(0);
      expect(counts.cacheRead).toBe(0);
      expect(counts.output).toBe(0);
    });

    it('enforces readonly properties at compile time', () => {
      const counts: TokenCounts = {
        prompt: 100,
        cacheWrite5m: 50,
        cacheWrite1h: 25,
        cacheRead: 75,
        output: 200,
      };

      // TypeScript compilation enforces readonly (compile-time check only)
      // @ts-expect-error - readonly property cannot be assigned
      counts.prompt = 999;

      // Test passes if TypeScript compilation succeeds (readonly enforced)
      expect(counts).toBeDefined();
    });
  });

  describe('TokenUsage structure', () => {
    it('maps to TokenCounts fields', () => {
      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 75,
        cache_creation: {
          ephemeral_5m_input_tokens: 50,
          ephemeral_1h_input_tokens: 25,
        },
      };

      expect(usage.input_tokens).toBe(100);
      expect(usage.output_tokens).toBe(200);
      expect(usage.cache_read_input_tokens).toBe(75);
      expect(usage.cache_creation?.ephemeral_5m_input_tokens).toBe(50);
      expect(usage.cache_creation?.ephemeral_1h_input_tokens).toBe(25);
    });

    it('allows all fields to be optional', () => {
      const usage: TokenUsage = {};

      expect(usage.input_tokens).toBeUndefined();
      expect(usage.output_tokens).toBeUndefined();
      expect(usage.cache_read_input_tokens).toBeUndefined();
      expect(usage.cache_creation).toBeUndefined();
    });
  });

  describe('ContentBlock variants', () => {
    it('validates TextBlock structure', () => {
      const block: TextBlock = {
        type: 'text',
        text: 'Hello, world!',
      };

      expect(block.type).toBe('text');
      expect(block.text).toBe('Hello, world!');
    });

    it('validates ToolUseBlock structure', () => {
      const block: ToolUseBlock = {
        type: 'tool_use',
        id: 'tool_123',
        name: 'Read',
        input: { file_path: '/path/to/file' },
      };

      expect(block.type).toBe('tool_use');
      expect(block.id).toBe('tool_123');
      expect(block.name).toBe('Read');
      expect(block.input.file_path).toBe('/path/to/file');
    });

    it('validates ToolResultBlock structure', () => {
      const block: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: 'tool_123',
        content: 'File contents here',
        is_error: false,
      };

      expect(block.type).toBe('tool_result');
      expect(block.tool_use_id).toBe('tool_123');
      expect(block.content).toBe('File contents here');
      expect(block.is_error).toBe(false);
    });

    it('accepts ContentBlock union type', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'tool_123', name: 'Read', input: {} },
        { type: 'tool_result', tool_use_id: 'tool_123', content: 'Result' },
      ];

      expect(blocks).toHaveLength(3);
      expect(blocks[0]!.type).toBe('text');
      expect(blocks[1]!.type).toBe('tool_use');
      expect(blocks[2]!.type).toBe('tool_result');
    });
  });

  describe('ClaudeMessage discriminated union', () => {
    it('validates SystemMessage structure', () => {
      const message: SystemMessage = {
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-5',
        tools: [{ name: 'Read', description: 'Read a file' }],
        mcp_servers: [],
      };

      expect(message.type).toBe('system');
      expect(message.subtype).toBe('init');
      expect(message.model).toBe('claude-sonnet-4-5');
      expect(message.tools).toHaveLength(1);
    });

    it('validates AssistantMessage structure', () => {
      const message: AssistantMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Response text' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };

      expect(message.type).toBe('assistant');
      expect(message.message.content).toHaveLength(1);
      expect(message.message.usage?.input_tokens).toBe(100);
    });

    it('validates UserMessage structure', () => {
      const message: UserMessage = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_123',
              content: 'Result',
            },
          ],
        },
      };

      expect(message.type).toBe('user');
      expect(message.message.content).toHaveLength(1);
    });

    it('validates ResultMessage structure with cost_usd field', () => {
      const message: ResultMessage = {
        type: 'result',
        cost_usd: 0.0123,
        duration_ms: 5432,
        is_error: false,
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      };

      expect(message.type).toBe('result');
      expect(message.cost_usd).toBe(0.0123);
      expect(message.duration_ms).toBe(5432);
      expect(message.is_error).toBe(false);
      expect(message.usage.input_tokens).toBe(100);
    });

    it('accepts ClaudeMessage union type', () => {
      const messages: ClaudeMessage[] = [
        { type: 'system', subtype: 'init', model: 'claude-sonnet-4-5' },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hi' }] },
        },
        { type: 'user', message: { content: [] } },
        {
          type: 'result',
          cost_usd: 0.01,
          duration_ms: 1000,
          is_error: false,
          usage: {},
        },
      ];

      expect(messages).toHaveLength(4);
      expect(messages[0]!.type).toBe('system');
      expect(messages[1]!.type).toBe('assistant');
      expect(messages[2]!.type).toBe('user');
      expect(messages[3]!.type).toBe('result');
    });

    it('discriminates on type field', () => {
      const message: ClaudeMessage = {
        type: 'result',
        cost_usd: 0.01,
        duration_ms: 1000,
        is_error: false,
        usage: {},
      };

      if (message.type === 'result') {
        // TypeScript narrows to ResultMessage
        expect(message.cost_usd).toBe(0.01);
        expect(message.duration_ms).toBe(1000);
      }
    });
  });

  describe('ClaudeCodeConfig structure', () => {
    it('validates config with all fields', () => {
      const config: ClaudeCodeConfig = {
        binaryPath: '/usr/local/bin/claude',
        defaultTimeout: 60000,
      };

      expect(config.binaryPath).toBe('/usr/local/bin/claude');
      expect(config.defaultTimeout).toBe(60000);
    });

    it('accepts empty config', () => {
      const config: ClaudeCodeConfig = {};

      expect(config.binaryPath).toBeUndefined();
      expect(config.defaultTimeout).toBeUndefined();
    });

    it('accepts config with only binaryPath', () => {
      const config: ClaudeCodeConfig = {
        binaryPath: 'claude',
      };

      expect(config.binaryPath).toBe('claude');
      expect(config.defaultTimeout).toBeUndefined();
    });
  });

  describe('PromptOptions structure', () => {
    it('validates options with timeout', () => {
      const options: PromptOptions = {
        timeout: 30000,
      };

      expect(options.timeout).toBe(30000);
    });

    it('accepts empty options', () => {
      const options: PromptOptions = {};

      expect(options.timeout).toBeUndefined();
    });
  });

  describe('ClaudeCodeResult structure', () => {
    it('validates complete result structure', () => {
      const result: ClaudeCodeResult = {
        result: 'Combined assistant response',
        tokens: {
          prompt: 100,
          cacheWrite5m: 50,
          cacheWrite1h: 25,
          cacheRead: 75,
          output: 200,
        },
        cost: 0.0123,
        exitCode: 0,
        duration: 5432,
      };

      expect(result.result).toBe('Combined assistant response');
      expect(result.tokens.prompt).toBe(100);
      expect(result.cost).toBe(0.0123);
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(5432);
    });

    it('validates error result with non-zero exit code', () => {
      const result: ClaudeCodeResult = {
        result: '',
        tokens: {
          prompt: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 0,
        },
        cost: 0,
        exitCode: 1,
        duration: 100,
      };

      expect(result.exitCode).toBe(1);
      expect(result.result).toBe('');
    });

    it('enforces readonly properties at compile time', () => {
      const result: ClaudeCodeResult = {
        result: 'Text',
        tokens: {
          prompt: 100,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 50,
        },
        cost: 0.01,
        exitCode: 0,
        duration: 1000,
      };

      // TypeScript compilation enforces readonly (compile-time check only)
      // @ts-expect-error - readonly property cannot be assigned
      result.cost = 0.99;

      // Test passes if TypeScript compilation succeeds (readonly enforced)
      expect(result).toBeDefined();
    });
  });
});
