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
  type ApplicationCallable,
  type CallableParam,
} from '@rcrsr/rill';
import {
  validateApiKey,
  validateModel,
  validateTemperature,
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  executeToolLoop,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// ERROR DETECTION
// ============================================================

/**
 * OpenAI-specific error detector for mapProviderError.
 * Extracts status code and message from OpenAI.APIError instances.
 *
 * @param error - Error to detect
 * @returns Status and message if OpenAI error, null otherwise
 */
const detectOpenAIError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof OpenAI.APIError) {
    return {
      status: error.status ?? undefined,
      message: error.message,
    };
  }
  return null;
};

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
          const rillError = mapProviderError(
            'OpenAI',
            error,
            detectOpenAIError
          );

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
          const rillError = mapProviderError(
            'OpenAI',
            error,
            detectOpenAIError
          );

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
          validateEmbedText(text.trim());

          // EC-16: Validate embed_model is configured
          validateEmbedModel(factoryEmbedModel);

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
          const rillError = mapProviderError(
            'OpenAI',
            error,
            detectOpenAIError
          );

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
          validateEmbedModel(factoryEmbedModel);

          // EC-18: Validate all elements are strings
          const stringTexts = validateEmbedBatch(texts);

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
          const rillError = mapProviderError(
            'OpenAI',
            error,
            detectOpenAIError
          );

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
          const messages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            messages.push({
              role: 'system',
              content: system,
            });
          }

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

          // Define OpenAI-specific callbacks for shared tool loop
          const callbacks: ToolLoopCallbacks = {
            // Build OpenAI Tool format from tool definitions
            buildTools: (
              toolDefs: Array<{
                name: string;
                description: string;
                input_schema: object;
              }>
            ): OpenAI.ChatCompletionTool[] => {
              return toolDefs.map((def) => ({
                type: 'function' as const,
                function: {
                  name: def.name,
                  description: def.description,
                  parameters: def.input_schema as Record<string, unknown>,
                },
              }));
            },

            // Call OpenAI API
            callAPI: async (
              msgs: unknown[],
              tools: unknown
            ): Promise<unknown> => {
              const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
                model: factoryModel,
                max_tokens: maxTokens,
                messages: msgs as OpenAI.ChatCompletionMessageParam[],
                tools: tools as OpenAI.ChatCompletionTool[],
                tool_choice: 'auto' as const,
              };

              if (factoryTemperature !== undefined) {
                apiParams.temperature = factoryTemperature;
              }

              const response = await client.chat.completions.create(apiParams);

              // Normalize response to include usage in expected format
              return {
                ...response,
                usage: {
                  input_tokens: response.usage?.prompt_tokens ?? 0,
                  output_tokens: response.usage?.completion_tokens ?? 0,
                },
              };
            },

            // Extract tool calls from OpenAI response
            extractToolCalls: (
              response: unknown
            ): Array<{ id: string; name: string; input: object }> | null => {
              if (
                !response ||
                typeof response !== 'object' ||
                !('choices' in response)
              ) {
                return null;
              }

              const choices = (response as { choices: unknown[] }).choices;
              if (!Array.isArray(choices) || choices.length === 0) {
                return null;
              }

              const choice = choices[0];
              if (
                !choice ||
                typeof choice !== 'object' ||
                !('message' in choice)
              ) {
                return null;
              }

              const message = (choice as { message: unknown }).message;
              if (
                !message ||
                typeof message !== 'object' ||
                !('tool_calls' in message)
              ) {
                return null;
              }

              const toolCalls = (message as { tool_calls: unknown[] | null })
                .tool_calls;
              if (!toolCalls || !Array.isArray(toolCalls)) {
                return null;
              }

              // Filter for function tool calls and extract relevant data
              const functionToolCalls = toolCalls.filter(
                (
                  tc
                ): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall =>
                  typeof tc === 'object' &&
                  tc !== null &&
                  'type' in tc &&
                  tc.type === 'function'
              );

              return functionToolCalls.map((tc) => {
                // Type assertion safe because we filtered for function type
                const functionCall =
                  tc as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                    function: { name: string; arguments: string };
                  };
                const args = functionCall.function.arguments;
                let parsedArgs: object;
                try {
                  parsedArgs = JSON.parse(args);
                } catch {
                  parsedArgs = {};
                }

                return {
                  id: tc.id,
                  name: functionCall.function.name,
                  input: parsedArgs,
                };
              });
            },

            // Format tool results into OpenAI message format
            formatToolResult: (
              toolResults: Array<{
                id: string;
                name: string;
                result: RillValue;
                error?: string;
              }>
            ): unknown => {
              // For OpenAI, we need to add assistant message with tool calls,
              // then tool messages with results
              // Since executeToolLoop already extracted the tool calls, we only
              // return the tool result messages here
              return toolResults.map((tr) => ({
                role: 'tool' as const,
                tool_call_id: tr.id,
                content: tr.error
                  ? JSON.stringify({ error: tr.error, code: 'RILL-R001' })
                  : typeof tr.result === 'string'
                    ? tr.result
                    : JSON.stringify(tr.result),
              }));
            },
          };

          // Execute shared tool loop
          const loopResult = await executeToolLoop(
            messages,
            toolsDict as RillValue,
            maxErrors,
            callbacks,
            (event: string, data: Record<string, unknown>) => {
              // Map shared events to OpenAI-specific events
              const eventMap: Record<string, string> = {
                tool_call: 'openai:tool_call',
                tool_result: 'openai:tool_result',
              };

              emitExtensionEvent(ctx as RuntimeContext, {
                event: eventMap[event] || event,
                subsystem: 'extension:openai',
                ...data,
              });
            },
            maxTurns,
            ctx
          );

          // Extract response data
          const response =
            loopResult.response as OpenAI.Chat.Completions.ChatCompletion | null;
          const content = response?.choices[0]?.message?.content ?? '';
          const stopReason =
            loopResult.turns >= maxTurns
              ? 'max_turns'
              : (response?.choices[0]?.finish_reason ?? 'stop');

          // Build conversation history for response
          // Reconstruct full message history from messages array
          const fullMessages: Array<Record<string, unknown>> = [];
          for (const msg of messages) {
            if ('role' in msg && msg.role !== 'system') {
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
          }

          // Add final assistant response if present
          if (response) {
            fullMessages.push({
              role: 'assistant',
              content,
            });
          }

          // Build result dict
          const result = {
            content,
            model: factoryModel,
            usage: {
              input: loopResult.totalTokens.input,
              output: loopResult.totalTokens.output,
            },
            stop_reason: stopReason,
            turns: loopResult.turns,
            messages: fullMessages,
          };

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:tool_loop',
            subsystem: 'extension:openai',
            turns: loopResult.turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError = mapProviderError(
            'OpenAI',
            error,
            detectOpenAIError
          );

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
