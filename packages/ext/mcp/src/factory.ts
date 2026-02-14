/**
 * Factory function for creating MCP extension instances.
 *
 * Provides the main entry point for initializing MCP client connections
 * and generating rill host functions for tool/resource/prompt access.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HeadersInit } from 'undici-types';
import type { ExtensionResult } from '@rcrsr/rill';
import type { McpExtensionConfig } from './types.js';
import {
  createProcessExitError,
  createConnectionRefusedError,
  createAuthRequiredError,
} from './errors.js';
import { generateToolFunctions } from './tools.js';
import {
  createReadResourceFunction,
  generateResourceTemplateFunctions,
} from './resources.js';
import { generatePromptFunctions } from './prompts.js';
import { createIntrospectionFunctions } from './introspection.js';

/**
 * Create an MCP extension with the specified configuration.
 *
 * Phase 1: Config validation and skeleton structure
 * Phase 2: Transport connection, capability discovery, function generation
 *
 * @param config - MCP extension configuration (transport, filters, timeout)
 * @returns Promise resolving to ExtensionResult with host functions
 * @throws {Error} If config validation fails (missing required transport fields)
 *
 * @example
 * ```typescript
 * const mcpExt = await createMcpExtension({
 *   transport: {
 *     type: 'stdio',
 *     command: 'mcp-server',
 *     args: ['--config', 'server.json']
 *   },
 *   timeout: 30000
 * });
 * ```
 */
export async function createMcpExtension(
  config: McpExtensionConfig
): Promise<ExtensionResult> {
  // ============================================================
  // STEP 1: CONFIG VALIDATION (sync)
  // ============================================================
  validateConfig(config);

  // ============================================================
  // STEP 2: TRANSPORT CONNECTION (async)
  // ============================================================
  let transport: Transport;
  let client: Client;

  try {
    transport = await createTransport(config);

    // Set up error handler to catch async transport errors
    let transportError: Error | undefined;
    if (transport.onerror) {
      const originalOnError = transport.onerror;
      transport.onerror = (error: Error) => {
        transportError = error;
        originalOnError(error);
      };
    } else {
      transport.onerror = (error: Error) => {
        transportError = error;
      };
    }

    client = new Client(
      {
        name: 'rill-mcp-extension',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Connect with timeout wrapper
    const timeout = config.timeout ?? 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('connection timeout'));
      }, timeout);
      // Ensure timer doesn't prevent process exit
      timer.unref();
    });

    await Promise.race([client.connect(transport), timeoutPromise]);

    // Check if transport error occurred during connection
    if (transportError) {
      throw transportError;
    }
  } catch (error) {
    // Map transport connection errors to spec error types
    throw mapConnectionError(error, config);
  }

  // ============================================================
  // STEP 3: CAPABILITY DISCOVERY (async)
  // ============================================================
  const capabilities = await discoverCapabilities(client, config);

  // ============================================================
  // STEP 4: FUNCTION GENERATION (sync)
  // ============================================================
  const timeout = config.timeout ?? 30000;

  // Shared lifecycle state for event tracking across all functions
  const lifecycleState = { connectEmitted: false };

  // Generate tool functions from filtered tools
  const toolFunctions = generateToolFunctions(
    capabilities.filteredTools as Parameters<typeof generateToolFunctions>[0],
    client,
    timeout,
    lifecycleState
  );

  // Generate resource functions (read_resource + templates)
  const readResourceFunction = createReadResourceFunction(
    client,
    timeout,
    lifecycleState
  );
  const resourceTemplateFunctions = generateResourceTemplateFunctions(
    capabilities.filteredResourceTemplates as Parameters<
      typeof generateResourceTemplateFunctions
    >[0],
    client,
    timeout,
    lifecycleState
  );

  // Generate prompt functions from filtered prompts
  const promptFunctions = generatePromptFunctions(
    capabilities.filteredPrompts as Parameters<
      typeof generatePromptFunctions
    >[0],
    client,
    timeout,
    lifecycleState
  );

  // Generate introspection functions (use ALL capabilities, not filtered)
  const introspectionFunctions = createIntrospectionFunctions(
    capabilities.allTools as Parameters<typeof createIntrospectionFunctions>[0],
    capabilities.allResources as Parameters<
      typeof createIntrospectionFunctions
    >[1],
    capabilities.allResourceTemplates as Parameters<
      typeof createIntrospectionFunctions
    >[2],
    capabilities.allPrompts as Parameters<
      typeof createIntrospectionFunctions
    >[3]
  );

  // ============================================================
  // STEP 5: RETURN EXTENSION RESULT WITH DISPOSE
  // ============================================================
  let disposed = false;

  const dispose = async (): Promise<void> => {
    // BC-5: Idempotent dispose - subsequent calls no-op
    if (disposed) {
      return;
    }
    disposed = true;

    // NOTE: IR-1 specifies mcp:disconnect should be emitted here, but dispose()
    // is called after script execution when no RuntimeContext exists.

    // Close client connection
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup
    }

    // Close transport
    try {
      await transport.close();
    } catch {
      // Ignore errors during cleanup
    }
  };

  // Build result with proper typing
  const result = {
    ...toolFunctions,
    read_resource: readResourceFunction,
    ...resourceTemplateFunctions,
    ...promptFunctions,
    ...introspectionFunctions,
    dispose,
    // Store capabilities for testing/introspection
    _capabilities: capabilities,
  } as unknown as ExtensionResult;

  return result;
}

/**
 * Validate MCP extension configuration synchronously.
 *
 * @param config - Configuration to validate
 * @throws {Error} If stdio transport missing command [EC-1]
 * @throws {Error} If http transport missing url [EC-2]
 */
function validateConfig(config: McpExtensionConfig): void {
  const { transport } = config;

  if (transport.type === 'stdio') {
    // EC-1: stdio transport missing command
    if (!transport.command) {
      throw new Error('transport.command is required for stdio transport');
    }
  } else if (transport.type === 'http') {
    // EC-2: http transport missing url
    if (!transport.url) {
      throw new Error('transport.url is required for http transport');
    }
  }
}

/**
 * Create MCP transport based on config type.
 *
 * @param config - Extension configuration
 * @returns Transport instance (stdio or http)
 * @throws {Error} If transport creation fails
 */
async function createTransport(config: McpExtensionConfig): Promise<Transport> {
  const { transport } = config;

  if (transport.type === 'stdio') {
    // Create stdio transport with process spawn
    const params: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    } = {
      command: transport.command,
      args: transport.args ?? [],
    };

    // Only add env if it exists
    if (transport.env) {
      params.env = transport.env;
    }

    return new StdioClientTransport(params) as Transport;
  } else {
    // Create HTTP transport with optional headers
    const url = new URL(transport.url);

    // Handle static or dynamic headers [AC-4]
    if (transport.headers) {
      let resolvedHeaders: HeadersInit;
      if (typeof transport.headers === 'function') {
        // Dynamic headers: call function to get current headers
        resolvedHeaders = await transport.headers();
      } else {
        // Static headers: use directly
        resolvedHeaders = transport.headers;
      }

      return new StreamableHTTPClientTransport(url, {
        requestInit: { headers: new Headers(resolvedHeaders) },
      }) as Transport;
    }

    // No headers - return without requestInit
    return new StreamableHTTPClientTransport(url) as Transport;
  }
}

/**
 * Capability discovery result with both unfiltered and filtered lists.
 */
interface DiscoveredCapabilities {
  readonly allTools: Array<{
    name: string;
    description?: string | undefined;
    inputSchema: unknown;
  }>;
  readonly allResources: Array<{
    uri: string;
    name: string;
    description?: string | undefined;
    mimeType?: string | undefined;
  }>;
  readonly allResourceTemplates: Array<{
    uriTemplate: string;
    name: string;
    description?: string | undefined;
    mimeType?: string | undefined;
  }>;
  readonly allPrompts: Array<{
    name: string;
    description?: string | undefined;
    arguments?: unknown[] | undefined;
  }>;
  readonly filteredTools: Array<{
    name: string;
    description?: string | undefined;
    inputSchema: unknown;
  }>;
  readonly filteredResources: Array<{
    uri: string;
    name: string;
    description?: string | undefined;
    mimeType?: string | undefined;
  }>;
  readonly filteredResourceTemplates: Array<{
    uriTemplate: string;
    name: string;
    description?: string | undefined;
    mimeType?: string | undefined;
  }>;
  readonly filteredPrompts: Array<{
    name: string;
    description?: string | undefined;
    arguments?: unknown[] | undefined;
  }>;
}

/**
 * Discover server capabilities via parallel list operations.
 *
 * Calls listTools, listResources, listResourceTemplates, and listPrompts in parallel,
 * then applies filters from config.
 *
 * @param client - Connected MCP client
 * @param config - Extension configuration with filters
 * @returns Discovered capabilities (both unfiltered and filtered)
 */
async function discoverCapabilities(
  client: Client,
  config: McpExtensionConfig
): Promise<DiscoveredCapabilities> {
  // Parallel capability discovery [IR-1]
  const [toolsResult, resourcesResult, resourceTemplatesResult, promptsResult] =
    await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listResourceTemplates(),
      client.listPrompts(),
    ]);

  // Extract lists from results
  const allTools = toolsResult.tools || [];
  const allResources = resourcesResult.resources || [];
  const allResourceTemplates = resourceTemplatesResult.resourceTemplates || [];
  const allPrompts = promptsResult.prompts || [];

  // Apply filters [BC-7]
  const filteredTools = filterCapabilities(
    allTools,
    config.toolFilter,
    (tool) => tool.name
  );
  const filteredResources = filterCapabilities(
    allResources,
    config.resourceFilter,
    (resource) => resource.uri
  );
  const filteredResourceTemplates = filterCapabilities(
    allResourceTemplates,
    config.resourceFilter,
    (template) => template.name
  );
  const filteredPrompts = filterCapabilities(
    allPrompts,
    config.promptFilter,
    (prompt) => prompt.name
  );

  return {
    allTools,
    allResources,
    allResourceTemplates,
    allPrompts,
    filteredTools,
    filteredResources,
    filteredResourceTemplates,
    filteredPrompts,
  };
}

/**
 * Filter capabilities by exact match against filter list.
 *
 * Empty filter or undefined filter means include all.
 *
 * @param items - Items to filter
 * @param filter - Filter list (exact matches) or undefined
 * @param keyFn - Function to extract key for matching
 * @returns Filtered items
 */
function filterCapabilities<T>(
  items: T[],
  filter: string[] | undefined,
  keyFn: (item: T) => string
): T[] {
  // Empty or undefined filter = include all [BC-7]
  if (!filter || filter.length === 0) {
    return items;
  }

  // Exact match filtering
  const filterSet = new Set(filter);
  return items.filter((item) => filterSet.has(keyFn(item)));
}

/**
 * Map connection errors to spec error types.
 *
 * @param error - Original error from transport
 * @param config - Extension configuration (for context)
 * @returns Mapped error
 */
function mapConnectionError(error: unknown, config: McpExtensionConfig): Error {
  // Extract error message and code for analysis
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';

  // EC-3: Process exit error (stdio only)
  if (config.transport.type === 'stdio') {
    // ENOENT means command not found - treat as process exit
    if (code === 'ENOENT' || /enoent/i.test(message)) {
      return createProcessExitError(1);
    }

    // Check for exit code in error
    const exitCodeMatch = /exit(?:ed)?\s+(?:with\s+)?code\s+(\d+)/i.exec(
      message
    );
    if (exitCodeMatch) {
      const exitCode = Number.parseInt(exitCodeMatch[1]!, 10);
      return createProcessExitError(exitCode);
    }

    // Generic process spawn/exit errors
    if (
      /spawn/i.test(message) ||
      /exit/i.test(message) ||
      /process/i.test(message)
    ) {
      return createProcessExitError(1);
    }
  }

  // EC-4: Connection refused error (http only)
  if (config.transport.type === 'http') {
    // Connection timeout
    if (/timeout/i.test(message) || code === 'ETIMEDOUT') {
      return createConnectionRefusedError(config.transport.url);
    }

    // Connection refused
    if (
      code === 'ECONNREFUSED' ||
      /refused/i.test(message) ||
      /econnrefused/i.test(message) ||
      /fetch.*failed/i.test(message)
    ) {
      return createConnectionRefusedError(config.transport.url);
    }

    // EC-5: Auth required (401 status)
    if (/401/i.test(message) || /unauthorized/i.test(message)) {
      return createAuthRequiredError();
    }
  }

  // Return original error if no specific mapping
  if (error instanceof Error) {
    return error;
  }

  return new Error(`mcp: failed to connect -- ${message}`);
}
