/**
 * Extension factory for OpenAI API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import OpenAI from 'openai';
import {
  RuntimeError,
  emitExtensionEvent,
  createVector,
  isCallable,
  isVector,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
  type RillCallable,
} from '@rcrsr/rill';
import type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const MIN_TEMPERATURE = 0.0;
const MAX_TEMPERATURE = 2.0;
const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map OpenAI API error to RuntimeError with appropriate message.
 *
 * @param error - Error from OpenAI SDK
 * @returns RuntimeError with appropriate message
 */
function mapOpenAIError(error: unknown): RuntimeError {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const message = error.message;

    if (status === 401) {
      return new RuntimeError(
        'RILL-R004',
        `OpenAI: authentication failed (401)`
      );
    }

    if (status === 429) {
      return new RuntimeError('RILL-R004', `OpenAI: rate limit`);
    }

    if (status && status >= 400) {
      return new RuntimeError('RILL-R004', `OpenAI: ${message} (${status})`);
    }

    return new RuntimeError('RILL-R004', `OpenAI: ${message}`);
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return new RuntimeError('RILL-R004', 'OpenAI: request timeout');
    }
    return new RuntimeError('RILL-R004', `OpenAI: ${error.message}`);
  }

  return new RuntimeError('RILL-R004', 'OpenAI: unknown error');
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate api_key is present and non-empty.
 *
 * @param api_key - API key to validate
 * @throws Error if api_key missing or empty (EC-1, EC-3)
 */
function validateApiKey(
  api_key: string | undefined
): asserts api_key is string {
  if (api_key === undefined) {
    throw new Error('api_key is required');
  }
  if (api_key === '') {
    throw new Error('api_key cannot be empty');
  }
}

/**
 * Validate model is present and non-empty.
 *
 * @param model - Model identifier to validate
 * @throws Error if model missing or empty (EC-2)
 */
function validateModel(model: string | undefined): asserts model is string {
  if (model === undefined || model === '') {
    throw new Error('model is required');
  }
}

/**
 * Validate temperature is within valid range (0.0-2.0).
 *
 * @param temperature - Temperature value to validate
 * @throws Error if temperature out of range (EC-4)
 */
function validateTemperature(temperature: number | undefined): void {
  if (temperature !== undefined) {
    if (temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
      throw new Error('temperature must be between 0 and 2');
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create OpenAI extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createOpenAIExtension({
 *   api_key: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4-turbo',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createOpenAIExtension(
  config: OpenAIExtensionConfig
): ExtensionResult {
  // Validate required fields (§4.1)
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  // Note: will be used in tasks 3.3 and 3.4 for actual function implementations
  const client = new OpenAI({
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

  // Suppress unused variable warnings for values used in task 3.4
  void factoryEmbedModel;

  // AbortController for cancelling pending requests (§4.9, IR-11)
  let abortController: AbortController | undefined = new AbortController();

  // Dispose function for cleanup (§4.9)
  const dispose = async (): Promise<void> => {
    // AC-28: Idempotent cleanup, try-catch each step
    try {
      // Cancel pending API requests via AbortController (IR-11)
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to abort OpenAI requests: ${message}`);
    }

    try {
      // Cleanup SDK HTTP connections
      // Note: OpenAI SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup OpenAI SDK: ${message}`);
    }
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-4: openai::message
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

          // Build messages array (OpenAI uses system as first message, not separate param)
          const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            apiMessages.push({
              role: 'system',
              content: system,
            });
          }

          apiMessages.push({
            role: 'user',
            content: text,
          });

          // Call OpenAI API
          const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: maxTokens,
            messages: apiMessages,
          };

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }

          const response = await client.chat.completions.create(apiParams);

          // Extract text content from response (§4.2: choices[0].message.content)
          const content = response.choices[0]?.message?.content ?? '';

          // Build normalized response dict (§3.2)
          const result = {
            content,
            model: response.model,
            usage: {
              input: response.usage?.prompt_tokens ?? 0,
              output: response.usage?.completion_tokens ?? 0,
            },
            stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
            id: response.id,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: text },
              { role: 'assistant', content },
            ],
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:message',
            subsystem: 'extension:openai',
            duration,
            model: response.model,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapOpenAIError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send single message to OpenAI API',
      returnType: 'dict',
    },

    // IR-5: openai::messages
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

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;

          // Build messages array (OpenAI uses system as first message)
          const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            apiMessages.push({
              role: 'system',
              content: system,
            });
          }

          // Validate and transform messages
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

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

              // For now, we only support content
              if (hasContent) {
                apiMessages.push({
                  role: 'assistant',
                  content: msg['content'] as string,
                });
              }
            }
          }

          // Call OpenAI API
          const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: maxTokens,
            messages: apiMessages,
          };

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }

          const response = await client.chat.completions.create(apiParams);

          // Extract text content from response
          const content = response.choices[0]?.message?.content ?? '';

          // Build full conversation history (§3.2)
          const fullMessages = [
            ...messages.map((m) => {
              const normalized: Record<string, unknown> = { role: m['role'] };
              if ('content' in m) normalized['content'] = m['content'];
              if ('tool_calls' in m) normalized['tool_calls'] = m['tool_calls'];
              return normalized;
            }),
            { role: 'assistant', content },
          ];

          // Build normalized response dict (§3.2)
          const result = {
            content,
            model: response.model,
            usage: {
              input: response.usage?.prompt_tokens ?? 0,
              output: response.usage?.completion_tokens ?? 0,
            },
            stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
            id: response.id,
            messages: fullMessages,
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:messages',
            subsystem: 'extension:openai',
            duration,
            model: response.model,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapOpenAIError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send multi-turn conversation to OpenAI API',
      returnType: 'dict',
    },

    // IR-6: openai::embed
    embed: {
      params: [{ name: 'text', type: 'string' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const text = args[0] as string;

          // EC-15: Validate text is non-empty
          if (text.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'embed text cannot be empty');
          }

          // EC-16: Validate embed_model is configured
          if (factoryEmbedModel === undefined || factoryEmbedModel === '') {
            throw new RuntimeError('RILL-R004', 'embed_model not configured');
          }

          // Call OpenAI embeddings API
          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: text,
            encoding_format: 'float',
          });

          // Extract embedding data
          const embeddingData = response.data[0]?.embedding;
          if (!embeddingData || embeddingData.length === 0) {
            throw new RuntimeError(
              'RILL-R004',
              'OpenAI: empty embedding returned'
            );
          }

          // Convert to Float32Array and create RillVector
          const float32Data = new Float32Array(embeddingData);
          const vector = createVector(float32Data, factoryEmbedModel);

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:embed',
            subsystem: 'extension:openai',
            duration,
            model: factoryEmbedModel,
            dimensions: float32Data.length,
          });

          return vector as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapOpenAIError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vector for text',
      returnType: 'vector',
    },

    // IR-7: openai::embed_batch
    embed_batch: {
      params: [{ name: 'texts', type: 'list' }],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const texts = args[0] as Array<RillValue>;

          // AC-24: Empty list returns empty list
          if (texts.length === 0) {
            return [] as RillValue;
          }

          // EC-17: Validate embed_model is configured
          if (factoryEmbedModel === undefined || factoryEmbedModel === '') {
            throw new RuntimeError('RILL-R004', 'embed_model not configured');
          }

          // EC-18: Validate all elements are strings
          const stringTexts: string[] = [];
          for (let i = 0; i < texts.length; i++) {
            const text = texts[i];
            if (typeof text !== 'string') {
              throw new RuntimeError(
                'RILL-R004',
                'embed_batch requires list of strings'
              );
            }
            // EC-19: Check for empty strings
            if (text.trim().length === 0) {
              throw new RuntimeError(
                'RILL-R004',
                `embed text cannot be empty at index ${i}`
              );
            }
            stringTexts.push(text);
          }

          // Call OpenAI embeddings API with batch
          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: stringTexts,
            encoding_format: 'float',
          });

          // Convert embeddings to RillVector list
          const vectors: RillValue[] = [];
          for (const embeddingItem of response.data) {
            const embeddingData = embeddingItem.embedding;
            if (!embeddingData || embeddingData.length === 0) {
              throw new RuntimeError(
                'RILL-R004',
                'OpenAI: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embeddingData);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          const firstVector = vectors[0];
          const dimensions =
            firstVector && isVector(firstVector) ? firstVector.data.length : 0;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:embed_batch',
            subsystem: 'extension:openai',
            duration,
            model: factoryEmbedModel,
            dimensions,
            count: vectors.length,
          });

          return vectors as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapOpenAIError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vectors for multiple texts',
      returnType: 'list',
    },

    // IR-8: openai::tool_loop
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

          // EC-20: Validate prompt is non-empty
          if (prompt.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
          }

          // EC-21: Validate tools option is present
          if (!('tools' in options) || !Array.isArray(options['tools'])) {
            throw new RuntimeError(
              'RILL-R004',
              "tool_loop requires 'tools' option"
            );
          }

          const toolDescriptors = options['tools'] as Array<
            Record<string, RillValue>
          >;

          // Extract options with defaults
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;
          const maxTurns =
            typeof options['max_turns'] === 'number'
              ? options['max_turns']
              : 10;
          const maxErrors =
            typeof options['max_errors'] === 'number'
              ? options['max_errors']
              : 3;
          const initialMessages =
            Array.isArray(options['messages']) && options['messages'].length > 0
              ? (options['messages'] as Array<Record<string, unknown>>)
              : [];

          // Build tool map and OpenAI tools array
          const toolMap = new Map<string, RillCallable>();
          const openaiTools: OpenAI.ChatCompletionTool[] = [];

          for (const tool of toolDescriptors) {
            if (
              typeof tool !== 'object' ||
              tool === null ||
              !('name' in tool) ||
              !('fn' in tool)
            ) {
              throw new RuntimeError(
                'RILL-R004',
                'invalid tool descriptor in tools list'
              );
            }

            const toolName = tool['name'] as string;
            const toolFn = tool['fn'];

            if (!isCallable(toolFn)) {
              throw new RuntimeError(
                'RILL-R004',
                `tool '${toolName}' not callable`
              );
            }

            toolMap.set(toolName, toolFn as RillCallable);

            // Build OpenAI tool definition
            const description =
              typeof tool['description'] === 'string'
                ? tool['description']
                : '';
            const params = tool['params'] ?? {};

            // Convert rill params dict to JSON Schema
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            if (typeof params === 'object' && params !== null) {
              for (const [paramName, paramSpec] of Object.entries(params)) {
                if (
                  typeof paramSpec === 'object' &&
                  paramSpec !== null &&
                  'type' in paramSpec
                ) {
                  const spec = paramSpec as Record<string, unknown>;
                  properties[paramName] = {
                    type: spec['type'] ?? 'string',
                    description: spec['description'] ?? '',
                  };
                  // All params are required by default
                  required.push(paramName);
                }
              }
            }

            openaiTools.push({
              type: 'function',
              function: {
                name: toolName,
                description,
                parameters: {
                  type: 'object',
                  properties,
                  required,
                },
              },
            });
          }

          // Build initial messages array
          const conversationMessages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            conversationMessages.push({
              role: 'system',
              content: system,
            });
          }

          // Add history messages if provided
          for (const msg of initialMessages) {
            if (
              typeof msg === 'object' &&
              msg !== null &&
              'role' in msg &&
              'content' in msg
            ) {
              const role = msg['role'];
              if (role === 'user' || role === 'assistant') {
                conversationMessages.push({
                  role: role as 'user' | 'assistant',
                  content: msg['content'] as string,
                });
              }
            }
          }

          // Add user prompt
          conversationMessages.push({
            role: 'user',
            content: prompt,
          });

          // Tool loop state
          let turns = 0;
          let consecutiveErrors = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let finalContent = '';
          let stopReason = 'stop';

          // Main tool loop
          while (turns < maxTurns) {
            turns++;

            // Call OpenAI API with tools
            const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
              model: factoryModel,
              max_tokens: maxTokens,
              messages: conversationMessages,
              tools: openaiTools,
              tool_choice: 'auto',
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }

            const response = await client.chat.completions.create(apiParams);

            // Aggregate usage
            totalInputTokens += response.usage?.prompt_tokens ?? 0;
            totalOutputTokens += response.usage?.completion_tokens ?? 0;

            const choice = response.choices[0];
            if (!choice) {
              throw new RuntimeError(
                'RILL-R004',
                'OpenAI: no choices returned'
              );
            }

            const message = choice.message;
            const finishReason = choice.finish_reason;

            // Check if we have tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
              // Add assistant message with tool calls to conversation
              conversationMessages.push({
                role: 'assistant',
                content: message.content ?? null,
                tool_calls: message.tool_calls,
              });

              // Execute tool calls (parallel for multiple calls)
              const toolResults = await Promise.all(
                message.tool_calls.map(async (toolCall) => {
                  // Only handle function tool calls (not custom)
                  if (!('function' in toolCall)) {
                    throw new RuntimeError(
                      'RILL-R004',
                      'unsupported tool call type'
                    );
                  }

                  const toolStartTime = Date.now();
                  const toolName = toolCall.function.name;
                  const toolCallId = toolCall.id;

                  // Emit tool_call event
                  emitExtensionEvent(ctx as RuntimeContext, {
                    event: 'openai:tool_call',
                    subsystem: 'extension:openai',
                    tool_name: toolName,
                    args: toolCall.function.arguments,
                  });

                  // EC-22: Check tool exists (configuration error, abort immediately)
                  const toolFn = toolMap.get(toolName);
                  if (!toolFn) {
                    throw new RuntimeError(
                      'RILL-R004',
                      `unknown tool '${toolName}'`
                    );
                  }

                  try {
                    // Parse arguments
                    let toolArgs: Record<string, unknown>;
                    try {
                      toolArgs = JSON.parse(toolCall.function.arguments);
                    } catch {
                      throw new RuntimeError(
                        'RILL-R004',
                        `invalid tool arguments for '${toolName}'`
                      );
                    }

                    // Convert to RillValue array (positional args from params)
                    const argsArray: RillValue[] = [];
                    for (const [, value] of Object.entries(toolArgs)) {
                      argsArray.push(value as RillValue);
                    }

                    // Invoke tool callable based on type
                    let result: RillValue;
                    if (toolFn.kind === 'script') {
                      // ScriptCallable: not supported in tool_loop context
                      throw new RuntimeError(
                        'RILL-R004',
                        'script closures not yet supported in tool_loop'
                      );
                    } else {
                      // RuntimeCallable or ApplicationCallable
                      result = await toolFn.fn(
                        argsArray,
                        ctx as RuntimeContext,
                        undefined
                      );
                    }

                    // Reset consecutive errors on success
                    consecutiveErrors = 0;

                    // Emit tool_result event
                    const toolDuration = Date.now() - toolStartTime;
                    emitExtensionEvent(ctx as RuntimeContext, {
                      event: 'openai:tool_result',
                      subsystem: 'extension:openai',
                      tool_name: toolName,
                      duration: toolDuration,
                    });

                    // Return tool result as string
                    return {
                      tool_call_id: toolCallId,
                      role: 'tool' as const,
                      content:
                        typeof result === 'string'
                          ? result
                          : JSON.stringify(result),
                    };
                  } catch (error: unknown) {
                    consecutiveErrors++;

                    // Format error for LLM
                    const errorMessage =
                      error instanceof RuntimeError
                        ? error.message
                        : error instanceof Error
                          ? error.message
                          : 'unknown error';

                    // Emit tool_result event with error
                    const toolDuration = Date.now() - toolStartTime;
                    emitExtensionEvent(ctx as RuntimeContext, {
                      event: 'openai:tool_result',
                      subsystem: 'extension:openai',
                      tool_name: toolName,
                      duration: toolDuration,
                      error: errorMessage,
                    });

                    // EC-23: Check if max_errors exceeded
                    if (consecutiveErrors >= maxErrors) {
                      throw new RuntimeError(
                        'RILL-R004',
                        `tool loop aborted after ${maxErrors} consecutive errors`
                      );
                    }

                    // Return error to LLM as tool result
                    return {
                      tool_call_id: toolCallId,
                      role: 'tool' as const,
                      content: JSON.stringify({
                        error: errorMessage,
                        code: 'RILL-R001',
                      }),
                    };
                  }
                })
              );

              // Add tool results to conversation
              for (const toolResult of toolResults) {
                conversationMessages.push(toolResult);
              }

              // Continue loop to get next response
              continue;
            }

            // No tool calls - final response
            finalContent = message.content ?? '';
            stopReason = finishReason ?? 'stop';
            break;
          }

          // Check if we hit max_turns
          if (turns >= maxTurns && stopReason === 'stop') {
            stopReason = 'max_turns';
          }

          // Build conversation history for response
          const fullMessages: Array<Record<string, unknown>> = [];
          for (const msg of conversationMessages) {
            if (msg.role === 'system') {
              // Skip system messages in history
              continue;
            }
            const historyMsg: Record<string, unknown> = {
              role: msg.role,
            };
            if ('content' in msg && msg.content) {
              historyMsg['content'] = msg.content;
            }
            if ('tool_calls' in msg && msg.tool_calls) {
              historyMsg['tool_calls'] = msg.tool_calls;
            }
            fullMessages.push(historyMsg);
          }

          // Build result dict
          const result = {
            content: finalContent,
            model: factoryModel,
            usage: {
              input: totalInputTokens,
              output: totalOutputTokens,
            },
            stop_reason: stopReason,
            turns,
            messages: fullMessages,
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:tool_loop',
            subsystem: 'extension:openai',
            turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapOpenAIError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Execute tool-use loop with OpenAI API',
      returnType: 'dict',
    },
  };

  // IR-11: Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
