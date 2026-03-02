/**
 * Shared tool loop orchestration for LLM extensions.
 * Implements multi-turn tool calling with error tracking and token aggregation.
 */

import {
  invokeCallable,
  isCallable,
  isDict,
  RuntimeError,
  type RillCallable,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { ToolLoopCallbacks, ToolLoopResult } from './types.js';
import { buildJsonSchema } from './schema.js';

// Minimal context interface compatible with CallableFn signature
// Matches RuntimeContextLike from @rcrsr/rill's callable.ts
interface RuntimeContextLike {
  readonly parent?: RuntimeContextLike | undefined;
  readonly variables: Map<string, RillValue>;
  pipeValue: RillValue;
}

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
  context?: RuntimeContextLike
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

  // ScriptCallable has no .fn property — requires invokeCallable with a full RuntimeContext.
  // RuntimeCallable and ApplicationCallable use .fn directly and only need RuntimeContextLike.
  if (
    callable.kind !== 'runtime' &&
    callable.kind !== 'application' &&
    callable.kind !== 'script'
  ) {
    throw new RuntimeError(
      'RILL-R004',
      `Invalid tool input for ${toolName}: tool must be application, runtime, or script callable`
    );
  }

  try {
    // Convert dict input to positional args using param metadata
    // LLM providers send params as dict, but Rill callables expect positional args
    let args: RillValue[];

    if (
      (callable.kind === 'application' || callable.kind === 'script') &&
      callable.params &&
      callable.params.length > 0
    ) {
      // Extract param order from metadata
      // Works for both ApplicationCallable (host fns) and ScriptCallable (closures)
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

    // Invoke the tool with its arguments.
    // ScriptCallable requires a full RuntimeContext via invokeCallable.
    // Runtime/Application callables use .fn with the minimal context.
    if (callable.kind === 'script') {
      if (!context) {
        throw new RuntimeError(
          'RILL-R004',
          `Invalid tool input for ${toolName}: script callable requires a runtime context`
        );
      }
      return await invokeCallable(callable, args, context as RuntimeContext);
    }

    // If no context provided, create minimal context-like object for callable signature
    const ctx: RuntimeContextLike = context ?? {
      parent: undefined,
      variables: new Map<string, RillValue>(),
      pipeValue: null,
    };
    const result = callable.fn(args, ctx);
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
  context?: RuntimeContextLike
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
    let inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };

    if (
      (callable.kind === 'application' || callable.kind === 'script') &&
      callable.params &&
      callable.params.length > 0
    ) {
      // Build a descriptor dict for buildJsonSchema.
      // null typeName means untyped param; use 'string' as fallback.
      // Works for both ApplicationCallable (host fns) and ScriptCallable (closures).
      const descriptor: Record<string, unknown> = {};
      const paramsWithDefaults = new Set<string>();

      for (const param of callable.params) {
        const typeEntry: Record<string, unknown> = {
          type: param.typeName ?? 'string',
        };
        if (param.description) {
          typeEntry['description'] = param.description;
        }
        descriptor[param.name] = typeEntry;

        if (param.defaultValue !== null) {
          paramsWithDefaults.add(param.name);
        }
      }

      // buildJsonSchema puts ALL keys in required; filter out params with defaults
      const schema = buildJsonSchema(descriptor);
      const required = schema.required.filter(
        (name) => !paramsWithDefaults.has(name)
      );

      inputSchema = {
        type: 'object',
        properties: schema.properties as Record<string, unknown>,
        required,
      };
    } else {
      inputSchema = { type: 'object', properties: {}, required: [] };
    }

    return {
      name,
      description,
      input_schema: inputSchema,
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
            `Tool execution failed: ${maxErrors} consecutive errors (last: ${name}: ${originalError})`
          );
        }
      }
    }

    // Append assistant message (with tool calls) to history
    const assistantMessage = callbacks.formatAssistantMessage(response);
    if (assistantMessage != null) {
      currentMessages.push(assistantMessage);
    }

    // Format tool results into provider-specific message format
    const toolResultMessage = callbacks.formatToolResult(toolResults);

    // Append tool results — handle both single message and array of messages
    if (Array.isArray(toolResultMessage)) {
      currentMessages.push(...toolResultMessage);
    } else {
      currentMessages.push(toolResultMessage);
    }
  }

  // Max turns reached - return final response
  return {
    response: null,
    toolCalls: executedToolCalls,
    totalTokens: { input: totalInputTokens, output: totalOutputTokens },
    turns: turnCount,
  };
}
