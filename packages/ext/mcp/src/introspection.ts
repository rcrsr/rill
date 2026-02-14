/**
 * Introspection function generation for MCP Server Mapper Extension.
 *
 * Generates list_tools, list_resources, and list_prompts functions that return
 * static capability metadata captured at factory time. These functions provide
 * visibility into all server capabilities regardless of filter settings.
 */

import type { HostFunctionDefinition, RillValue } from '@rcrsr/rill';

// ============================================================
// MCP CAPABILITY TYPES (subset from SDK)
// ============================================================

/**
 * MCP tool metadata from server.
 */
export interface McpTool {
  readonly name: string;
  readonly description?: string | undefined;
}

/**
 * MCP resource metadata from server.
 */
export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource template metadata from server.
 */
export interface McpResourceTemplate {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * MCP prompt metadata from server.
 */
export interface McpPrompt {
  readonly name: string;
  readonly description?: string | undefined;
  readonly arguments?: readonly { name: string }[] | undefined;
}

// ============================================================
// INTROSPECTION FUNCTION GENERATION
// ============================================================

/**
 * Creates introspection functions for MCP capabilities.
 *
 * Generates three parameterless functions that return static capability metadata:
 * - list_tools: Returns list of tool dicts with name and description
 * - list_resources: Returns combined list of resources and templates with uri/uriTemplate, name, description, mime
 * - list_prompts: Returns list of prompt dicts with name, description, arguments
 *
 * These functions return data captured at factory time (static).
 * They list ALL server capabilities regardless of filter settings.
 * Optional MCP fields default to empty string in returned dicts.
 *
 * @param allTools - All tools discovered from MCP server
 * @param allResources - All resources discovered from MCP server
 * @param allResourceTemplates - All resource templates discovered from MCP server
 * @param allPrompts - All prompts discovered from MCP server
 * @returns Record of function name to HostFunctionDefinition
 *
 * @example
 * ```typescript
 * const introspection = createIntrospectionFunctions(
 *   [{ name: 'echo', description: 'Echo tool' }],
 *   [{ uri: 'file://test', name: 'test', description: '', mimeType: 'text/plain' }],
 *   [{ uriTemplate: 'file://{path}', name: 'template', description: 'Template', mimeType: 'text/plain' }],
 *   [{ name: 'greet', description: 'Greeting prompt', arguments: [{ name: 'name' }] }]
 * );
 * // introspection.list_tools: parameterless function returning list of tool dicts
 * ```
 */
export function createIntrospectionFunctions(
  allTools: readonly McpTool[],
  allResources: readonly McpResource[],
  allResourceTemplates: readonly McpResourceTemplate[],
  allPrompts: readonly McpPrompt[]
): Record<string, HostFunctionDefinition> {
  // Convert tools to rill dict format
  const toolsList: RillValue[] = allTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
  }));

  // Convert resources to rill dict format (static resources)
  const staticResourcesList: RillValue[] = allResources.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description ?? '',
    mime: resource.mimeType ?? '',
  }));

  // Convert resource templates to rill dict format (dynamic resources)
  const templateResourcesList: RillValue[] = allResourceTemplates.map(
    (template) => ({
      uriTemplate: template.uriTemplate,
      name: template.name,
      description: template.description ?? '',
      mime: template.mimeType ?? '',
    })
  );

  // Combine static resources and templates
  const resourcesList: RillValue[] = [
    ...staticResourcesList,
    ...templateResourcesList,
  ];

  // Convert prompts to rill dict format
  const promptsList: RillValue[] = allPrompts.map((prompt) => {
    // Extract argument names from prompt arguments array
    const argumentNames: string[] = prompt.arguments
      ? prompt.arguments.map((arg) => arg.name)
      : [];

    return {
      name: prompt.name,
      description: prompt.description ?? '',
      arguments: argumentNames,
    };
  });

  // Create list_tools function
  const listTools: HostFunctionDefinition = {
    params: [],
    fn: async (): Promise<RillValue> => toolsList,
    description: 'List all available tools from MCP server',
    returnType: 'list',
  };

  // Create list_resources function
  const listResources: HostFunctionDefinition = {
    params: [],
    fn: async (): Promise<RillValue> => resourcesList,
    description: 'List all available resources from MCP server',
    returnType: 'list',
  };

  // Create list_prompts function
  const listPrompts: HostFunctionDefinition = {
    params: [],
    fn: async (): Promise<RillValue> => promptsList,
    description: 'List all available prompts from MCP server',
    returnType: 'list',
  };

  return {
    list_tools: listTools,
    list_resources: listResources,
    list_prompts: listPrompts,
  };
}
