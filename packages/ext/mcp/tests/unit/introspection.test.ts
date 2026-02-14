/**
 * Unit tests for introspection function generation.
 *
 * Tests cover:
 * - IR-6: list_tools returns list of tool dicts
 * - IR-7: list_resources returns list of resource dicts
 * - IR-8: list_prompts returns list of prompt dicts
 * - BC-1: Empty capability lists return empty lists
 * - Optional fields default to empty string
 * - Lists ALL capabilities regardless of filters
 */

import { describe, it, expect } from 'vitest';
import {
  createIntrospectionFunctions,
  type McpTool,
  type McpResource,
  type McpPrompt,
} from '../../src/introspection.js';
import type { RillValue } from '@rcrsr/rill';

describe('createIntrospectionFunctions', () => {
  describe('list_tools', () => {
    it('returns list of tool dicts with name and description [IR-6]', async () => {
      // Arrange
      const tools: McpTool[] = [
        { name: 'echo', description: 'Echo tool' },
        { name: 'calculator', description: 'Perform calculations' },
      ];

      // Act
      const functions = createIntrospectionFunctions(tools, [], [], []);
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'echo', description: 'Echo tool' });
      expect(result[1]).toEqual({
        name: 'calculator',
        description: 'Perform calculations',
      });
    });

    it('defaults missing description to empty string', async () => {
      // Arrange
      const tools: McpTool[] = [{ name: 'echo' }];

      // Act
      const functions = createIntrospectionFunctions(tools, [], [], []);
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert
      expect(result[0]).toEqual({ name: 'echo', description: '' });
    });

    it('returns empty list for zero tools [BC-1]', async () => {
      // Arrange
      const tools: McpTool[] = [];

      // Act
      const functions = createIntrospectionFunctions(tools, [], [], []);
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert
      expect(result).toEqual([]);
    });

    it('has correct function metadata', () => {
      // Arrange
      const functions = createIntrospectionFunctions([], [], [], []);

      // Assert
      expect(functions.list_tools.params).toEqual([]);
      expect(functions.list_tools.description).toBe(
        'List all available tools from MCP server'
      );
      expect(functions.list_tools.returnType).toBe('list');
    });
  });

  describe('list_resources', () => {
    it('returns list of resource dicts with uri, name, description, mime [IR-7]', async () => {
      // Arrange
      const resources: McpResource[] = [
        {
          uri: 'file://test.txt',
          name: 'test',
          description: 'Test file',
          mimeType: 'text/plain',
        },
        {
          uri: 'db://users/1',
          name: 'user1',
          description: 'User record',
          mimeType: 'application/json',
        },
      ];

      // Act
      const functions = createIntrospectionFunctions([], resources, [], []);
      const result = (await functions.list_resources.fn([])) as RillValue[];

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        uri: 'file://test.txt',
        name: 'test',
        description: 'Test file',
        mime: 'text/plain',
      });
      expect(result[1]).toEqual({
        uri: 'db://users/1',
        name: 'user1',
        description: 'User record',
        mime: 'application/json',
      });
    });

    it('defaults missing optional fields to empty string', async () => {
      // Arrange
      const resources: McpResource[] = [
        {
          uri: 'file://test.txt',
          name: 'test',
        },
      ];

      // Act
      const functions = createIntrospectionFunctions([], resources, [], []);
      const result = (await functions.list_resources.fn([])) as RillValue[];

      // Assert
      expect(result[0]).toEqual({
        uri: 'file://test.txt',
        name: 'test',
        description: '',
        mime: '',
      });
    });

    it('returns empty list for zero resources [BC-1]', async () => {
      // Arrange
      const resources: McpResource[] = [];

      // Act
      const functions = createIntrospectionFunctions([], resources, [], []);
      const result = (await functions.list_resources.fn([])) as RillValue[];

      // Assert
      expect(result).toEqual([]);
    });

    it('has correct function metadata', () => {
      // Arrange
      const functions = createIntrospectionFunctions([], [], [], []);

      // Assert
      expect(functions.list_resources.params).toEqual([]);
      expect(functions.list_resources.description).toBe(
        'List all available resources from MCP server'
      );
      expect(functions.list_resources.returnType).toBe('list');
    });
  });

  describe('list_prompts', () => {
    it('returns list of prompt dicts with name, description, arguments [IR-8]', async () => {
      // Arrange
      const prompts: McpPrompt[] = [
        {
          name: 'greet',
          description: 'Greeting prompt',
          arguments: [{ name: 'name' }, { name: 'language' }],
        },
        {
          name: 'summarize',
          description: 'Text summarization',
          arguments: [{ name: 'text' }],
        },
      ];

      // Act
      const functions = createIntrospectionFunctions([], [], [], prompts);
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'greet',
        description: 'Greeting prompt',
        arguments: ['name', 'language'],
      });
      expect(result[1]).toEqual({
        name: 'summarize',
        description: 'Text summarization',
        arguments: ['text'],
      });
    });

    it('defaults missing optional fields to empty string and empty list', async () => {
      // Arrange
      const prompts: McpPrompt[] = [{ name: 'simple' }];

      // Act
      const functions = createIntrospectionFunctions([], [], [], prompts);
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert
      expect(result[0]).toEqual({
        name: 'simple',
        description: '',
        arguments: [],
      });
    });

    it('handles prompts with no arguments', async () => {
      // Arrange
      const prompts: McpPrompt[] = [
        {
          name: 'static',
          description: 'Static prompt',
          arguments: [],
        },
      ];

      // Act
      const functions = createIntrospectionFunctions([], [], [], prompts);
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert
      expect(result[0]).toEqual({
        name: 'static',
        description: 'Static prompt',
        arguments: [],
      });
    });

    it('returns empty list for zero prompts [BC-1]', async () => {
      // Arrange
      const prompts: McpPrompt[] = [];

      // Act
      const functions = createIntrospectionFunctions([], [], [], prompts);
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert
      expect(result).toEqual([]);
    });

    it('has correct function metadata', () => {
      // Arrange
      const functions = createIntrospectionFunctions([], [], [], []);

      // Assert
      expect(functions.list_prompts.params).toEqual([]);
      expect(functions.list_prompts.description).toBe(
        'List all available prompts from MCP server'
      );
      expect(functions.list_prompts.returnType).toBe('list');
    });
  });

  describe('static data (factory time)', () => {
    it('returns same data on multiple invocations (static)', async () => {
      // Arrange
      const tools: McpTool[] = [{ name: 'echo', description: 'Echo tool' }];
      const functions = createIntrospectionFunctions(tools, [], [], []);

      // Act
      const result1 = (await functions.list_tools.fn([])) as RillValue[];
      const result2 = (await functions.list_tools.fn([])) as RillValue[];

      // Assert
      expect(result1).toEqual(result2);
      expect(result1).toBe(result2); // Same reference (static data)
    });
  });

  describe('BC-1: empty capability lists', () => {
    it('returns only introspection functions with empty lists', async () => {
      // Arrange
      const functions = createIntrospectionFunctions([], [], [], []);

      // Act
      const tools = (await functions.list_tools.fn([])) as RillValue[];
      const resources = (await functions.list_resources.fn([])) as RillValue[];
      const prompts = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert
      expect(Object.keys(functions)).toEqual([
        'list_tools',
        'list_resources',
        'list_prompts',
      ]);
      expect(tools).toEqual([]);
      expect(resources).toEqual([]);
      expect(prompts).toEqual([]);
    });
  });

  describe('lists ALL capabilities regardless of filters', () => {
    it('includes all tools even if filtered elsewhere', async () => {
      // Arrange
      const tools: McpTool[] = [
        { name: 'tool1', description: 'First tool' },
        { name: 'tool2', description: 'Second tool' },
        { name: 'tool3', description: 'Third tool' },
      ];

      // Act
      const functions = createIntrospectionFunctions(tools, [], [], []);
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert - all three tools returned regardless of filter settings
      expect(result).toHaveLength(3);
      expect(result.map((t) => (t as { name: string }).name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
      ]);
    });

    it('includes all resources even if filtered elsewhere', async () => {
      // Arrange
      const resources: McpResource[] = [
        { uri: 'file://a', name: 'a' },
        { uri: 'file://b', name: 'b' },
      ];

      // Act
      const functions = createIntrospectionFunctions([], resources, [], []);
      const result = (await functions.list_resources.fn([])) as RillValue[];

      // Assert - all resources returned
      expect(result).toHaveLength(2);
    });

    it('includes all prompts even if filtered elsewhere', async () => {
      // Arrange
      const prompts: McpPrompt[] = [{ name: 'prompt1' }, { name: 'prompt2' }];

      // Act
      const functions = createIntrospectionFunctions([], [], [], prompts);
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert - all prompts returned
      expect(result).toHaveLength(2);
    });
  });
});
