/**
 * End-to-end tests for filtered capabilities.
 *
 * Coverage:
 * - BC-7: Server with 10 tools, filter to 2, verify only 2 functions generated
 * - BC-7: Introspection lists all 10 despite filter
 * - AC-5: Name collision with filter (_2 suffix)
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

describe('Filtered Capabilities End-to-End', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BC-7: Filtered tool function generation', () => {
    it('generates only filtered tool functions while introspection lists all', async () => {
      // Arrange - Mock server with 10 tools
      const allTools = Array.from({ length: 10 }, (_, i) => ({
        name: `tool${i + 1}`,
        description: `Tool ${i + 1}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['tool1', 'tool2'], // Filter to only 2 tools
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - Only 2 tool functions generated (tool1, tool2)
      expect(result.tool1).toBeDefined();
      expect(result.tool2).toBeDefined();

      // Other tools NOT generated as functions
      expect(result.tool3).toBeUndefined();
      expect(result.tool4).toBeUndefined();
      expect(result.tool5).toBeUndefined();
      expect(result.tool6).toBeUndefined();
      expect(result.tool7).toBeUndefined();
      expect(result.tool8).toBeUndefined();
      expect(result.tool9).toBeUndefined();
      expect(result.tool10).toBeUndefined();

      // Assert - Introspection lists all 10 tools
      expect(result.list_tools).toBeDefined();
      const allToolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(allToolsList).toHaveLength(10);
      expect(allToolsList.map((t) => t.name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
        'tool4',
        'tool5',
        'tool6',
        'tool7',
        'tool8',
        'tool9',
        'tool10',
      ]);
    });

    it('generates all functions when no filter specified', async () => {
      // Arrange - Mock server with 5 tools, no filter
      const allTools = Array.from({ length: 5 }, (_, i) => ({
        name: `tool${i + 1}`,
        description: `Tool ${i + 1}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        // No toolFilter - all tools should be included
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - All 5 tool functions generated
      expect(result.tool1).toBeDefined();
      expect(result.tool2).toBeDefined();
      expect(result.tool3).toBeDefined();
      expect(result.tool4).toBeDefined();
      expect(result.tool5).toBeDefined();

      // Assert - Introspection lists all 5 tools
      const allToolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(allToolsList).toHaveLength(5);
    });

    it('generates no functions when filter matches no tools', async () => {
      // Arrange - Mock server with 3 tools, filter matches none
      const allTools = [
        { name: 'tool1', description: 'Tool 1', inputSchema: {} },
        { name: 'tool2', description: 'Tool 2', inputSchema: {} },
        { name: 'tool3', description: 'Tool 3', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['nonexistent-tool'], // No matches
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - No tool functions generated
      expect(result.tool1).toBeUndefined();
      expect(result.tool2).toBeUndefined();
      expect(result.tool3).toBeUndefined();

      // Assert - Introspection still lists all 3 tools
      const allToolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(allToolsList).toHaveLength(3);
      expect(allToolsList.map((t) => t.name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
      ]);
    });
  });

  describe('AC-5: Name collision with filter', () => {
    it('applies _2 suffix to colliding names within filtered set', async () => {
      // Arrange - Mock server with colliding tool names
      const allTools = [
        { name: 'read-file', description: 'Read file tool', inputSchema: {} },
        { name: 'readFile', description: 'Read file alt', inputSchema: {} },
        { name: 'other-tool', description: 'Other tool', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['read-file', 'readFile'], // Both collide to read_file
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - First collision gets base name, second gets _2 suffix
      expect(result.read_file).toBeDefined();
      expect(result.read_file_2).toBeDefined();

      // Assert - Other tool not included (not in filter)
      expect(result.other_tool).toBeUndefined();

      // Assert - Introspection lists all 3 tools
      const allToolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(allToolsList).toHaveLength(3);
      expect(allToolsList.map((t) => t.name)).toEqual([
        'read-file',
        'readFile',
        'other-tool',
      ]);
    });

    it('handles three-way collision in filtered set', async () => {
      // Arrange - Three tools that collide when sanitized
      const allTools = [
        { name: 'fetch-data', description: 'Fetch 1', inputSchema: {} },
        { name: 'fetchData', description: 'Fetch 2', inputSchema: {} },
        { name: 'fetch.data', description: 'Fetch 3', inputSchema: {} },
        { name: 'other-tool', description: 'Other', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['fetch-data', 'fetchData', 'fetch.data'], // All collide
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - Three functions with collision numbering
      expect(result.fetch_data).toBeDefined();
      expect(result.fetch_data_2).toBeDefined();
      expect(result.fetch_data_3).toBeDefined();

      // Assert - Other tool not included
      expect(result.other_tool).toBeUndefined();

      // Assert - Introspection lists all 4 tools
      const allToolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(allToolsList).toHaveLength(4);
    });

    it('collision numbering independent when different tools filtered', async () => {
      // Arrange - Same colliding names but only one in filter
      const allTools = [
        { name: 'read-file', description: 'Read file tool', inputSchema: {} },
        { name: 'readFile', description: 'Read file alt', inputSchema: {} },
        { name: 'other-tool', description: 'Other tool', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['read-file', 'other-tool'], // Only first of collision pair
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - No collision, no _2 suffix needed
      expect(result.read_file).toBeDefined();
      expect(result.other_tool).toBeDefined();
      expect(result.read_file_2).toBeUndefined(); // Second not included in filter
    });
  });

  describe('Integration with other capability types', () => {
    it('filters tools while leaving resources and prompts unfiltered', async () => {
      // Arrange - Multiple capability types
      const allTools = [
        { name: 'tool1', inputSchema: {} },
        { name: 'tool2', inputSchema: {} },
        { name: 'tool3', inputSchema: {} },
      ];
      const allResources = [
        { uri: 'file://resource1', name: 'Resource 1' },
        { uri: 'file://resource2', name: 'Resource 2' },
      ];
      const allPrompts = [
        { name: 'prompt1', description: 'Prompt 1' },
        { name: 'prompt2', description: 'Prompt 2' },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: allResources,
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: allPrompts,
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-server',
        },
        toolFilter: ['tool1'], // Only filter tools
        // No resource or prompt filters
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - Only tool1 function generated
      expect(result.tool1).toBeDefined();
      expect(result.tool2).toBeUndefined();
      expect(result.tool3).toBeUndefined();

      // Assert - read_resource function exists (not filtered)
      expect(result.read_resource).toBeDefined();

      // Assert - Prompt functions generated for all prompts (not filtered)
      expect(result.prompt_prompt1).toBeDefined();
      expect(result.prompt_prompt2).toBeDefined();

      // Assert - Introspection lists all capabilities
      const toolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(toolsList).toHaveLength(3);

      const resourcesList = (await result.list_resources.fn([])) as Array<{
        uri: string;
      }>;
      expect(resourcesList).toHaveLength(2);

      const promptsList = (await result.list_prompts.fn([])) as Array<{
        name: string;
      }>;
      expect(promptsList).toHaveLength(2);
    });

    it('applies filters to all capability types independently', async () => {
      // Arrange - All capability types with filters
      const allTools = [
        { name: 'tool1', inputSchema: {} },
        { name: 'tool2', inputSchema: {} },
      ];
      const allResources = [
        { uri: 'file://resource1', name: 'Resource 1' },
        { uri: 'file://resource2', name: 'Resource 2' },
      ];
      const allPrompts = [
        { name: 'prompt1', description: 'Prompt 1' },
        { name: 'prompt2', description: 'Prompt 2' },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: allResources,
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: allPrompts,
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-server',
        },
        toolFilter: ['tool1'],
        resourceFilter: ['file://resource2'],
        promptFilter: ['prompt1'],
      };

      // Act
      const result = await createMcpExtension(config);

      // Assert - Only filtered functions generated
      expect(result.tool1).toBeDefined();
      expect(result.tool2).toBeUndefined();

      expect(result.prompt_prompt1).toBeDefined();
      expect(result.prompt_prompt2).toBeUndefined();

      // Assert - read_resource exists (resource filter doesn't affect its existence)
      expect(result.read_resource).toBeDefined();

      // Assert - Introspection lists ALL capabilities despite filters
      const toolsList = (await result.list_tools.fn([])) as Array<{
        name: string;
      }>;
      expect(toolsList).toHaveLength(2);

      const resourcesList = (await result.list_resources.fn([])) as Array<{
        uri: string;
      }>;
      expect(resourcesList).toHaveLength(2);

      const promptsList = (await result.list_prompts.fn([])) as Array<{
        name: string;
      }>;
      expect(promptsList).toHaveLength(2);
    });
  });
});
