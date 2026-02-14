/**
 * Extension factory for Anthropic Claude API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  RuntimeError,
  emitExtensionEvent,
  isCallable,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
  type ApplicationCallable,
  type CallableParam,
} from '@rcrsr/rill';
import {
  validateApiKey,
  validateModel,
  validateTemperature,
  validateEmbedText,
  validateEmbedBatch,
  validateEmbedModel,
  mapProviderError,
  executeToolLoop,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extract text content from Anthropic API response content array.
 *
 * @param content - Content array from API response
 * @returns Concatenated text from all text blocks
 */
function extractTextContent(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('');
}

/**
 * Anthropic-specific error detector for mapProviderError.
 * Extracts status code and message from Anthropic.APIError instances.
 *
 * @param error - Unknown error value
 * @returns Object with status and message if Anthropic error, null otherwise
 */
const detectAnthropicError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof Anthropic.APIError) {
    return {
      status: error.status,
      message: error.message,
    };
  }
  return null;
};

/**
 * Wrap shared validation to convert RILL-R001 errors to RILL-R004.
 * Extension errors use RILL-R004 code for consistency with existing behavior.
 *
 * @param fn - Validation function to wrap
 * @returns Wrapped function that throws RILL-R004 errors
 */
function wrapValidation<T extends unknown[]>(
  fn: (...args: T) => void | string[]
): (...args: T) => void | string[] {
  return (...args: T) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof RuntimeError && error.errorId === 'RILL-R001') {
        throw new RuntimeError('RILL-R004', error.message);
      }
      throw error;
    }
  };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Anthropic extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createAnthropicExtension({
 *   api_key: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5-20250929',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createAnthropicExtension(
  config: AnthropicExtensionConfig
): ExtensionResult {
  // Validate required fields
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  const client = new Anthropic({
    apiKey: config.api_key,
    baseURL: config.base_url,
    maxRetries: config.max_retries,
    timeout: config.timeout,
  });

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;

  // Dispose function for cleanup (§4.9)
  const dispose = async (): Promise<void> => {
    // AC-28: Idempotent cleanup, try-catch each step
    try {
      // Cleanup SDK HTTP connections
      // Note: @anthropic-ai/sdk doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern and future SDK versions
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Anthropic SDK: ${message}`);
    }
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-4: anthropic::message
    message: {
      params: [
        { name: 'text', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const text = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // EC-5: Validate text is non-empty
          if (text.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
          }

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;

          // Call Anthropic API
          const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'user',
                content: text,
              },
            ],
          };

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }
          if (system !== undefined) {
            apiParams.system = system;
          }

          const response = await client.messages.create(apiParams);

          // Extract text content from response
          const content = extractTextContent(
            response.content as Array<{ type: string; text?: string }>
          );

          // Build normalized response dict (§3.2)
          const result = {
            content,
            model: response.model,
            usage: {
              input: response.usage.input_tokens,
              output: response.usage.output_tokens,
            },
            stop_reason: response.stop_reason,
            id: response.id,
            messages: [
              { role: 'user', content: text },
              { role: 'assistant', content },
            ],
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:message',
            subsystem: 'extension:anthropic',
            duration,
            model: response.model,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapProviderError(
            'Anthropic',
            error,
            detectAnthropicError
          );

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send single message to Claude API',
      returnType: 'dict',
    },

    // IR-5: anthropic::messages
    messages: {
      params: [
        { name: 'messages', type: 'list' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const messages = args[0] as Array<Record<string, unknown>>;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // AC-23: Empty messages list raises error
          if (messages.length === 0) {
            throw new RuntimeError(
              'RILL-R004',
              'messages list cannot be empty'
            );
          }

          // Transform and validate messages to Anthropic format
          const apiMessages: Anthropic.MessageParam[] = [];

          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]!;

            // EC-10: Missing role raises error
            if (!msg || typeof msg !== 'object' || !('role' in msg)) {
              throw new RuntimeError(
                'RILL-R004',
                "message missing required 'role' field"
              );
            }

            const role = msg['role'];

            // EC-11: Unknown role value raises error
            if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
              throw new RuntimeError('RILL-R004', `invalid role '${role}'`);
            }

            // EC-12: User message missing content
            if (role === 'user' || role === 'tool') {
              if (!('content' in msg) || typeof msg['content'] !== 'string') {
                throw new RuntimeError(
                  'RILL-R004',
                  `${role} message requires 'content'`
                );
              }
              apiMessages.push({
                role: role as 'user',
                content: msg['content'] as string,
              });
            }
            // EC-13: Assistant missing both content and tool_calls
            else if (role === 'assistant') {
              const hasContent = 'content' in msg && msg['content'];
              const hasToolCalls = 'tool_calls' in msg && msg['tool_calls'];

              if (!hasContent && !hasToolCalls) {
                throw new RuntimeError(
                  'RILL-R004',
                  "assistant message requires 'content' or 'tool_calls'"
                );
              }

              // For now, we only support content (tool_calls handled in task 2.6)
              if (hasContent) {
                apiMessages.push({
                  role: 'assistant',
                  content: msg['content'] as string,
                });
              }
            }
          }

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;

          // Call Anthropic API
          const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: maxTokens,
            messages: apiMessages,
          };

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }
          if (system !== undefined) {
            apiParams.system = system;
          }

          const response = await client.messages.create(apiParams);

          // Extract text content from response
          const content = extractTextContent(
            response.content as Array<{ type: string; text?: string }>
          );

          // Build full conversation history (§3.2)
          const fullMessages = [
            ...messages.map((m) => ({
              role: m['role'] as string,
              content: m['content'] as string,
            })),
            { role: 'assistant', content },
          ];

          // Build normalized response dict (§3.2)
          const result = {
            content,
            model: response.model,
            usage: {
              input: response.usage.input_tokens,
              output: response.usage.output_tokens,
            },
            stop_reason: response.stop_reason,
            id: response.id,
            messages: fullMessages,
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:messages',
            subsystem: 'extension:anthropic',
            duration,
            model: response.model,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapProviderError(
            'Anthropic',
            error,
            detectAnthropicError
          );

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send multi-turn conversation to Claude API',
      returnType: 'dict',
    },

    // IR-6: anthropic::embed
    embed: {
      params: [{ name: 'text', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract argument
          const text = args[0] as string;

          // Validate using shared validation functions (wrapped to use RILL-R004)
          wrapValidation(validateEmbedText)(text);
          wrapValidation(validateEmbedModel)(factoryEmbedModel);

          // NOTE: Anthropic does not currently provide a public embeddings API.
          // This implementation is prepared for when/if the API becomes available.
          // The spec requires these functions, so we implement the interface.
          // For now, this will raise an error indicating unsupported operation.
          throw new RuntimeError(
            'RILL-R004',
            'Anthropic: embeddings API not available'
          );

          // Future implementation when API available:
          // Import createVector from '@rcrsr/rill' at top of file
          // const response = await client.embeddings.create({
          //   model: factoryEmbedModel,
          //   input: text,
          // });
          //
          // const vector = createVector(
          //   new Float32Array(response.embedding),
          //   factoryEmbedModel
          // );
          //
          // const duration = Date.now() - startTime;
          // emitExtensionEvent(ctx as RuntimeContext, {
          //   event: 'anthropic:embed',
          //   subsystem: 'extension:anthropic',
          //   duration,
          //   model: factoryEmbedModel,
          //   dimensions: response.embedding.length,
          // });
          //
          // return vector as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;

          // If already a RuntimeError, use it directly (validation errors)
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vector for text',
      returnType: 'vector',
    },

    // IR-7: anthropic::embed_batch
    embed_batch: {
      params: [{ name: 'texts', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract argument
          const texts = args[0] as RillValue[];

          // AC-24: Empty list returns empty list without API call
          if (texts.length === 0) {
            return [] as RillValue;
          }

          // Validate using shared validation functions (wrapped to use RILL-R004)
          wrapValidation(validateEmbedBatch)(texts);
          wrapValidation(validateEmbedModel)(factoryEmbedModel);

          // NOTE: Anthropic does not currently provide a public embeddings API.
          // This implementation is prepared for when/if the API becomes available.
          throw new RuntimeError(
            'RILL-R004',
            'Anthropic: embeddings API not available'
          );

          // Future implementation when API available:
          // Import createVector from '@rcrsr/rill' at top of file
          // const response = await client.embeddings.createBatch({
          //   model: factoryEmbedModel,
          //   input: texts as string[],
          // });
          //
          // const vectors = response.embeddings.map((embedding: number[]) =>
          //   createVector(new Float32Array(embedding), factoryEmbedModel)
          // );
          //
          // const duration = Date.now() - startTime;
          // emitExtensionEvent(ctx as RuntimeContext, {
          //   event: 'anthropic:embed_batch',
          //   subsystem: 'extension:anthropic',
          //   duration,
          //   model: factoryEmbedModel,
          //   dimensions: response.embeddings[0]?.length ?? 0,
          //   count: vectors.length,
          // });
          //
          // return vectors as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;

          // If already a RuntimeError, use it directly (validation errors)
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vectors for multiple texts',
      returnType: 'list',
    },

    // IR-8: anthropic::tool_loop
    tool_loop: {
      params: [
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const prompt = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // EC-22: Empty prompt raises error
          if (prompt.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
          }

          // EC-23: Missing tools in options raises error
          if (!('tools' in options) || !Array.isArray(options['tools'])) {
            throw new RuntimeError(
              'RILL-R004',
              "tool_loop requires 'tools' option"
            );
          }

          const toolDescriptors = options['tools'] as Array<
            Record<string, unknown>
          >;

          // Convert tool descriptors array to dict for shared tool loop
          const toolsDict: Record<string, RillValue> = {};
          for (const descriptor of toolDescriptors) {
            const name =
              typeof descriptor['name'] === 'string'
                ? descriptor['name']
                : null;

            if (!name) {
              throw new RuntimeError(
                'RILL-R004',
                'tool descriptor missing name'
              );
            }

            const toolFnValue = descriptor['fn'] as RillValue;
            if (!toolFnValue) {
              throw new RuntimeError(
                'RILL-R004',
                `tool '${name}' missing fn property`
              );
            }

            // Validate tool is callable
            if (!isCallable(toolFnValue)) {
              throw new RuntimeError(
                'RILL-R004',
                `tool '${name}' fn must be callable`
              );
            }

            // Extract params metadata from descriptor and enhance callable
            const paramsObj = descriptor['params'];
            const description =
              typeof descriptor['description'] === 'string'
                ? descriptor['description']
                : '';

            let enhancedCallable: RillValue = toolFnValue;

            if (
              paramsObj &&
              typeof paramsObj === 'object' &&
              !Array.isArray(paramsObj)
            ) {
              // Convert params object to CallableParam[] format
              const params: CallableParam[] = Object.entries(
                paramsObj as Record<string, unknown>
              ).map(([paramName, paramMeta]) => {
                const meta = paramMeta as Record<string, unknown>;
                const typeStr =
                  typeof meta['type'] === 'string' ? meta['type'] : null;

                // Map type string to RillTypeName
                let typeName:
                  | 'string'
                  | 'number'
                  | 'bool'
                  | 'list'
                  | 'dict'
                  | 'vector'
                  | null = null;
                if (typeStr === 'string') typeName = 'string';
                else if (typeStr === 'number') typeName = 'number';
                else if (typeStr === 'bool' || typeStr === 'boolean')
                  typeName = 'bool';
                else if (typeStr === 'list' || typeStr === 'array')
                  typeName = 'list';
                else if (typeStr === 'dict' || typeStr === 'object')
                  typeName = 'dict';
                else if (typeStr === 'vector') typeName = 'vector';

                const param: CallableParam = {
                  name: paramName,
                  typeName,
                  defaultValue: null,
                  annotations: {},
                };
                // Add description only if it exists (optional property)
                if (typeof meta['description'] === 'string') {
                  (param as { description?: string }).description =
                    meta['description'];
                }
                return param;
              });

              // Create enhanced ApplicationCallable with params metadata
              const baseCallable = toolFnValue as ApplicationCallable;
              enhancedCallable = {
                __type: 'callable',
                kind: 'application' as const,
                params,
                fn: baseCallable.fn,
                description,
                isProperty: baseCallable.isProperty ?? false,
              } as ApplicationCallable;
            }

            toolsDict[name] = enhancedCallable;
          }

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;
          const maxErrors =
            typeof options['max_errors'] === 'number'
              ? options['max_errors']
              : 3;
          const maxTurns =
            typeof options['max_turns'] === 'number'
              ? options['max_turns']
              : 10;

          // Initialize conversation with prepended messages if provided
          const messages: Anthropic.MessageParam[] = [];

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<
              Record<string, unknown>
            >;

            for (const msg of prependedMessages) {
              if (!msg || typeof msg !== 'object' || !('role' in msg)) {
                throw new RuntimeError(
                  'RILL-R004',
                  "message missing required 'role' field"
                );
              }

              const role = msg['role'];
              if (role !== 'user' && role !== 'assistant') {
                throw new RuntimeError('RILL-R004', `invalid role '${role}'`);
              }

              if (!('content' in msg) || typeof msg['content'] !== 'string') {
                throw new RuntimeError(
                  'RILL-R004',
                  `${role} message requires 'content'`
                );
              }

              messages.push({
                role: role as 'user' | 'assistant',
                content: msg['content'] as string,
              });
            }
          }

          // Add the prompt as initial user message
          messages.push({
            role: 'user',
            content: prompt,
          });

          // Define Anthropic-specific callbacks for shared tool loop
          const callbacks: ToolLoopCallbacks = {
            // Build Anthropic Tool format from tool definitions
            buildTools: (
              toolDefs: Array<{
                name: string;
                description: string;
                input_schema: object;
              }>
            ): Anthropic.Tool[] => {
              return toolDefs.map((def) => ({
                name: def.name,
                description: def.description,
                input_schema: def.input_schema as Anthropic.Tool.InputSchema,
              }));
            },

            // Call Anthropic API
            callAPI: async (
              msgs: unknown[],
              tools: unknown
            ): Promise<unknown> => {
              const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
                model: factoryModel,
                max_tokens: maxTokens,
                messages: msgs as Anthropic.MessageParam[],
                tools: tools as Anthropic.Tool[],
              };

              if (factoryTemperature !== undefined) {
                apiParams.temperature = factoryTemperature;
              }
              if (system !== undefined) {
                apiParams.system = system;
              }

              return await client.messages.create(apiParams);
            },

            // Extract tool calls from Anthropic response
            extractToolCalls: (
              response: unknown
            ): Array<{ id: string; name: string; input: object }> | null => {
              if (
                !response ||
                typeof response !== 'object' ||
                !('content' in response)
              ) {
                return null;
              }

              const content = (response as { content: unknown[] }).content;
              if (!Array.isArray(content)) {
                return null;
              }

              const toolUseBlocks = content.filter(
                (block): block is Anthropic.ToolUseBlock =>
                  typeof block === 'object' &&
                  block !== null &&
                  'type' in block &&
                  block.type === 'tool_use'
              );

              if (toolUseBlocks.length === 0) {
                return null;
              }

              return toolUseBlocks.map((block) => ({
                id: block.id,
                name: block.name,
                input: block.input as object,
              }));
            },

            // Format tool results into Anthropic message format
            formatToolResult: (
              toolResults: Array<{
                id: string;
                name: string;
                result: RillValue;
                error?: string;
              }>
            ): unknown => {
              // Convert tool results to Anthropic tool_result content blocks
              const content: Anthropic.ToolResultBlockParam[] = toolResults.map(
                (tr) => ({
                  type: 'tool_result' as const,
                  tool_use_id: tr.id,
                  content: tr.error
                    ? `Error: ${tr.error}`
                    : JSON.stringify(tr.result),
                  is_error: tr.error !== undefined,
                })
              );

              // Return user message with tool results
              return {
                role: 'user' as const,
                content,
              };
            },
          };

          // Execute shared tool loop
          const loopResult = await executeToolLoop(
            messages,
            toolsDict as RillValue,
            maxErrors,
            callbacks,
            (event: string, data: Record<string, unknown>) => {
              // Map shared events to Anthropic-specific events
              const eventMap: Record<string, string> = {
                tool_call: 'anthropic:tool_call',
                tool_result: 'anthropic:tool_result',
              };

              emitExtensionEvent(ctx as RuntimeContext, {
                event: eventMap[event] || event,
                subsystem: 'extension:anthropic',
                ...data,
              });
            },
            maxTurns,
            ctx
          );

          // Extract response data
          const response = loopResult.response as Anthropic.Message | null;
          const content = response
            ? extractTextContent(
                response.content as Array<{ type: string; text?: string }>
              )
            : '';

          const result = {
            content,
            model: response ? response.model : factoryModel,
            usage: loopResult.totalTokens,
            stop_reason: response ? response.stop_reason : 'max_turns',
            turns: loopResult.turns,
            messages: messages.map((m) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            })),
          };

          // Emit tool_loop event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:tool_loop',
            subsystem: 'extension:anthropic',
            turns: result.turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Execute tool-use loop with Claude API',
      returnType: 'dict',
    },
  };

  // IR-11: Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
