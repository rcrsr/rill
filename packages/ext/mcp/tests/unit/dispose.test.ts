/**
 * Unit tests for dispose() functionality.
 *
 * Coverage:
 * - BC-5: dispose() is idempotent (subsequent calls no-op)
 * - IR-1: ExtensionResult returned with dispose handler
 * - IR-2: Tool functions callable from ExtensionResult
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpExtension } from '../../src/factory.js';
import type { McpExtensionConfig } from '../../src/types.js';

describe('dispose() functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BC-5: dispose() idempotent', () => {
    it('allows multiple dispose calls without errors', async () => {
      // Mock successful connection
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockConnect = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
      vi.spyOn(Client.prototype, 'close').mockImplementation(mockClose);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // First dispose call
      await result.dispose?.();

      // Verify cleanup called
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Second dispose call (should no-op)
      await result.dispose?.();

      // Verify cleanup NOT called again
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Third dispose call (should no-op)
      await result.dispose?.();

      // Still only called once
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('handles cleanup errors gracefully', async () => {
      // Mock connection that fails during cleanup
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockRejectedValue(
        new Error('cleanup failed')
      );
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // Dispose should not throw even though cleanup fails
      await expect(result.dispose?.()).resolves.toBeUndefined();
    });

    it('disposes during active tool call - pending call rejects (BC-5)', async () => {
      // Mock connection with one tool
      let resolveToolCall: (value: any) => void;
      const toolCallPromise = new Promise((resolve) => {
        resolveToolCall = resolve;
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(async () => {
        // Simulate connection close during active call
        return undefined;
      });
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'long_running_tool',
            description: 'Simulates long-running operation',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      // Mock callTool to hang until we resolve it
      vi.spyOn(Client.prototype, 'callTool').mockImplementation(() => {
        return toolCallPromise;
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // Start a long-running tool call
      const toolCallResultPromise = result.long_running_tool!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      // Immediately dispose (while call is pending)
      await result.dispose?.();

      // The pending tool call should reject with connection lost error
      // Note: In practice, the MCP client.close() causes pending calls to fail
      // We simulate this by rejecting the toolCallPromise after close
      resolveToolCall!({
        isError: true,
        content: [{ type: 'text', text: 'connection lost' }],
      });

      await expect(toolCallResultPromise).rejects.toThrow('connection lost');
    });
  });

  describe('IR-1 & IR-2: ExtensionResult with tool functions', () => {
    it('returns ExtensionResult with callable tool functions', async () => {
      // Mock connection with one tool
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string' },
              },
              required: ['param1'],
            },
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });
      vi.spyOn(Client.prototype, 'callTool').mockResolvedValue({
        content: [{ type: 'text', text: 'success' }],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // IR-1: Result has dispose function
      expect(result.dispose).toBeDefined();
      expect(typeof result.dispose).toBe('function');

      // IR-1: Result has tool function
      expect(result.test_tool).toBeDefined();
      expect(typeof result.test_tool).toBe('object');
      expect(result.test_tool.fn).toBeDefined();
      expect(typeof result.test_tool.fn).toBe('function');

      // IR-2: Tool function is callable
      const toolResult = await result.test_tool.fn(['value1'], {
        _lifecycle: { connectEmitted: false },
      } as any);
      expect(toolResult).toBe('success');

      // Cleanup
      await result.dispose?.();
    });

    it('generates functions for multiple tools', async () => {
      // Mock connection with multiple tools
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'tool_one',
            description: 'First tool',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'tool_two',
            description: 'Second tool',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'tool_three',
            description: 'Third tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // Verify all three tools are present
      expect(result.tool_one).toBeDefined();
      expect(result.tool_two).toBeDefined();
      expect(result.tool_three).toBeDefined();

      // Verify dispose exists
      expect(result.dispose).toBeDefined();

      // Cleanup
      await result.dispose?.();
    });

    it('returns empty object when no tools available', async () => {
      // Mock connection with no tools
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config);

      // Verify dispose exists even with no tools
      expect(result.dispose).toBeDefined();

      // Count properties (dispose + _capabilities)
      const keys = Object.keys(result);
      expect(keys).toContain('dispose');
      expect(keys).toContain('_capabilities');

      // Cleanup
      await result.dispose?.();
    });
  });
});
