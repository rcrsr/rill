/**
 * Shared tool loop orchestration for LLM extensions.
 * Implements multi-turn tool calling with error tracking and token aggregation.
 */

import {
  isCallable,
  isDict,
  RuntimeError,
  type RillCallable,
  type RillValue,
} from '@rcrsr/rill';
import type { ToolLoopCallbacks, ToolLoopResult } from './types.js';

// ============================================================
// TOOL EXECUTION
// ============================================================

/**
 * Execute a single tool call with validation and error handling.
 *
 * @param toolName - Name of the tool to execute
 * @param toolInput - Input parameters for the tool
 * @param tools - Rill dict mapping tool names to callable functions
 * @returns Result from tool execution
 * @throws RuntimeError if tool not found or validation fails (EC-15, EC-16)
 */
async function executeToolCall(
  toolName: string,
  toolInput: object,
  tools: RillValue,
  context: unknown
): Promise<RillValue> {
  // EC-15: Tool name not in tool map
  if (!isDict(tools)) {
    throw new RuntimeError(
      'RILL-R004',
      'tools must be a dict mapping tool names to functions'
    );
  }

  const toolsDict = tools as Record<string, RillValue>;
  const toolFn = toolsDict[toolName];

  if (toolFn === undefined || toolFn === null) {
    throw new RuntimeError('RILL-R004', `Unknown tool: ${toolName}`);
  }

  // Validate tool is callable
  if (!isCallable(toolFn)) {
    throw new RuntimeError(
      'RILL-R004',
      `Invalid tool input for ${toolName}: tool must be callable`
    );
  }

  // EC-16: Tool input validation
  if (typeof toolInput !== 'object' || toolInput === null) {
    throw new RuntimeError(
      'RILL-R004',
      `Invalid tool input for ${toolName}: input must be an object`
    );
  }

  const callable = toolFn;

  // Only RuntimeCallable and ApplicationCallable have .fn property
  if (callable.kind !== 'runtime' && callable.kind !== 'application') {
    throw new RuntimeError(
      'RILL-R004',
      `Invalid tool input for ${toolName}: tool must be application or runtime callable`
    );
  }

  try {
    // Convert dict input to positional args using param metadata
    // LLM providers send params as dict, but Rill callables expect positional args
    let args: RillValue[];

    if (callable.kind === 'application' && callable.params) {
      // Extract param order from metadata (added in task 2.1)
      const params = callable.params;
      const inputDict = toolInput as Record<string, RillValue>;
      args = params.map((param) => {
        const value = inputDict[param.name];
        // LLM should provide all params, but use undefined if missing
        // Runtime will handle validation of required params
        return value !== undefined
          ? value
          : (undefined as unknown as RillValue);
      });
    } else {
      // Fallback: No param metadata, pass dict as single arg
      // This preserves backward compatibility with runtime callables
      args = [toolInput as Record<string, RillValue>];
    }

    // Invoke the tool function with positional args and context
    const result = callable.fn(args, context as any);
    return result instanceof Promise ? await result : result;
  } catch (error: unknown) {
    // Re-throw RuntimeErrors directly
    if (error instanceof RuntimeError) {
      throw error;
    }

    // Wrap other errors
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new RuntimeError(
      'RILL-R004',
      `Invalid tool input for ${toolName}: ${message}`
    );
  }
}

// ============================================================
// ORCHESTRATION
// ============================================================

/**
 * Execute tool calling loop with LLM provider.
 *
 * Supports multi-turn tool execution. Continues calling the provider API until
 * no tool calls are returned or maxTurns is reached.
 *
 * @param messages - Provider-specific message format (validated by caller)
 * @param tools - Rill dict mapping tool names to callable functions
 * @param maxErrors - Maximum consecutive tool execution errors before halting
 * @param callbacks - Provider-specific hooks (buildTools, callAPI, extractToolCalls, formatToolResult)
 * @param emitEvent - Event emission function for observability
 * @param maxTurns - Maximum number of turns in the tool loop (default: 10)
 * @returns Final response, executed tool calls, and aggregated token usage
 * @throws RuntimeError if consecutive errors exceed maxErrors (EC-14)
 * @throws RuntimeError if provider callAPI throws (EC-17, wrapped generically)
 *
 * @example
 * ```typescript
 * const result = await executeToolLoop(
 *   messages,
 *   toolsDict,
 *   3,
 *   {
 *     buildTools: (tools) => tools,
 *     callAPI: async (msgs, tools) => provider.call(msgs, tools),
 *     extractToolCalls: (resp) => resp.tool_calls,
 *     formatToolResult: (results) => ({ role: 'tool', content: results }),
 *   },
 *   (event, data) => console.log(event, data),
 *   10
 * );
 * ```
 */
export async function executeToolLoop(
  messages: unknown[],
  tools: RillValue | undefined,
  maxErrors: number,
  callbacks: ToolLoopCallbacks,
  emitEvent: (event: string, data: Record<string, unknown>) => void,
  maxTurns = 10,
  context: unknown = {}
): Promise<ToolLoopResult> {
  // Validate tools parameter
  if (tools === undefined) {
    throw new RuntimeError('RILL-R004', 'tools parameter is required');
  }

  if (!isDict(tools)) {
    throw new RuntimeError(
      'RILL-R004',
      'tools must be a dict mapping tool names to functions'
    );
  }

  const toolsDict = tools as Record<string, unknown>;

  // Build provider-specific tool format
  const toolDescriptors = Object.entries(toolsDict).map(([name, fn]) => {
    const fnValue = fn as RillValue;
    if (!isCallable(fnValue)) {
      throw new RuntimeError(
        'RILL-R004',
        `tool '${name}' must be callable function`
      );
    }

    // Extract metadata from callable if available
    const callable = fnValue as RillCallable;
    const description =
      callable.kind === 'application' && callable.description
        ? callable.description
        : '';

    // Extract parameter metadata and generate JSON Schema
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (callable.kind === 'application' && callable.params) {
      for (const param of callable.params) {
        // Map rill types to JSON Schema types
        let jsonSchemaType: string;
        switch (param.typeName) {
          case 'string':
            jsonSchemaType = 'string';
            break;
          case 'number':
            jsonSchemaType = 'number';
            break;
          case 'bool':
            jsonSchemaType = 'boolean';
            break;
          case 'list':
            jsonSchemaType = 'array';
            break;
          case 'dict':
          case 'vector':
            jsonSchemaType = 'object';
            break;
          case null:
            jsonSchemaType = 'string'; // Default for untyped params
            break;
        }

        // Build property definition
        const property: Record<string, unknown> = {
          type: jsonSchemaType,
        };

        if (param.description) {
          property['description'] = param.description;
        }

        properties[param.name] = property;

        // Add to required if no default value
        if (param.defaultValue === null) {
          required.push(param.name);
        }
      }
    }

    return {
      name,
      description,
      input_schema: {
        type: 'object' as const,
        properties,
        required,
      },
    };
  });

  const providerTools = callbacks.buildTools(toolDescriptors);

  // Initialize loop state
  let consecutiveErrors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const executedToolCalls: Array<{ name: string; result: RillValue }> = [];
  let currentMessages = [...messages];
  let turnCount = 0;

  // Multi-turn loop
  while (turnCount < maxTurns) {
    turnCount++;
    // EC-17: Call provider API with error handling
    let response: unknown;
    try {
      response = await callbacks.callAPI(currentMessages, providerTools);
    } catch (error: unknown) {
      // Wrap provider API errors in RuntimeError
      // Note: Full mapProviderError not used because ProviderErrorDetector
      // is not available in ToolLoopCallbacks interface
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new RuntimeError(
        'RILL-R004',
        `Provider API error: ${message}`,
        undefined,
        { cause: error }
      );
    }

    // Track token usage if available
    if (
      typeof response === 'object' &&
      response !== null &&
      'usage' in response
    ) {
      const usage = (response as Record<string, unknown>)['usage'];
      if (typeof usage === 'object' && usage !== null) {
        const usageRecord = usage as Record<string, unknown>;
        const inputTokens =
          typeof usageRecord['input_tokens'] === 'number'
            ? usageRecord['input_tokens']
            : 0;
        const outputTokens =
          typeof usageRecord['output_tokens'] === 'number'
            ? usageRecord['output_tokens']
            : 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
      }
    }

    // Extract tool calls from response
    const toolCalls = callbacks.extractToolCalls(response);

    // If no tool calls, loop complete
    if (toolCalls === null || toolCalls.length === 0) {
      return {
        response,
        toolCalls: executedToolCalls,
        totalTokens: { input: totalInputTokens, output: totalOutputTokens },
        turns: turnCount,
      };
    }

    // Execute tool calls
    const toolResults: Array<{
      id: string;
      name: string;
      result: RillValue;
      error?: string;
    }> = [];

    for (const toolCall of toolCalls) {
      const { id, name, input } = toolCall;

      emitEvent('tool_call', { tool_name: name, args: input });

      const toolStartTime = Date.now();
      try {
        const result = await executeToolCall(
          name,
          input,
          tools as RillValue,
          context
        );
        const duration = Date.now() - toolStartTime;
        toolResults.push({ id, name, result });
        executedToolCalls.push({ name, result });

        // Reset consecutive errors on success
        consecutiveErrors = 0;

        emitEvent('tool_result', { tool_name: name, duration });
      } catch (error: unknown) {
        const duration = Date.now() - toolStartTime;
        consecutiveErrors++;

        // Capture original error message before RuntimeError wrapping
        // RuntimeError wraps tool errors as "Invalid tool input for {name}: {original}"
        let originalError: string;
        if (error instanceof RuntimeError) {
          // Extract original message from wrapped format
          const prefix = `Invalid tool input for ${name}: `;
          if (error.message.startsWith(prefix)) {
            originalError = error.message.slice(prefix.length);
          } else {
            originalError = error.message;
          }
        } else if (error instanceof Error) {
          originalError = error.message;
        } else {
          originalError = 'Unknown error';
        }

        // Track error in results
        const errorResult: RillValue = originalError;
        toolResults.push({
          id,
          name,
          result: errorResult,
          error: originalError,
        });

        emitEvent('tool_result', {
          tool_name: name,
          error: originalError,
          duration,
        });

        // EC-14: Consecutive errors exceed maxErrors
        if (consecutiveErrors >= maxErrors) {
          throw new RuntimeError(
            'RILL-R004',
            `Tool execution failed: ${maxErrors} consecutive errors`
          );
        }
      }
    }

    // Format tool results into provider-specific message format
    const toolResultMessage = callbacks.formatToolResult(toolResults);

    // Append tool results to message history for next iteration
    currentMessages.push(toolResultMessage);
  }

  // Max turns reached - return final response
  return {
    response: null,
    toolCalls: executedToolCalls,
    totalTokens: { input: totalInputTokens, output: totalOutputTokens },
    turns: turnCount,
  };
}
