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
  invokeCallable,
  isVector,
  isCallable,
  type ExtensionResult,
  type RillCallable,
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
  buildJsonSchema,
  type JsonSchemaProperty,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import type { GeminiExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Gemini-specific error detector for mapProviderError.
 * Extracts status code and message using string pattern matching.
 *
 * @param error - Unknown error value
 * @returns Object with status and message if Gemini error, null otherwise
 */
const detectGeminiError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message;

    // Extract status code if present in message
    const statusMatch = message.match(/\((\d{3})\)/);
    if (statusMatch && statusMatch[1]) {
      return {
        status: parseInt(statusMatch[1], 10),
        message,
      };
    }

    return {
      message,
    };
  }
  return null;
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert a JsonSchemaProperty (string type names) to a Gemini Schema
 * (Type enum values). Mirrors the type-mapping pattern in buildTools.
 */
function toGeminiSchema(prop: JsonSchemaProperty): Schema {
  // Map JSON Schema type string to Gemini Type enum
  let schemaType = Type.STRING;
  if (prop.type === 'number') schemaType = Type.NUMBER;
  if (prop.type === 'boolean') schemaType = Type.BOOLEAN;
  if (prop.type === 'integer') schemaType = Type.INTEGER;
  if (prop.type === 'array') schemaType = Type.ARRAY;
  if (prop.type === 'object') schemaType = Type.OBJECT;

  const schema: Schema = { type: schemaType };

  if (prop.description !== undefined) {
    schema.description = prop.description;
  }

  if (prop.enum !== undefined) {
    schema.enum = prop.enum;
  }

  if (prop.type === 'array' && prop.items !== undefined) {
    schema.items = toGeminiSchema(prop.items);
  }

  if (prop.type === 'object' && prop.properties !== undefined) {
    const nestedProperties: Record<string, Schema> = {};
    for (const [key, nestedProp] of Object.entries(prop.properties)) {
      nestedProperties[key] = toGeminiSchema(nestedProp);
    }
    schema.properties = nestedProperties;
    if (prop.required !== undefined) {
      schema.required = prop.required;
    }
  }

  return schema;
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
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Gemini', error, detectGeminiError);

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
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Gemini', error, detectGeminiError);

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

          // Validate using shared functions
          validateEmbedText(text);
          validateEmbedModel(factoryEmbedModel);

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
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Gemini', error, detectGeminiError);

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

          // Validate using shared functions
          validateEmbedModel(factoryEmbedModel);
          const stringTexts = validateEmbedBatch(texts);

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
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Gemini', error, detectGeminiError);

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

            // Extract description for tool descriptor
            const description =
              typeof descriptor['description'] === 'string'
                ? descriptor['description']
                : '';

            let enhancedCallable: RillValue = toolFnValue;

            if (
              description &&
              isCallable(toolFnValue) &&
              (toolFnValue as RillCallable).kind === 'script'
            ) {
              // 3-arg tool form: no explicit params dict, but closure has typed params.
              // Wrap ScriptCallable as ApplicationCallable to carry description through.
              const capturedToolFn = toolFnValue as RillCallable;
              const scriptParams =
                'params' in capturedToolFn &&
                Array.isArray(capturedToolFn.params)
                  ? (capturedToolFn.params as CallableParam[])
                  : [];
              enhancedCallable = {
                __type: 'callable',
                kind: 'application' as const,
                params: scriptParams,
                fn: (callArgs, callCtx) =>
                  invokeCallable(
                    capturedToolFn,
                    callArgs,
                    callCtx as RuntimeContext
                  ),
                description,
                isProperty: false,
              } as ApplicationCallable;
            }

            toolsDict[name] = enhancedCallable;
          }

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

          // Build initial Gemini contents array
          const contents: Content[] = [];

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
                contents.push({
                  role: 'user',
                  parts: [{ text: msg['content'] as string }],
                });
              } else if (role === 'assistant') {
                contents.push({
                  role: 'model',
                  parts: [{ text: msg['content'] as string }],
                });
              }
            }
          }

          // Add user prompt
          contents.push({
            role: 'user',
            parts: [{ text: prompt }],
          });

          // Define Gemini-specific callbacks for shared tool loop
          const callbacks: ToolLoopCallbacks = {
            // Build Gemini FunctionDeclaration format from tool definitions
            buildTools: (
              toolDefs: Array<{
                name: string;
                description: string;
                input_schema: {
                  type: 'object';
                  properties: Record<string, unknown>;
                  required: string[];
                };
              }>
            ): FunctionDeclaration[] => {
              return toolDefs.map((def) => {
                // Convert JSON Schema properties to Gemini Schema format
                const properties: Record<string, Schema> = {};
                for (const [propName, propDef] of Object.entries(
                  def.input_schema.properties
                )) {
                  const prop = propDef as Record<string, unknown>;
                  const propType = prop['type'] as string;

                  // Map JSON Schema types to Gemini Schema types
                  let schemaType = Type.STRING;
                  if (propType === 'number') schemaType = Type.NUMBER;
                  if (propType === 'boolean') schemaType = Type.BOOLEAN;
                  if (propType === 'integer') schemaType = Type.INTEGER;
                  if (propType === 'array') schemaType = Type.ARRAY;
                  if (propType === 'object') schemaType = Type.OBJECT;

                  properties[propName] = {
                    type: schemaType,
                    description: (prop['description'] as string) ?? '',
                  };
                }

                return {
                  name: def.name,
                  description: def.description,
                  parameters: {
                    type: Type.OBJECT,
                    properties,
                    required: def.input_schema.required,
                  },
                };
              });
            },

            // Call Gemini API
            callAPI: async (
              msgs: unknown[],
              tools: unknown
            ): Promise<unknown> => {
              const apiConfig = {
                ...(system !== undefined && { systemInstruction: system }),
                ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
                ...(factoryTemperature !== undefined && {
                  temperature: factoryTemperature,
                }),
                tools: [
                  { functionDeclarations: tools as FunctionDeclaration[] },
                ],
              };

              return await client.models.generateContent({
                model: factoryModel,
                contents: msgs as Content[],
                config: apiConfig,
              });
            },

            // Extract tool calls from Gemini response
            extractToolCalls: (
              response: unknown
            ): Array<{ id: string; name: string; input: object }> | null => {
              if (
                !response ||
                typeof response !== 'object' ||
                !('functionCalls' in response)
              ) {
                return null;
              }

              const functionCalls = (response as { functionCalls?: unknown[] })
                .functionCalls;
              if (!functionCalls || functionCalls.length === 0) {
                return null;
              }

              return functionCalls.map((fc) => {
                const call = fc as {
                  id?: string;
                  name?: string;
                  args?: object;
                };
                return {
                  id: call.id ?? '',
                  name: call.name ?? '',
                  input: call.args ?? {},
                };
              });
            },

            // Extract the model's content from Gemini response for conversation history
            formatAssistantMessage: (response: unknown): unknown => {
              if (
                !response ||
                typeof response !== 'object' ||
                !('candidates' in response)
              ) {
                return null;
              }

              const candidates = (response as { candidates?: unknown[] })
                .candidates;
              if (!Array.isArray(candidates) || candidates.length === 0) {
                return null;
              }

              const candidate = candidates[0];
              if (
                !candidate ||
                typeof candidate !== 'object' ||
                !('content' in candidate)
              ) {
                return null;
              }

              return (candidate as { content: unknown }).content;
            },

            // Format tool results into Gemini message format
            formatToolResult: (
              toolResults: Array<{
                id: string;
                name: string;
                result: RillValue;
                error?: string;
              }>
            ): unknown => {
              // Convert tool results to Gemini functionResponse parts
              const functionResponseParts: Part[] = toolResults.map((tr) => ({
                functionResponse: {
                  name: tr.name,
                  response: {
                    result: tr.error
                      ? `Error: ${tr.error}`
                      : typeof tr.result === 'string'
                        ? tr.result
                        : JSON.stringify(tr.result),
                  },
                },
              }));

              // Return user message with function responses
              return {
                role: 'user' as const,
                parts: functionResponseParts,
              };
            },
          };

          // Execute shared tool loop
          const loopResult = await executeToolLoop(
            contents,
            toolsDict,
            maxErrors,
            callbacks,
            (event: string, data: Record<string, unknown>) => {
              // Map shared events to Gemini-specific events
              const eventMap: Record<string, string> = {
                tool_call: 'gemini:tool_call',
                tool_result: 'gemini:tool_result',
              };

              emitExtensionEvent(ctx as RuntimeContext, {
                event: eventMap[event] || event,
                subsystem: 'extension:gemini',
                ...data,
              });
            },
            maxTurns,
            ctx
          );

          // Extract response data
          const response = loopResult.response;
          const content =
            response && typeof response === 'object' && 'text' in response
              ? ((response as { text?: string }).text ?? '')
              : '';

          const result = {
            content,
            model: factoryModel,
            usage: loopResult.totalTokens,
            stop_reason: response ? 'stop' : 'max_turns',
            turns: loopResult.turns,
            messages: [
              ...initialMessages,
              { role: 'user', content: prompt },
              { role: 'assistant', content },
            ],
          };

          // Emit tool_loop event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:tool_loop',
            subsystem: 'extension:gemini',
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
              : mapProviderError('Gemini', error, detectGeminiError);

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

    // IR-3: gemini::generate
    generate: {
      params: [
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict' },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const prompt = args[0] as string;
          const options = (args[1] ?? {}) as Record<string, unknown>;

          // EC-3: Validate schema option is present
          if (
            !('schema' in options) ||
            options['schema'] === null ||
            options['schema'] === undefined
          ) {
            throw new RuntimeError(
              'RILL-R004',
              "generate requires 'schema' option"
            );
          }

          // EC-4: Build JSON Schema — delegates type validation to buildJsonSchema
          const rillSchema = options['schema'] as Record<string, unknown>;
          const jsonSchema = buildJsonSchema(rillSchema);

          // Convert JSON Schema properties to Gemini Schema type (IR-6)
          const geminiProperties: Record<string, Schema> = {};
          for (const [key, prop] of Object.entries(jsonSchema.properties)) {
            geminiProperties[key] = toGeminiSchema(prop);
          }
          const responseSchema: Schema = {
            type: Type.OBJECT,
            properties: geminiProperties,
            required: jsonSchema.required,
          };

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number'
              ? options['max_tokens']
              : factoryMaxTokens;

          // Build Gemini contents array: prepend context messages then prompt
          const contents: Content[] = [];

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<
              Record<string, unknown>
            >;

            for (const msg of prependedMessages) {
              if (
                typeof msg === 'object' &&
                msg !== null &&
                'role' in msg &&
                'content' in msg
              ) {
                const role = msg['role'];
                if (role === 'user') {
                  contents.push({
                    role: 'user',
                    parts: [{ text: msg['content'] as string }],
                  });
                } else if (role === 'assistant') {
                  contents.push({
                    role: 'model',
                    parts: [{ text: msg['content'] as string }],
                  });
                }
              }
            }
          }

          // Add the prompt as the final user turn
          contents.push({
            role: 'user',
            parts: [{ text: prompt }],
          });

          // Build API config with responseSchema and responseMimeType (IR-6)
          const apiConfig: {
            systemInstruction?: string;
            maxOutputTokens?: number;
            temperature?: number;
            responseSchema: Schema;
            responseMimeType: string;
          } = {
            responseSchema,
            responseMimeType: 'application/json',
          };

          if (system !== undefined) {
            apiConfig.systemInstruction = system;
          }
          if (maxTokens !== undefined) {
            apiConfig.maxOutputTokens = maxTokens;
          }
          if (factoryTemperature !== undefined) {
            apiConfig.temperature = factoryTemperature;
          }

          // Call Gemini API
          const response = await client.models.generateContent({
            model: factoryModel,
            contents,
            config: apiConfig,
          });

          // Extract JSON string from response.text (IR-6)
          const raw = response.text ?? '';

          // EC-5: Parse JSON, throw on failure with original error detail
          let data: unknown;
          try {
            data = JSON.parse(raw) as unknown;
          } catch (parseError: unknown) {
            const detail =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            throw new RuntimeError(
              'RILL-R004',
              `generate: failed to parse response JSON: ${detail}`
            );
          }

          // Extract usage metadata (IR-6)
          const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens =
            response.usageMetadata?.candidatesTokenCount ?? 0;

          // Extract stop reason and id (IR-6)
          const stopReason = response.candidates?.[0]?.finishReason ?? 'stop';
          const id = response.responseId ?? '';

          // Build 6-key response dict (AC-6, AC-7)
          const generateResult = {
            data,
            raw,
            model: factoryModel,
            usage: {
              input: inputTokens,
              output: outputTokens,
            },
            stop_reason: stopReason,
            id,
          };

          // Emit success event (AC-34)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:generate',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: generateResult.usage,
          });

          return generateResult as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Gemini', error, detectGeminiError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      description: 'Generate structured output from Gemini API',
      returnType: 'dict',
    },
  };

  // IR-11: Attach dispose lifecycle method
  result.dispose = dispose;

  return result;
}
