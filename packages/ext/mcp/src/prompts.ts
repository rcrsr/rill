/**
 * Prompt function generation for MCP Server Mapper Extension.
 *
 * Converts MCP prompts to rill HostFunctionDefinition objects:
 * - Each prompt becomes ns::prompt_{prompt_name}(params...) -> list
 * - Returns list of dicts with role and content fields
 * - Multi-part content concatenated to single string per message
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

// ============================================================
// MCP TYPES (subset from SDK)
// ============================================================

/**
 * MCP prompt from server.
 */
export interface McpPrompt {
  readonly name: string;
  readonly description?: string | undefined;
  readonly arguments?: McpPromptArgument[] | undefined;
}

/**
 * MCP prompt argument definition.
 */
export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
}

/**
 * MCP prompt message content (text or image).
 */
export interface McpPromptMessageContent {
  readonly type: 'text' | 'image' | string;
  readonly text?: string | undefined;
  readonly data?: string | undefined; // base64 for images
  readonly mimeType?: string | undefined;
}

/**
 * MCP prompt message.
 */
export interface McpPromptMessage {
  readonly role: 'user' | 'assistant' | string;
  readonly content: McpPromptMessageContent | McpPromptMessageContent[];
}

/**
 * MCP prompt get result.
 */
export interface McpPromptResult {
  readonly messages: McpPromptMessage[];
}

// ============================================================
// MESSAGE PARSING
// ============================================================

/**
 * Concatenates multi-part message content to single string.
 *
 * Handles both single content objects and arrays of content.
 * For text content: extracts the text field.
 * For image content: returns placeholder (images not supported in rill strings).
 * Multiple content parts are joined with newlines.
 *
 * @param content - Single content object or array of content objects
 * @returns Concatenated string content
 */
function concatenateMessageContent(
  content: McpPromptMessageContent | McpPromptMessageContent[]
): string {
  // Handle single content object
  if (!Array.isArray(content)) {
    if (content.type === 'text' && content.text !== undefined) {
      return content.text;
    }
    // For non-text content (e.g., images), return empty string
    return '';
  }

  // Handle array of content objects
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text !== undefined) {
      parts.push(part.text);
    }
    // Skip non-text content
  }

  return parts.join('\n');
}

/**
 * Converts MCP prompt result to rill list of dicts.
 *
 * Transforms MCP message format to rill data structure:
 * - Each message becomes a dict with 'role' and 'content' keys
 * - Multi-part content is concatenated to single string
 * - Returns list of dicts: [[role: "user", content: "..."], ...]
 *
 * @param result - MCP prompt result
 * @returns List of message dicts
 */
function parsePromptMessages(result: McpPromptResult): RillValue {
  const messages: RillValue[] = [];

  for (const message of result.messages) {
    const contentString = concatenateMessageContent(message.content);

    const messageDict: { [key: string]: RillValue } = {
      role: message.role,
      content: contentString,
    };

    messages.push(messageDict);
  }

  return messages;
}

// ============================================================
// PROMPT FUNCTIONS
// ============================================================

/**
 * Creates a prompt function.
 *
 * Generates rill HostFunctionDefinition for parameterized prompts.
 * Calls MCP client.getPrompt with prompt name and argument dict.
 * Returns list of dicts with role and content fields.
 *
 * @param prompt - MCP prompt definition
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns HostFunctionDefinition for this prompt
 */
function createPromptFunction(
  prompt: McpPrompt,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): HostFunctionDefinition {
  // Generate parameters from prompt arguments
  const promptArgs = prompt.arguments ?? [];
  const params = promptArgs.map((arg) => ({
    name: arg.name,
    type: 'string' as const,
    description: arg.description ?? `Prompt argument: ${arg.name}`,
    ...(arg.required !== true && { defaultValue: '' }),
  }));

  // Create async function wrapper
  const fn = async (
    args: RillValue[],
    ctx: RuntimeContextLike
  ): Promise<RillValue> => {
    // Emit mcp:connect on first prompt call [IR-1]
    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx as any, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }
    // Build arguments dict for MCP call
    const argsDict: Record<string, string> = {};

    for (let i = 0; i < promptArgs.length; i++) {
      const promptArg = promptArgs[i]!;
      const value = args[i];

      // Validate argument is string (or undefined for optional args)
      if (value !== undefined && typeof value !== 'string') {
        throw createToolError(
          `prompt_${prompt.name}`,
          `expected string for parameter ${promptArg.name}, got ${typeof value}`
        );
      }

      // Add to dict if provided (or required)
      if (value !== undefined) {
        argsDict[promptArg.name] = value;
      } else if (promptArg.required === true) {
        throw createToolError(
          `prompt_${prompt.name}`,
          `required parameter ${promptArg.name} is missing`
        );
      }
    }

    // Emit mcp:prompt_get event [IR-1]
    emitExtensionEvent(ctx as any, {
      event: 'mcp:prompt_get',
      subsystem: 'extension:mcp',
      prompt: prompt.name,
      params: argsDict,
    });

    // Set up timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(createTimeoutError(`prompt_${prompt.name}`, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      // Call MCP getPrompt with prompt name and arguments
      const result = (await Promise.race([
        client.getPrompt({
          name: prompt.name,
          arguments: argsDict,
        }),
        timeoutPromise,
      ])) as McpPromptResult;

      // Parse and return messages
      return parsePromptMessages(result);
    } catch (error) {
      // Emit mcp:error event [IR-1]
      emitExtensionEvent(ctx as any, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: error instanceof Error ? error.message : String(error),
        prompt: prompt.name,
      });

      // Handle error categories (same pattern as resources/tools)
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

        throw createToolError(`prompt_${prompt.name}`, error.message);
      }

      throw createToolError(`prompt_${prompt.name}`, String(error));
    }
  };

  return {
    params,
    fn,
    ...(prompt.description !== undefined && {
      description: prompt.description,
    }),
    returnType: 'list',
  };
}

/**
 * Generates rill host functions for MCP prompts.
 *
 * Applies name sanitization with collision detection and creates
 * HostFunctionDefinition for each prompt.
 *
 * Prompt names are prefixed with "prompt_" to distinguish from other functions.
 *
 * @param prompts - Array of MCP prompts
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to HostFunctionDefinition
 */
export function generatePromptFunctions(
  prompts: McpPrompt[],
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, HostFunctionDefinition> {
  // Prefix prompt names with "prompt_" before sanitization
  const prefixedNames = prompts.map((prompt) => `prompt_${prompt.name}`);

  // Sanitize names with collision detection
  const nameMap = sanitizeNames(prefixedNames);
  const functions: Record<string, HostFunctionDefinition> = {};

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]!;
    const prefixedName = prefixedNames[i]!;
    const sanitizedName = nameMap.get(prefixedName);

    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = createPromptFunction(
      prompt,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
