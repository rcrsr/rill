/**
 * Integration tests for introspection functions in factory.
 *
 * Verifies that introspection functions are properly generated and included
 * in extension result alongside tool/resource/prompt functions.
 *
 * These tests verify the static data returned by introspection functions
 * using the _capabilities test interface exposed by factory.
 */

import { describe, it, expect } from 'vitest';
import { createIntrospectionFunctions } from '../../src/introspection.js';
import type { RillValue } from '@rcrsr/rill';

describe('introspection integration', () => {
  describe('factory integration', () => {
    it('generates list_tools, list_resources, list_prompts functions', () => {
      // Arrange
      const tools = [
        { name: 'echo', description: 'Echo tool' },
        { name: 'calc', description: 'Calculator' },
      ];
      const resources = [
        {
          uri: 'file://test',
          name: 'test',
          description: 'Test',
          mimeType: 'text/plain',
        },
      ];
      const prompts = [
        { name: 'greet', description: 'Greeting', arguments: [{ name: 'n' }] },
      ];

      // Act
      const functions = createIntrospectionFunctions(
        tools,
        resources,
        [],
        prompts
      );

      // Assert - all three functions exist
      expect(functions.list_tools).toBeDefined();
      expect(functions.list_resources).toBeDefined();
      expect(functions.list_prompts).toBeDefined();

      // Assert - function metadata
      expect(functions.list_tools.params).toEqual([]);
      expect(functions.list_tools.returnType).toBe('list');
      expect(functions.list_resources.params).toEqual([]);
      expect(functions.list_resources.returnType).toBe('list');
      expect(functions.list_prompts.params).toEqual([]);
      expect(functions.list_prompts.returnType).toBe('list');
    });

    it('list_tools returns all tools regardless of filters', async () => {
      // Arrange - simulate filter scenario where factory would filter tools
      const allTools = [
        { name: 'tool1', description: 'First' },
        { name: 'tool2', description: 'Second' },
        { name: 'tool3', description: 'Third' },
      ];
      // In real factory, toolFilter would limit which tool functions are generated
      // But introspection uses allTools, not filteredTools
      const functions = createIntrospectionFunctions(allTools, [], [], []);

      // Act
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert - all tools returned (not filtered)
      expect(result).toHaveLength(3);
      expect(result.map((t) => (t as { name: string }).name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
      ]);
    });

    it('list_resources returns all resources regardless of filters', async () => {
      // Arrange
      const allResources = [
        { uri: 'file://a', name: 'a', description: '', mimeType: '' },
        { uri: 'file://b', name: 'b', description: '', mimeType: '' },
      ];
      const functions = createIntrospectionFunctions([], allResources, [], []);

      // Act
      const result = (await functions.list_resources.fn([])) as RillValue[];

      // Assert - all resources returned
      expect(result).toHaveLength(2);
    });

    it('list_prompts returns all prompts regardless of filters', async () => {
      // Arrange
      const allPrompts = [
        { name: 'prompt1', description: '' },
        { name: 'prompt2', description: '' },
      ];
      const functions = createIntrospectionFunctions([], [], [], allPrompts);

      // Act
      const result = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert - all prompts returned
      expect(result).toHaveLength(2);
    });
  });

  describe('static data verification', () => {
    it('returns same data on multiple calls (static)', async () => {
      // Arrange
      const tools = [{ name: 'test', description: 'Test tool' }];
      const functions = createIntrospectionFunctions(tools, [], [], []);

      // Act
      const result1 = (await functions.list_tools.fn([])) as RillValue[];
      const result2 = (await functions.list_tools.fn([])) as RillValue[];

      // Assert - same reference (static data)
      expect(result1).toBe(result2);
    });

    it('data captured at factory time, not query time', async () => {
      // Arrange - create functions with initial data
      const tools = [{ name: 'tool1', description: 'First' }];
      const functions = createIntrospectionFunctions(tools, [], [], []);

      // Modify source data after function creation
      tools.push({ name: 'tool2', description: 'Second' });

      // Act
      const result = (await functions.list_tools.fn([])) as RillValue[];

      // Assert - still returns original data (captured at creation)
      expect(result).toHaveLength(1);
      expect((result[0] as { name: string }).name).toBe('tool1');
    });
  });

  describe('empty capability handling', () => {
    it('returns empty lists for servers with no capabilities', async () => {
      // Arrange
      const functions = createIntrospectionFunctions([], [], [], []);

      // Act
      const tools = (await functions.list_tools.fn([])) as RillValue[];
      const resources = (await functions.list_resources.fn([])) as RillValue[];
      const prompts = (await functions.list_prompts.fn([])) as RillValue[];

      // Assert - all empty
      expect(tools).toEqual([]);
      expect(resources).toEqual([]);
      expect(prompts).toEqual([]);
    });

    it('generates only introspection functions when no capabilities', () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions([], [], [], []);

      // Assert - exactly three functions
      expect(Object.keys(functions)).toEqual([
        'list_tools',
        'list_resources',
        'list_prompts',
      ]);
    });
  });
});
