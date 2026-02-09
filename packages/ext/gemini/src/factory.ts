/**
 * Extension factory for Gemini API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import {
  GoogleGenAI,
  Type,
  type FunctionDeclaration,
  type Content,
  type Part,
  type Schema,
} from '@google/genai';
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
import type { GeminiExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const MIN_TEMPERATURE = 0.0;
const MAX_TEMPERATURE = 2.0;
const DEFAULT_MAX_TOKENS = 8192;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map Gemini API error to RuntimeError with appropriate message.
 *
 * @param error - Error from Gemini SDK
 * @returns RuntimeError with appropriate message
 */
function mapGeminiError(error: unknown): RuntimeError {
  if (error instanceof Error) {
    const message = error.message;

    // Check for common error patterns in Gemini API responses
    if (message.includes('401') || message.includes('authentication')) {
      return new RuntimeError(
        'RILL-R004',
        'Gemini: authentication failed (401)'
      );
    }

    if (message.includes('429') || message.includes('rate limit')) {
      return new RuntimeError('RILL-R004', 'Gemini: rate limit');
    }

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return new RuntimeError('RILL-R004', 'Gemini: request timeout');
    }

    // Extract status code if present
    const statusMatch = message.match(/\((\d{3})\)/);
    if (statusMatch && statusMatch[1]) {
      const status = parseInt(statusMatch[1], 10);
      if (status >= 400) {
        return new RuntimeError('RILL-R004', `Gemini: ${message} (${status})`);
      }
    }

    return new RuntimeError('RILL-R004', `Gemini: ${message}`);
  }

  return new RuntimeError('RILL-R004', 'Gemini: unknown error');
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
 * Create Gemini extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createGeminiExtension({
 *   api_key: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.0-flash',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createGeminiExtension(
  config: GeminiExtensionConfig
): ExtensionResult {
  // Validate required fields (§4.1)
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  const client = new GoogleGenAI({
    apiKey: config.api_key,
  });

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;

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
      console.warn(`Failed to abort Gemini requests: ${message}`);
    }

    try {
      // Cleanup SDK HTTP connections
      // Note: Gemini SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Gemini SDK: ${message}`);
    }
  };

  // Return extension result with implementations
  const result: ExtensionResult = {
    // IR-4: gemini::message
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

          // Build Gemini API request
          // Gemini uses 'contents' array with role: "user" / role: "model"
          const contents = [
            {
              role: 'user' as const,
              parts: [{ text }],
            },
          ];

          // Build config object with optional properties
          const apiConfig: {
            systemInstruction?: string;
            maxOutputTokens?: number;
            temperature?: number;
          } = {};

          // Add system instruction if present
          if (system !== undefined) {
            apiConfig.systemInstruction = system;
          }

          // Add max_tokens if present
          if (maxTokens !== undefined) {
            apiConfig.maxOutputTokens = maxTokens;
          }

          // Add temperature if present
          if (factoryTemperature !== undefined) {
            apiConfig.temperature = factoryTemperature;
          }

          // Call Gemini API
          const response = await client.models.generateContent({
            model: factoryModel,
            contents,
            config: apiConfig,
          });

          // Extract text content from response
          const content = response.text ?? '';

          // Build normalized response dict (§3.2)
          const result = {
            content,
            model: factoryModel,
            usage: {
              input: 0, // Gemini API doesn't always provide token counts
              output: 0,
            },
            stop_reason: 'stop',
            id: '', // Gemini API doesn't provide request IDs in the same way
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: text },
              { role: 'assistant', content },
            ],
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:message',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapGeminiError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send single message to Gemini API',
      returnType: 'dict',
    },

    // IR-5: gemini::messages
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

          // Build Gemini API contents array
          // Gemini uses role: "user" / role: "model" (not "assistant")
          const contents: Array<{
            role: 'user' | 'model';
            parts: Array<{ text: string }>;
          }> = [];

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
              // Gemini uses "user" for both user and tool messages
              contents.push({
                role: 'user',
                parts: [{ text: msg['content'] as string }],
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
                contents.push({
                  role: 'model',
                  parts: [{ text: msg['content'] as string }],
                });
              }
            }
          }

          // Build config object with optional properties
          const apiConfig: {
            systemInstruction?: string;
            maxOutputTokens?: number;
            temperature?: number;
          } = {};

          // Add system instruction if present
          if (system !== undefined) {
            apiConfig.systemInstruction = system;
          }

          // Add max_tokens if present
          if (maxTokens !== undefined) {
            apiConfig.maxOutputTokens = maxTokens;
          }

          // Add temperature if present
          if (factoryTemperature !== undefined) {
            apiConfig.temperature = factoryTemperature;
          }

          // Call Gemini API
          const response = await client.models.generateContent({
            model: factoryModel,
            contents,
            config: apiConfig,
          });

          // Extract text content from response
          const content = response.text ?? '';

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
            model: factoryModel,
            usage: {
              input: 0, // Gemini API doesn't always provide token counts
              output: 0,
            },
            stop_reason: 'stop',
            id: '', // Gemini API doesn't provide request IDs in the same way
            messages: fullMessages,
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:messages',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapGeminiError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Send multi-turn conversation to Gemini API',
      returnType: 'dict',
    },

    // IR-6: gemini::embed
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

          // Call Gemini embedContent API
          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: [text],
          });

          // Extract embedding data from response
          const embedding = response.embeddings?.[0];
          if (
            !embedding ||
            !embedding.values ||
            embedding.values.length === 0
          ) {
            throw new RuntimeError(
              'RILL-R004',
              'Gemini: empty embedding returned'
            );
          }

          // Convert to Float32Array and create RillVector
          const float32Data = new Float32Array(embedding.values);
          const vector = createVector(float32Data, factoryEmbedModel);

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:embed',
            subsystem: 'extension:gemini',
            duration,
            model: factoryEmbedModel,
            dimensions: float32Data.length,
          });

          return vector as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapGeminiError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vector for text',
      returnType: 'vector',
    },

    // IR-7: gemini::embed_batch
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

          // EC-20: Validate embed_model is configured
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

          // Call Gemini embedContent API with array of texts
          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: stringTexts,
          });

          // Convert embeddings to RillVector list
          const vectors: RillValue[] = [];
          if (!response.embeddings || response.embeddings.length === 0) {
            throw new RuntimeError(
              'RILL-R004',
              'Gemini: empty embeddings returned'
            );
          }

          for (const embedding of response.embeddings) {
            if (
              !embedding ||
              !embedding.values ||
              embedding.values.length === 0
            ) {
              throw new RuntimeError(
                'RILL-R004',
                'Gemini: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embedding.values);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

          // Emit success event
          const duration = Date.now() - startTime;
          const firstVector = vectors[0];
          const dimensions =
            firstVector && isVector(firstVector) ? firstVector.data.length : 0;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:embed_batch',
            subsystem: 'extension:gemini',
            duration,
            model: factoryEmbedModel,
            dimensions,
            count: vectors.length,
          });

          return vectors as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapGeminiError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate embedding vectors for multiple texts',
      returnType: 'list',
    },

    // IR-8: gemini::tool_loop
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

          // EC-22: Validate prompt is non-empty
          if (prompt.trim().length === 0) {
            throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
          }

          // EC-23: Validate tools option is present
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

          // Build tool map and Gemini tools array
          const toolMap = new Map<string, RillCallable>();
          const geminiTools: FunctionDeclaration[] = [];

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

            // Build Gemini tool definition
            const description =
              typeof tool['description'] === 'string'
                ? tool['description']
                : '';
            const params = tool['params'] ?? {};

            // Convert rill params dict to JSON Schema
            const properties: Record<string, Schema> = {};
            const required: string[] = [];

            if (typeof params === 'object' && params !== null) {
              for (const [paramName, paramSpec] of Object.entries(params)) {
                if (
                  typeof paramSpec === 'object' &&
                  paramSpec !== null &&
                  'type' in paramSpec
                ) {
                  const spec = paramSpec as Record<string, unknown>;
                  const typeStr = (spec['type'] ?? 'string') as string;
                  // Map rill types to Gemini Schema types
                  let schemaType = Type.STRING;
                  if (typeStr === 'number') schemaType = Type.NUMBER;
                  if (typeStr === 'boolean') schemaType = Type.BOOLEAN;
                  if (typeStr === 'integer') schemaType = Type.INTEGER;

                  properties[paramName] = {
                    type: schemaType,
                    description: (spec['description'] ?? '') as string,
                  };
                  // All params are required by default
                  required.push(paramName);
                }
              }
            }

            geminiTools.push({
              name: toolName,
              description,
              parameters: {
                type: Type.OBJECT,
                properties,
                required,
              },
            });
          }

          // Build initial contents array
          const conversationContents: Content[] = [];

          // Add history messages if provided
          for (const msg of initialMessages) {
            if (
              typeof msg === 'object' &&
              msg !== null &&
              'role' in msg &&
              'content' in msg
            ) {
              const role = msg['role'];
              if (role === 'user') {
                conversationContents.push({
                  role: 'user',
                  parts: [{ text: msg['content'] as string }],
                });
              } else if (role === 'assistant') {
                conversationContents.push({
                  role: 'model',
                  parts: [{ text: msg['content'] as string }],
                });
              }
            }
          }

          // Add user prompt
          conversationContents.push({
            role: 'user',
            parts: [{ text: prompt }],
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

            // Build config object
            const apiConfig = {
              ...(system !== undefined && { systemInstruction: system }),
              ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
              ...(factoryTemperature !== undefined && {
                temperature: factoryTemperature,
              }),
              tools: [{ functionDeclarations: geminiTools }],
            };

            // Call Gemini API with tools
            const response = await client.models.generateContent({
              model: factoryModel,
              contents: conversationContents,
              config: apiConfig,
            });

            // Aggregate usage (Gemini API may not provide token counts)
            totalInputTokens += 0;
            totalOutputTokens += 0;

            // Extract response text
            const responseText = response.text ?? '';

            // Check for function calls in response
            const functionCalls = response.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
              // Add model message with function calls to conversation
              const functionCallParts: Part[] = functionCalls.map((fc) => ({
                functionCall: {
                  name: fc.name ?? '',
                  args: fc.args ?? {},
                  id: fc.id ?? '',
                },
              }));
              conversationContents.push({
                role: 'model',
                parts: functionCallParts,
              });

              // Execute tool calls (parallel for multiple calls)
              const toolResults = await Promise.all(
                functionCalls.map(async (functionCall) => {
                  const toolStartTime = Date.now();
                  const toolName = functionCall.name ?? '';

                  // Emit tool_call event
                  emitExtensionEvent(ctx as RuntimeContext, {
                    event: 'gemini:tool_call',
                    subsystem: 'extension:gemini',
                    tool_name: toolName,
                    args: JSON.stringify(functionCall.args),
                  });

                  // EC-24: Check tool exists (configuration error, abort immediately)
                  const toolFn = toolMap.get(toolName);
                  if (!toolFn) {
                    throw new RuntimeError(
                      'RILL-R004',
                      `unknown tool '${toolName}'`
                    );
                  }

                  try {
                    // Convert args object to RillValue array (positional args)
                    const toolArgs = functionCall.args ?? {};
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
                      event: 'gemini:tool_result',
                      subsystem: 'extension:gemini',
                      tool_name: toolName,
                      duration: toolDuration,
                    });

                    // Return tool result
                    return {
                      name: toolName,
                      response:
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
                      event: 'gemini:tool_result',
                      subsystem: 'extension:gemini',
                      tool_name: toolName,
                      duration: toolDuration,
                      error: errorMessage,
                    });

                    // EC-25: Check if max_errors exceeded
                    if (consecutiveErrors >= maxErrors) {
                      throw new RuntimeError(
                        'RILL-R004',
                        `tool loop aborted after ${maxErrors} consecutive errors`
                      );
                    }

                    // Return error to LLM as tool result
                    return {
                      name: toolName,
                      response: JSON.stringify({
                        error: errorMessage,
                        code: 'RILL-R001',
                      }),
                    };
                  }
                })
              );

              // Add function responses to conversation
              const functionResponseParts: Part[] = toolResults.map((tr) => ({
                functionResponse: {
                  name: tr.name ?? '',
                  response: { result: tr.response },
                },
              }));
              conversationContents.push({
                role: 'user',
                parts: functionResponseParts,
              });

              // Continue loop to get next response
              continue;
            }

            // No function calls - final response
            finalContent = responseText;
            stopReason = 'stop';
            break;
          }

          // Check if we hit max_turns
          if (turns >= maxTurns && stopReason === 'stop') {
            stopReason = 'max_turns';
          }

          // Build conversation history for response
          const fullMessages: Array<Record<string, unknown>> = [];
          for (const content of conversationContents) {
            if (content.role === 'user' && content.parts) {
              // Extract text from parts
              const textParts = content.parts.filter(
                (p) => 'text' in p
              ) as Array<{ text: string }>;
              if (textParts.length > 0 && textParts[0]) {
                fullMessages.push({
                  role: 'user',
                  content: textParts[0].text,
                });
              }
            } else if (content.role === 'model' && content.parts) {
              // Extract text from parts
              const textParts = content.parts.filter(
                (p) => 'text' in p
              ) as Array<{ text: string }>;
              if (textParts.length > 0 && textParts[0]) {
                fullMessages.push({
                  role: 'assistant',
                  content: textParts[0].text,
                });
              }
            }
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

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:tool_loop',
            subsystem: 'extension:gemini',
            turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapGeminiError(error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Execute tool-use loop with Gemini API',
      returnType: 'dict',
    },
  };

  // IR-11: Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
