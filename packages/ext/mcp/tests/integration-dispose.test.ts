/**
 * Integration tests for dispose and connection lifecycle.
 *
 * Coverage:
 * - BC-5: Dispose during active call - kills process, pending call rejects
 * - BC-5: Idempotent dispose - second call is no-op
 * - BC-5: Calls after dispose throw connection lost error
 *
 * These integration tests use real MCP client/transport (mocked at SDK level)
 * to verify disposal behavior in realistic scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpExtension } from '../src/factory.js';
import type { McpExtensionConfig } from '../src/types.js';

describe('Integration: Dispose and Connection Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BC-5: Dispose during active tool call', () => {
    it('kills connection and pending call rejects with connection lost error', async () => {
      // Mock a tool that simulates a long-running operation
      let toolCallController: {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
      };
      const pendingToolCall = new Promise((resolve, reject) => {
        toolCallController = { resolve, reject };
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(async () => {
        // Simulate client.close() causing pending operations to fail
        toolCallController.reject(new Error('connection lost'));
        return undefined;
      });
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'long_operation',
            description: 'Simulates long-running operation',
            inputSchema: {
              type: 'object',
              properties: {},
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

      // Mock callTool to return the pending promise
      vi.spyOn(Client.prototype, 'callTool').mockReturnValue(
        pendingToolCall as any
      );

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config);

      // Start a long-running tool call
      const toolCallPromise = extension.long_operation!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      // Immediately dispose while the tool call is pending
      await extension.dispose?.();

      // The pending tool call should reject with connection lost error
      await expect(toolCallPromise).rejects.toThrow('connection lost');
    });

    it('handles disposal with multiple pending calls', async () => {
      // Track multiple pending operations
      const pendingCalls: Array<{
        resolve: (value: any) => void;
        reject: (reason: any) => void;
      }> = [];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(async () => {
        // Reject all pending calls when connection closes
        for (const call of pendingCalls) {
          call.reject(new Error('connection lost'));
        }
        return undefined;
      });
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

      // Mock callTool to create pending promises
      vi.spyOn(Client.prototype, 'callTool').mockImplementation(() => {
        return new Promise((resolve, reject) => {
          pendingCalls.push({ resolve, reject });
        }) as any;
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config);

      // Start multiple tool calls
      const call1 = extension.tool_one!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      const call2 = extension.tool_two!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);

      // Verify both calls are pending
      expect(pendingCalls).toHaveLength(2);

      // Dispose while both calls are pending
      await extension.dispose?.();

      // Both pending calls should reject
      await expect(call1).rejects.toThrow('connection lost');
      await expect(call2).rejects.toThrow('connection lost');
    });
  });

  describe('BC-5: Idempotent dispose', () => {
    it('second dispose call is no-op', async () => {
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

      const extension = await createMcpExtension(config);

      // First dispose
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Second dispose - should be no-op
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Third dispose - should be no-op
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('handles errors during first dispose without affecting idempotency', async () => {
      let disposeAttempts = 0;
      const mockClose = vi.fn().mockImplementation(async () => {
        disposeAttempts++;
        if (disposeAttempts === 1) {
          throw new Error('disposal failed');
        }
        return undefined;
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
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

      const extension = await createMcpExtension(config);

      // First dispose throws error (swallowed)
      await expect(extension.dispose?.()).resolves.toBeUndefined();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Second dispose should still be no-op (idempotency maintained)
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('BC-5: Calls after dispose throw connection lost error', () => {
    it('tool calls after dispose throw connection lost error', async () => {
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
                param: { type: 'string' },
              },
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

      // Mock callTool to fail after disposal
      const mockCallTool = vi
        .spyOn(Client.prototype, 'callTool')
        .mockResolvedValue({
          content: [{ type: 'text', text: 'success' }],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config);

      // Tool call before dispose works
      const resultBefore = await extension.test_tool!.fn(['value'], {
        _lifecycle: { connectEmitted: false },
      } as any);
      expect(resultBefore).toBe('success');
      expect(mockCallTool).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Mock callTool to throw after disposal (connection closed)
      mockCallTool.mockRejectedValue(new Error('connection closed'));

      // Tool call after dispose should throw connection lost error
      await expect(
        extension.test_tool!.fn(['value'], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('mcp: connection lost');
    });

    it('resource reads after dispose throw connection lost error', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          {
            uri: 'test://resource',
            name: 'Test Resource',
            mimeType: 'text/plain',
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const mockReadResource = vi
        .spyOn(Client.prototype, 'readResource')
        .mockResolvedValue({
          contents: [{ uri: 'test://resource', text: 'content' }],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config);

      // Resource read before dispose works
      const resultBefore = await extension.read_resource!.fn(
        ['test://resource'],
        {
          _lifecycle: { connectEmitted: false },
        } as any
      );
      expect(resultBefore).toBe('content');
      expect(mockReadResource).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Mock readResource to throw after disposal (connection lost)
      mockReadResource.mockRejectedValue(new Error('connection lost'));

      // Resource read after dispose should throw
      await expect(
        extension.read_resource!.fn(['test://resource'], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('mcp: connection lost');
    });

    it('prompt calls after dispose throw connection lost error', async () => {
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
        prompts: [
          {
            name: 'test',
            description: 'Test prompt',
            arguments: [],
          },
        ],
      });

      const mockGetPrompt = vi
        .spyOn(Client.prototype, 'getPrompt')
        .mockResolvedValue({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'prompt text' },
            },
          ],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config);

      // Prompt call before dispose works (note: prompts are prefixed with "prompt_")
      const resultBefore = await extension.prompt_test!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      // Prompt returns list of dicts with role and content
      expect(resultBefore).toEqual([{ role: 'user', content: 'prompt text' }]);
      expect(mockGetPrompt).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Mock getPrompt to throw after disposal (connection lost)
      mockGetPrompt.mockRejectedValue(new Error('connection lost'));

      // Prompt call after dispose should throw
      await expect(
        extension.prompt_test!.fn([], {
          _lifecycle: { connectEmitted: false },
        } as any)
      ).rejects.toThrow('mcp: connection lost');
    });
  });

  describe('Integration: Real connection lifecycle', () => {
    it('completes full lifecycle: connect -> use -> dispose', async () => {
      const mockConnect = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockCallTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
      });

      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
      vi.spyOn(Client.prototype, 'close').mockImplementation(mockClose);
      vi.spyOn(Client.prototype, 'callTool').mockImplementation(mockCallTool);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'my_tool',
            description: 'Test',
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

      // Connect
      const extension = await createMcpExtension(config);
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Use
      const result = await extension.my_tool!.fn([], {
        _lifecycle: { connectEmitted: false },
      } as any);
      expect(result).toBe('result');
      expect(mockCallTool).toHaveBeenCalledTimes(1);

      // Dispose
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
