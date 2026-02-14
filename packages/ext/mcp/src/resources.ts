/**
 * Resource function generation for MCP Server Mapper Extension.
 *
 * Converts MCP resources to rill HostFunctionDefinition objects:
 * - Static resource read: ns::read_resource(uri: string) -> dict
 * - Resource templates: ns::resource_{template_name}(params...) -> dict
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { HostFunctionDefinition, RillValue } from '@rcrsr/rill';
import { emitExtensionEvent } from '@rcrsr/rill';

// RuntimeContextLike type for ctx parameter (structural type matching CallableFn)
type RuntimeContextLike = {
  readonly variables: Map<string, RillValue>;
  pipeValue: RillValue;
};
import {
  createToolError,
  createProtocolError,
  createTimeoutError,
  createConnectionLostError,
  createAuthFailedError,
} from './errors.js';
import { sanitizeNames } from './naming.js';
import { parseResourceContent } from './parsing.js';

// ============================================================
// MCP TYPES (subset from SDK)
// ============================================================

/**
 * MCP resource template from server.
 */
export interface McpResourceTemplate {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result content block.
 */
export interface McpResourceContent {
  readonly uri: string;
  readonly text?: string | undefined;
  readonly blob?: string | undefined; // base64
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result.
 */
export interface McpResourceResult {
  readonly contents: McpResourceContent[];
}

// ============================================================
// URI TEMPLATE PARSING
// ============================================================

/**
 * Extracts RFC 6570 template variables from a URI template.
 *
 * Extracts variable names from {varName} patterns in URI template strings.
 * Only simple variable expansion is supported (no operators like {+var}, {#var}, etc.).
 *
 * Examples:
 * - "db://table/{tableName}/row/{rowId}" -> ["tableName", "rowId"]
 * - "file:///{path}" -> ["path"]
 * - "static://resource" -> []
 *
 * @param uriTemplate - RFC 6570 URI template string
 * @returns Array of variable names (in order of appearance)
 */
export function extractTemplateVariables(uriTemplate: string): string[] {
  const variables: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(uriTemplate)) !== null) {
    const varName = match[1]!.trim();
    // Only capture simple variable names (no operators like +, #, ., /, ;, ?, &)
    if (varName && !/[+#./;?&]/.test(varName)) {
      variables.push(varName);
    }
  }

  return variables;
}

/**
 * Expands a URI template with provided arguments.
 *
 * Substitutes {varName} patterns with corresponding argument values.
 * All argument values are converted to strings for URI expansion.
 *
 * @param uriTemplate - RFC 6570 URI template string
 * @param variables - Variable names in order
 * @param args - Argument values in order
 * @returns Expanded URI string
 */
function expandUriTemplate(
  uriTemplate: string,
  variables: string[],
  args: RillValue[]
): string {
  let expanded = uriTemplate;

  for (let i = 0; i < variables.length; i++) {
    const varName = variables[i]!;
    const value = args[i];
    // Convert value to string for URI expansion
    const stringValue = value !== undefined ? String(value) : '';
    expanded = expanded.replace(`{${varName}}`, stringValue);
  }

  return expanded;
}

// ============================================================
// RESOURCE READ FUNCTION
// ============================================================

/**
 * Creates the static read_resource function.
 *
 * Generates rill HostFunctionDefinition for reading MCP resources by URI.
 * Calls MCP client.readResource with timeout and parses response content.
 *
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns HostFunctionDefinition for read_resource
 */
export function createReadResourceFunction(
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): HostFunctionDefinition {
  const fn = async (
    args: RillValue[],
    ctx: RuntimeContextLike
  ): Promise<RillValue> => {
    // Emit mcp:connect on first resource read [IR-1]
    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx as any, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }

    const uri = args[0];

    // Validate URI parameter
    if (typeof uri !== 'string') {
      throw createToolError(
        'read_resource',
        `expected string uri, got ${typeof uri}`
      );
    }

    // Emit mcp:resource_read event [IR-1]
    emitExtensionEvent(ctx as any, {
      event: 'mcp:resource_read',
      subsystem: 'extension:mcp',
      uri,
    });

    // Set up timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(createTimeoutError('read_resource', timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      // Call MCP readResource with timeout race
      const result = (await Promise.race([
        client.readResource({ uri }),
        timeoutPromise,
      ])) as McpResourceResult;

      // Parse and return content
      return parseResourceContent(result);
    } catch (error) {
      // Emit mcp:error event [IR-1]
      emitExtensionEvent(ctx as any, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: error instanceof Error ? error.message : String(error),
        uri,
      });

      // Handle error categories per spec (similar to tools.ts)
      if (error instanceof Error) {
        // Already wrapped runtime error: re-throw
        if (error.name === 'RuntimeError') {
          throw error;
        }

        const message = error.message.toLowerCase();

        // Connection lost
        if (
          message.includes('connection closed') ||
          message.includes('connection lost') ||
          message.includes('disconnected')
        ) {
          throw createConnectionLostError();
        }

        // Authentication failed
        if (
          message.includes('unauthorized') ||
          message.includes('authentication failed') ||
          message.includes('token') ||
          message.includes('auth')
        ) {
          throw createAuthFailedError();
        }

        // Protocol error
        if (
          message.includes('protocol') ||
          message.includes('invalid response') ||
          message.includes('parse') ||
          message.includes('malformed')
        ) {
          throw createProtocolError(error.message);
        }

        // Generic resource error (fallback)
        throw createToolError('read_resource', error.message);
      }

      // Non-Error exception: wrap as resource error
      throw createToolError('read_resource', String(error));
    }
  };

  return {
    params: [
      {
        name: 'uri',
        type: 'string',
        description: 'Resource URI to read',
      },
    ],
    fn,
    description: 'Read an MCP resource by URI',
    returnType: 'dict',
  };
}

// ============================================================
// RESOURCE TEMPLATE FUNCTIONS
// ============================================================

/**
 * Creates a resource template function.
 *
 * Generates rill HostFunctionDefinition for parameterized resource templates.
 * Extracts URI template variables, expands with arguments, and reads resource.
 *
 * @param template - MCP resource template
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns HostFunctionDefinition for this template
 */
function createResourceTemplateFunction(
  template: McpResourceTemplate,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): HostFunctionDefinition {
  // Extract template variables
  const variables = extractTemplateVariables(template.uriTemplate);

  // Generate parameters from template variables
  const params = variables.map((varName) => ({
    name: varName,
    type: 'string' as const,
    description: `URI template variable: ${varName}`,
  }));

  // Create async function wrapper
  const fn = async (
    args: RillValue[],
    ctx: RuntimeContextLike
  ): Promise<RillValue> => {
    // Emit mcp:connect on first resource template call [IR-1]
    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx as any, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }
    // Validate all arguments are strings
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg !== 'string') {
        throw createToolError(
          template.name,
          `expected string for parameter ${variables[i]}, got ${typeof arg}`
        );
      }
    }

    // Expand URI template with arguments
    const expandedUri = expandUriTemplate(
      template.uriTemplate,
      variables,
      args
    );

    // Emit mcp:resource_read event [IR-1]
    emitExtensionEvent(ctx as any, {
      event: 'mcp:resource_read',
      subsystem: 'extension:mcp',
      uri: expandedUri,
    });

    // Set up timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(createTimeoutError(template.name, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      // Call MCP readResource with expanded URI
      const result = (await Promise.race([
        client.readResource({ uri: expandedUri }),
        timeoutPromise,
      ])) as McpResourceResult;

      // Parse and return content
      return parseResourceContent(result);
    } catch (error) {
      // Emit mcp:error event [IR-1]
      emitExtensionEvent(ctx as any, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: error instanceof Error ? error.message : String(error),
        uri: expandedUri,
      });

      // Handle error categories (same as read_resource)
      if (error instanceof Error) {
        if (error.name === 'RuntimeError') {
          throw error;
        }

        const message = error.message.toLowerCase();

        if (
          message.includes('connection closed') ||
          message.includes('connection lost') ||
          message.includes('disconnected')
        ) {
          throw createConnectionLostError();
        }

        if (
          message.includes('unauthorized') ||
          message.includes('authentication failed') ||
          message.includes('token') ||
          message.includes('auth')
        ) {
          throw createAuthFailedError();
        }

        if (
          message.includes('protocol') ||
          message.includes('invalid response') ||
          message.includes('parse') ||
          message.includes('malformed')
        ) {
          throw createProtocolError(error.message);
        }

        throw createToolError(template.name, error.message);
      }

      throw createToolError(template.name, String(error));
    }
  };

  return {
    params,
    fn,
    ...(template.description !== undefined && {
      description: template.description,
    }),
    returnType: 'dict',
  };
}

/**
 * Generates rill host functions for MCP resource templates.
 *
 * Applies name sanitization with collision detection and creates
 * HostFunctionDefinition for each resource template.
 *
 * Template names are prefixed with "resource_" to distinguish from other functions.
 *
 * @param templates - Array of MCP resource templates
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to HostFunctionDefinition
 */
export function generateResourceTemplateFunctions(
  templates: McpResourceTemplate[],
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, HostFunctionDefinition> {
  // Prefix template names with "resource_" before sanitization
  const prefixedNames = templates.map(
    (template) => `resource_${template.name}`
  );

  // Sanitize names with collision detection
  const nameMap = sanitizeNames(prefixedNames);
  const functions: Record<string, HostFunctionDefinition> = {};

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i]!;
    const prefixedName = prefixedNames[i]!;
    const sanitizedName = nameMap.get(prefixedName);

    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = createResourceTemplateFunction(
      template,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
