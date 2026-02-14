/**
 * Tool function generation for MCP Server Mapper Extension.
 *
 * Converts MCP tools to rill HostFunctionDefinition objects with
 * parameter validation, timeout handling, and result parsing.
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
import { generateParametersFromSchema, type JsonSchema } from './parsing.js';
import { sanitizeNames } from './naming.js';

// ============================================================
// MCP TYPES (subset from SDK)
// ============================================================

/**
 * MCP tool definition from server.
 */
export interface McpTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: JsonSchema;
}

/**
 * MCP tool call result content block.
 */
export interface McpToolContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string | undefined;
  readonly data?: string | undefined; // base64 for images
  readonly mimeType?: string | undefined;
}

/**
 * MCP tool call result.
 */
export interface McpToolResult {
  readonly content: McpToolContent[];
  readonly isError?: boolean | undefined;
}

// ============================================================
// RESULT PARSING
// ============================================================

/**
 * Parses MCP tool result content blocks to rill value.
 *
 * Rules (AC-8):
 * - Single text block with JSON → parse to dict
 * - Single text block (non-JSON) → return string
 * - Single image block → dict with [type: "image", data: base64, mime: "..."]
 * - Multiple text blocks → concatenate with newlines
 * - Multiple non-text blocks → return structured dict with content array
 *
 * @param result - MCP tool result with content blocks
 * @returns Rill value (string, dict, or structured content)
 */
function parseToolResult(result: McpToolResult): RillValue {
  const { content } = result;

  // Empty content: return empty string
  if (content.length === 0) {
    return '';
  }

  // Single content block: apply type-specific parsing
  if (content.length === 1) {
    const block = content[0]!;

    if (block.type === 'text') {
      const text = block.text ?? '';

      // Try parsing as JSON
      try {
        const parsed = JSON.parse(text);
        // JSON successfully parsed: return as dict if object, otherwise as-is
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          return parsed as { [key: string]: RillValue };
        }
        return parsed;
      } catch {
        // Not JSON: return as plain string
        return text;
      }
    }

    if (block.type === 'image') {
      // Image content: return structured dict
      return {
        type: 'image',
        data: block.data ?? '',
        mime: block.mimeType ?? 'image/png',
      };
    }

    // Resource or unknown type: return as text fallback
    return block.text ?? '';
  }

  // Multiple content blocks: check if all are text
  const allText = content.every((block) => block.type === 'text');

  if (allText) {
    // Concatenate text blocks with newlines
    return content.map((block) => block.text ?? '').join('\n');
  }

  // Mixed or multiple non-text blocks: return structured dict
  return {
    content: content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text ?? '' };
      }
      if (block.type === 'image') {
        return {
          type: 'image',
          data: block.data ?? '',
          mime: block.mimeType ?? 'image/png',
        };
      }
      // Resource or unknown
      return { type: block.type, text: block.text ?? '' };
    }),
  };
}

// ============================================================
// TOOL FUNCTION GENERATION
// ============================================================

/**
 * Generates rill HostFunctionDefinition from MCP tool.
 *
 * Creates async wrapper that:
 * - Emits mcp:tool_call lifecycle event
 * - Calls MCP client.callTool with timeout
 * - Parses result content per AC-8
 * - Maps errors per EC-6 through EC-10
 * - Emits mcp:error on failures
 *
 * @param tool - MCP tool definition
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns HostFunctionDefinition for this tool
 */
function generateToolFunction(
  tool: McpTool,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): HostFunctionDefinition {
  // Generate parameters from JSON Schema
  const params = generateParametersFromSchema(tool.inputSchema);

  // Create async function wrapper
  const fn = async (
    args: RillValue[],
    ctx: RuntimeContextLike
  ): Promise<RillValue> => {
    // Emit mcp:connect on first tool call [IR-1]
    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx as any, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }
    // Build arguments object from positional args array
    const toolArgs: Record<string, unknown> = {};
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      const value = args[i];
      // Use actual argument value or default from param
      toolArgs[param.name] = value !== undefined ? value : param.defaultValue;
    }

    // Emit mcp:tool_call event [IR-1]
    emitExtensionEvent(ctx as any, {
      event: 'mcp:tool_call',
      subsystem: 'extension:mcp',
      tool: tool.name,
      params: toolArgs,
    });

    // Set up timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(createTimeoutError(tool.name, timeoutMs));
      }, timeoutMs);
      // Ensure timer doesn't prevent process exit
      timer.unref();
    });

    try {
      // Call tool with timeout race
      const result = (await Promise.race([
        client.callTool({ name: tool.name, arguments: toolArgs }),
        timeoutPromise,
      ])) as McpToolResult;

      // Check for error response
      if (result.isError) {
        // Extract error text from content
        const errorText = result.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n');
        throw createToolError(tool.name, errorText || 'unknown error');
      }

      // Parse and return result
      return parseToolResult(result);
    } catch (error) {
      // Emit mcp:error event [IR-1]
      emitExtensionEvent(ctx as any, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: error instanceof Error ? error.message : String(error),
        tool: tool.name,
      });

      // Handle error categories per spec
      if (error instanceof Error) {
        // Already wrapped runtime error: re-throw
        if (error.name === 'RuntimeError') {
          throw error;
        }

        const message = error.message.toLowerCase();

        // EC-9: Connection lost
        if (
          message.includes('connection closed') ||
          message.includes('connection lost') ||
          message.includes('disconnected')
        ) {
          throw createConnectionLostError();
        }

        // EC-10: Authentication failed
        if (
          message.includes('unauthorized') ||
          message.includes('authentication failed') ||
          message.includes('token') ||
          message.includes('auth')
        ) {
          throw createAuthFailedError();
        }

        // EC-7: Protocol error (malformed response, parsing failure)
        if (
          message.includes('protocol') ||
          message.includes('invalid response') ||
          message.includes('parse') ||
          message.includes('malformed')
        ) {
          throw createProtocolError(error.message);
        }

        // EC-6: Generic tool error (fallback)
        throw createToolError(tool.name, error.message);
      }

      // Non-Error exception: wrap as tool error
      throw createToolError(tool.name, String(error));
    }
  };

  return {
    params,
    fn,
    ...(tool.description !== undefined && { description: tool.description }),
    returnType: 'any',
  };
}

/**
 * Generates rill host functions for all MCP tools.
 *
 * Applies name sanitization with collision detection and creates
 * HostFunctionDefinition for each tool.
 *
 * @param tools - Array of MCP tool definitions
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to HostFunctionDefinition
 */
export function generateToolFunctions(
  tools: McpTool[],
  client: Client,
  timeoutMs = 30000,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, HostFunctionDefinition> {
  // Sanitize tool names with collision detection
  const nameMap = sanitizeNames(tools.map((tool) => tool.name));
  const functions: Record<string, HostFunctionDefinition> = {};

  for (const tool of tools) {
    const sanitizedName = nameMap.get(tool.name);
    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = generateToolFunction(
      tool,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
