/**
 * Extension factory for Anthropic Claude API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  RuntimeError,
  emitExtensionEvent,
  isCallable,
  isDict,
  type ExtensionResult,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { AnthropicExtensionConfig } from './types.js';

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
 * Serialize RillValue to string for tool result.
 *
 * @param value - Value to serialize
 * @returns String representation suitable for API
 */
function serializeValue(value: RillValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '';

  // For objects (dicts, lists, tuples, etc.), use JSON
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Map Anthropic API error to RuntimeError with appropriate message.
 *
 * @param error - Error from Anthropic SDK
 * @returns RuntimeError with appropriate message
 */
function mapAnthropicError(error: unknown): RuntimeError {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const message = error.message;

    if (status === 401) {
      return new RuntimeError(
        'RILL-R004',
        `Anthropic: authentication failed (401)`
      );
    }

    if (status === 429) {
      return new RuntimeError('RILL-R004', `Anthropic: rate limit`);
    }

    if (status && status >= 400) {
      return new RuntimeError('RILL-R004', `Anthropic: ${message} (${status})`);
    }

    return new RuntimeError('RILL-R004', `Anthropic: ${message}`);
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return new RuntimeError('RILL-R004', 'Anthropic: request timeout');
    }
    return new RuntimeError('RILL-R004', `Anthropic: ${error.message}`);
  }

  return new RuntimeError('RILL-R004', 'Anthropic: unknown error');
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
          const rillError = mapAnthropicError(error);

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

          // Validate and transform messages
          const apiMessages: Anthropic.MessageParam[] = [];

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
          const rillError = mapAnthropicError(error);

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

          // EC-15: Empty text raises error
          if (text.length === 0) {
            throw new RuntimeError('RILL-R004', 'embed text cannot be empty');
          }

          // EC-16: No embed_model configured raises error
          if (!factoryEmbedModel) {
            throw new RuntimeError('RILL-R004', 'embed_model not configured');
          }

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
            error instanceof RuntimeError ? error : mapAnthropicError(error);

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

          // EC-18: Non-string element raises error
          // EC-19: Empty string element raises error
          for (let i = 0; i < texts.length; i++) {
            if (typeof texts[i] !== 'string') {
              throw new RuntimeError(
                'RILL-R004',
                'embed_batch requires list of strings'
              );
            }
            if ((texts[i] as string).length === 0) {
              throw new RuntimeError(
                'RILL-R004',
                `embed text cannot be empty at index ${i}`
              );
            }
          }

          // EC-20: No embed_model configured raises error
          if (!factoryEmbedModel) {
            throw new RuntimeError('RILL-R004', 'embed_model not configured');
          }

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
            error instanceof RuntimeError ? error : mapAnthropicError(error);

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

          // Build tool name to descriptor map for lookup
          const toolMap = new Map<string, Record<string, unknown>>();
          const anthropicTools: Anthropic.Tool[] = [];

          for (const descriptor of toolDescriptors) {
            const name =
              typeof descriptor['name'] === 'string'
                ? descriptor['name']
                : null;
            const description =
              typeof descriptor['description'] === 'string'
                ? descriptor['description']
                : '';
            const paramsValue = descriptor['params'] as RillValue;
            const params = isDict(paramsValue)
              ? (paramsValue as Record<string, unknown>)
              : {};

            if (!name) {
              throw new RuntimeError(
                'RILL-R004',
                'tool descriptor missing name'
              );
            }

            toolMap.set(name, descriptor);

            // Convert rill params to JSON Schema
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const [paramName, paramDef] of Object.entries(params)) {
              const paramDefValue = paramDef as RillValue;
              const paramDict = isDict(paramDefValue)
                ? (paramDefValue as Record<string, unknown>)
                : null;
              if (!paramDict) continue;

              const paramType =
                typeof paramDict['type'] === 'string'
                  ? paramDict['type']
                  : 'string';
              const paramDesc =
                typeof paramDict['description'] === 'string'
                  ? paramDict['description']
                  : '';

              // Map rill type to JSON Schema type
              const jsonSchemaType =
                paramType === 'number'
                  ? 'number'
                  : paramType === 'bool'
                    ? 'boolean'
                    : paramType === 'list'
                      ? 'array'
                      : paramType === 'dict'
                        ? 'object'
                        : 'string';

              properties[paramName] = {
                type: jsonSchemaType,
                description: paramDesc,
              };

              // All params are required (no default value support in tool descriptors)
              required.push(paramName);
            }

            anthropicTools.push({
              name,
              description,
              input_schema: {
                type: 'object',
                properties,
                required,
              },
            });
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
          const maxTurns =
            typeof options['max_turns'] === 'number'
              ? options['max_turns']
              : undefined;
          const maxErrors =
            typeof options['max_errors'] === 'number'
              ? options['max_errors']
              : 3;

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

          // Initialize loop state
          let turns = 0;
          let consecutiveErrors = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let stopReason: string | null = null;

          // Tool-use loop
          while (true) {
            // Check max_turns limit BEFORE making API call
            if (maxTurns !== undefined && turns >= maxTurns) {
              stopReason = 'max_turns';
              break;
            }

            turns++;

            // Call Anthropic API
            const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
              model: factoryModel,
              max_tokens: maxTokens,
              messages: [...messages], // Copy array to avoid mutation issues in tests
              tools: anthropicTools,
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }
            if (system !== undefined) {
              apiParams.system = system;
            }

            const response = await client.messages.create(apiParams);

            // Accumulate token usage
            totalInputTokens += response.usage.input_tokens;
            totalOutputTokens += response.usage.output_tokens;

            // Add assistant response to messages
            messages.push({
              role: 'assistant',
              content: response.content,
            });

            // Check stop reason
            stopReason = response.stop_reason;

            // Find tool_use blocks
            const toolUseBlocks = response.content.filter(
              (block): block is Anthropic.ToolUseBlock =>
                block.type === 'tool_use'
            );

            // AC-26: If no tool calls, return immediately
            if (toolUseBlocks.length === 0) {
              // Extract text content
              const content = extractTextContent(
                response.content as Array<{ type: string; text?: string }>
              );

              const result = {
                content,
                model: response.model,
                usage: {
                  input: totalInputTokens,
                  output: totalOutputTokens,
                },
                stop_reason: stopReason,
                turns,
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
                turns,
                total_duration: duration,
                usage: result.usage,
              });

              return result as RillValue;
            }

            // EC-24: Validate all tools exist before executing (unknown tool is fatal error)
            for (const toolUse of toolUseBlocks) {
              if (!toolMap.has(toolUse.name)) {
                throw new RuntimeError(
                  'RILL-R004',
                  `unknown tool '${toolUse.name}'`
                );
              }
            }

            // Execute tool calls (potentially in parallel)
            const toolResultBlocks: Anthropic.ToolResultBlockParam[] =
              await Promise.all(
                toolUseBlocks.map(async (toolUse) => {
                  const toolCallStartTime = Date.now();
                  const toolName = toolUse.name;
                  const toolArgs = toolUse.input as Record<string, unknown>;

                  // Emit tool_call event
                  emitExtensionEvent(ctx as RuntimeContext, {
                    event: 'anthropic:tool_call',
                    subsystem: 'extension:anthropic',
                    tool_name: toolName,
                    args: toolArgs,
                  });

                  try {
                    // Get descriptor (already validated above)
                    const descriptor = toolMap.get(toolName)!;

                    const toolFnValue = descriptor['fn'] as RillValue;
                    if (!isCallable(toolFnValue)) {
                      throw new RuntimeError(
                        'RILL-R004',
                        `tool '${toolName}' missing callable fn`
                      );
                    }

                    // Convert tool args to array for callable invocation
                    const paramsValue = descriptor['params'] as RillValue;
                    const params = isDict(paramsValue)
                      ? (paramsValue as Record<string, unknown>)
                      : {};
                    const argArray: RillValue[] = [];

                    for (const paramName of Object.keys(params)) {
                      argArray.push((toolArgs[paramName] ?? null) as RillValue);
                    }

                    // Invoke tool closure (only RuntimeCallable and ApplicationCallable have .fn)
                    let result: RillValue;
                    if (
                      toolFnValue.kind === 'runtime' ||
                      toolFnValue.kind === 'application'
                    ) {
                      const fnResult = toolFnValue.fn(
                        argArray,
                        ctx as RuntimeContext
                      );
                      result =
                        fnResult instanceof Promise ? await fnResult : fnResult;
                    } else {
                      // ScriptCallable needs special handling - not supported in tool_loop
                      throw new RuntimeError(
                        'RILL-R004',
                        `tool '${toolName}' must be host function or runtime callable`
                      );
                    }

                    // Reset consecutive errors on success
                    consecutiveErrors = 0;

                    // Emit tool_result event
                    const duration = Date.now() - toolCallStartTime;
                    emitExtensionEvent(ctx as RuntimeContext, {
                      event: 'anthropic:tool_result',
                      subsystem: 'extension:anthropic',
                      tool_name: toolName,
                      duration,
                    });

                    // Return tool result (serialize to string)
                    return {
                      type: 'tool_result' as const,
                      tool_use_id: toolUse.id,
                      content: serializeValue(result),
                    };
                  } catch (error: unknown) {
                    consecutiveErrors++;

                    // Format error for LLM
                    const errorMessage =
                      error instanceof Error ? error.message : 'Unknown error';
                    const errorCode =
                      error instanceof RuntimeError
                        ? error.errorId
                        : 'RILL-R001';

                    // Emit tool_result event with error
                    const duration = Date.now() - toolCallStartTime;
                    emitExtensionEvent(ctx as RuntimeContext, {
                      event: 'anthropic:tool_result',
                      subsystem: 'extension:anthropic',
                      tool_name: toolName,
                      duration,
                      error: errorMessage,
                    });

                    // Return error as tool result
                    return {
                      type: 'tool_result' as const,
                      tool_use_id: toolUse.id,
                      content: JSON.stringify({
                        error: errorMessage,
                        code: errorCode,
                      }),
                      is_error: true,
                    };
                  }
                })
              );

            // EC-25: max_errors exceeded aborts loop
            if (consecutiveErrors >= maxErrors) {
              throw new RuntimeError(
                'RILL-R004',
                `tool loop aborted after ${consecutiveErrors} consecutive errors`
              );
            }

            // Add tool results to messages
            messages.push({
              role: 'user',
              content: toolResultBlocks,
            });

            // Continue loop for next turn
          }

          // Loop exited due to max_turns
          const content = extractTextContent(
            (messages[messages.length - 1]?.content ?? []) as Array<{
              type: string;
              text?: string;
            }>
          );

          const result = {
            content,
            model: factoryModel,
            usage: {
              input: totalInputTokens,
              output: totalOutputTokens,
            },
            stop_reason: stopReason,
            turns,
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
            turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError =
            error instanceof RuntimeError ? error : mapAnthropicError(error);

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
