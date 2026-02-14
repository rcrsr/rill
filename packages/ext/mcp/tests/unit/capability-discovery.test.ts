/**
 * Unit tests for capability discovery.
 *
 * Coverage:
 * - IR-1: Parallel listTools, listResources, listPrompts
 * - BC-7: Filtered capabilities
 * - BC-7: Introspection lists all capabilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpExtensionConfig } from '../../src/types.js';

// Mock the SDK transports to avoid actual process spawning
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioTransport {
    onerror: ((error: Error) => void) | undefined = undefined;
    start = vi.fn();
    close = vi.fn();
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockHTTPTransport {
    onerror: ((error: Error) => void) | undefined = undefined;
    start = vi.fn();
    close = vi.fn();
    constructor(_url: URL, _options?: unknown) {
      // Mock constructor
    }
  },
}));

// Import factory after mocks are set up
const { createMcpExtension } = await import('../../src/factory.js');

describe('Capability Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('IR-1: Parallel capability discovery', () => {
    it('calls listTools, listResources, listResourceTemplates, listPrompts in parallel', async () => {
      // Mock Client methods
      const mockListTools = vi.fn().mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'Tool 1', inputSchema: {} },
          { name: 'tool2', description: 'Tool 2', inputSchema: {} },
        ],
      });
      const mockListResources = vi.fn().mockResolvedValue({
        resources: [
          {
            uri: 'file://resource1',
            name: 'Resource 1',
            description: 'Desc 1',
          },
        ],
      });
      const mockListResourceTemplates = vi.fn().mockResolvedValue({
        resourceTemplates: [
          {
            uriTemplate: 'file://{path}',
            name: 'Template 1',
            description: 'Template Desc 1',
          },
        ],
      });
      const mockListPrompts = vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt1', description: 'Prompt 1', arguments: [] }],
      });
      const mockConnect = vi.fn().mockResolvedValue(undefined);

      // Spy on Client constructor to inject mocks
      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
      vi.spyOn(Client.prototype, 'listTools').mockImplementation(mockListTools);
      vi.spyOn(Client.prototype, 'listResources').mockImplementation(
        mockListResources
      );
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockImplementation(
        mockListResourceTemplates
      );
      vi.spyOn(Client.prototype, 'listPrompts').mockImplementation(
        mockListPrompts
      );

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
      };

      const result = await createMcpExtension(config);

      // Verify all four list methods were called
      expect(mockListTools).toHaveBeenCalledTimes(1);
      expect(mockListResources).toHaveBeenCalledTimes(1);
      expect(mockListResourceTemplates).toHaveBeenCalledTimes(1);
      expect(mockListPrompts).toHaveBeenCalledTimes(1);

      // Verify capabilities are stored (temporary for testing)
      expect(result).toHaveProperty('_capabilities');
      const caps = (result as any)._capabilities;
      expect(caps.allTools).toHaveLength(2);
      expect(caps.allResources).toHaveLength(1);
      expect(caps.allResourceTemplates).toHaveLength(1);
      expect(caps.allPrompts).toHaveLength(1);
    });

    it('handles empty capability lists', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
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
          command: 'mock-command',
        },
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      expect(caps.allTools).toHaveLength(0);
      expect(caps.allResources).toHaveLength(0);
      expect(caps.allResourceTemplates).toHaveLength(0);
      expect(caps.allPrompts).toHaveLength(0);
      expect(caps.filteredTools).toHaveLength(0);
      expect(caps.filteredResources).toHaveLength(0);
      expect(caps.filteredResourceTemplates).toHaveLength(0);
      expect(caps.filteredPrompts).toHaveLength(0);
    });
  });

  describe('BC-7: Filtered capabilities', () => {
    it('filters tools by exact name match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'Tool 1', inputSchema: {} },
          { name: 'tool2', description: 'Tool 2', inputSchema: {} },
          { name: 'tool3', description: 'Tool 3', inputSchema: {} },
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
          command: 'mock-command',
        },
        toolFilter: ['tool1', 'tool3'], // Only include tool1 and tool3
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      // All tools stored for introspection
      expect(caps.allTools).toHaveLength(3);
      expect(caps.allTools.map((t: any) => t.name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
      ]);

      // Only filtered tools used for function generation
      expect(caps.filteredTools).toHaveLength(2);
      expect(caps.filteredTools.map((t: any) => t.name)).toEqual([
        'tool1',
        'tool3',
      ]);
    });

    it('filters resources by exact URI match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          { uri: 'file://resource1', name: 'Resource 1' },
          { uri: 'file://resource2', name: 'Resource 2' },
          { uri: 'http://resource3', name: 'Resource 3' },
        ],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        resourceFilter: ['file://resource1', 'http://resource3'],
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      expect(caps.allResources).toHaveLength(3);
      expect(caps.filteredResources).toHaveLength(2);
      expect(caps.filteredResources.map((r: any) => r.uri)).toEqual([
        'file://resource1',
        'http://resource3',
      ]);
    });

    it('filters prompts by exact name match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [
          { name: 'prompt1', description: 'Prompt 1' },
          { name: 'prompt2', description: 'Prompt 2' },
          { name: 'prompt3', description: 'Prompt 3' },
          { name: 'prompt4', description: 'Prompt 4' },
        ],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        promptFilter: ['prompt2', 'prompt4'],
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      expect(caps.allPrompts).toHaveLength(4);
      expect(caps.filteredPrompts).toHaveLength(2);
      expect(caps.filteredPrompts.map((p: any) => p.name)).toEqual([
        'prompt2',
        'prompt4',
      ]);
    });

    it('empty filter includes all capabilities', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [{ uri: 'file://resource1', name: 'Resource 1' }],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [{ name: 'prompt1' }],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        toolFilter: [], // Empty = all
        resourceFilter: [], // Empty = all
        promptFilter: [], // Empty = all
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      // All capabilities included when filter is empty
      expect(caps.filteredTools).toHaveLength(2);
      expect(caps.filteredResources).toHaveLength(1);
      expect(caps.filteredPrompts).toHaveLength(1);
    });

    it('undefined filter includes all capabilities', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [{ uri: 'file://resource1', name: 'Resource 1' }],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [{ name: 'prompt1' }],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        // No filters = all included
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      expect(caps.filteredTools).toHaveLength(2);
      expect(caps.filteredResources).toHaveLength(1);
      expect(caps.filteredPrompts).toHaveLength(1);
    });

    it('non-matching filter results in empty filtered list', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [{ name: 'tool1', inputSchema: {} }],
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
          command: 'mock-command',
        },
        toolFilter: ['nonexistent-tool'],
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      // All tools still stored for introspection
      expect(caps.allTools).toHaveLength(1);
      // But filtered list is empty
      expect(caps.filteredTools).toHaveLength(0);
    });
  });

  describe('BC-7: Introspection lists all capabilities', () => {
    it('stores unfiltered lists for introspection regardless of filter', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: Array.from({ length: 100 }, (_, i) => ({
          name: `tool${i + 1}`,
          inputSchema: {},
        })),
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
          command: 'mock-command',
        },
        toolFilter: ['tool1', 'tool2'], // Only 2 tools filtered
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      // Introspection has all 100 tools
      expect(caps.allTools).toHaveLength(100);

      // But only 2 tools filtered for function generation
      expect(caps.filteredTools).toHaveLength(2);
      expect(caps.filteredTools.map((t: any) => t.name)).toEqual([
        'tool1',
        'tool2',
      ]);
    });

    it('maintains separate filtered and unfiltered lists for all capability types', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
          { name: 'tool3', inputSchema: {} },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          { uri: 'res1', name: 'Resource 1' },
          { uri: 'res2', name: 'Resource 2' },
        ],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [
          { name: 'p1' },
          { name: 'p2' },
          { name: 'p3' },
          { name: 'p4' },
        ],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        toolFilter: ['tool1'],
        resourceFilter: ['res2'],
        promptFilter: ['p1', 'p3'],
      };

      const result = await createMcpExtension(config);
      const caps = (result as any)._capabilities;

      // Unfiltered lists
      expect(caps.allTools).toHaveLength(3);
      expect(caps.allResources).toHaveLength(2);
      expect(caps.allPrompts).toHaveLength(4);

      // Filtered lists
      expect(caps.filteredTools).toHaveLength(1);
      expect(caps.filteredResources).toHaveLength(1);
      expect(caps.filteredPrompts).toHaveLength(2);
    });
  });
});
