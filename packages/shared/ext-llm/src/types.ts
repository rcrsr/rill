/**
 * Shared types for LLM extensions
 */

import type { RillValue } from '@rcrsr/rill';

/**
 * Base configuration for LLM extensions
 */
export interface LLMExtensionConfig {
  /**
   * Model name (e.g., "gpt-4", "claude-3-opus")
   */
  readonly model: string;

  /**
   * Sampling temperature (0.0-2.0 inclusive)
   */
  readonly temperature?: number | undefined;

  /**
   * API key for authentication
   */
  readonly api_key: string;

  /**
   * Base URL for API endpoint
   */
  readonly base_url?: string | undefined;

  /**
   * Model name for embedding operations
   */
  readonly embed_model?: string | undefined;
}

/**
 * Extended configuration for LLM providers with retry and timeout options
 */
export interface LLMProviderConfig extends LLMExtensionConfig {
  /**
   * Maximum number of retry attempts on failure
   */
  readonly max_retries?: number | undefined;

  /**
   * Request timeout in milliseconds
   */
  readonly timeout?: number | undefined;

  /**
   * Maximum tokens to generate
   */
  readonly max_tokens?: number | undefined;

  /**
   * System message content
   */
  readonly system?: string | undefined;
}

/**
 * Function that detects and extracts error information from provider errors
 */
export type ProviderErrorDetector = (error: unknown) => {
  status?: number;
  message: string;
} | null;

/**
 * Parameter metadata for tool descriptors
 */
export interface ToolParamMetadata {
  readonly type: string;
  readonly description: string;
}

/**
 * Callbacks for tool loop orchestration
 */
export interface ToolLoopCallbacks {
  /**
   * Build provider-specific tool format from tool definitions
   */
  buildTools: (
    tools: Array<{
      name: string;
      description: string;
      input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
      };
    }>
  ) => unknown;

  /**
   * Call the provider API with messages and tools
   */
  callAPI: (messages: unknown[], tools: unknown) => Promise<unknown>;

  /**
   * Extract tool calls from provider response
   */
  extractToolCalls: (
    response: unknown
  ) => Array<{ id: string; name: string; input: object }> | null;

  /**
   * Format tool results into provider-specific message format
   */
  formatToolResult: (
    toolResults: Array<{
      id: string;
      name: string;
      result: RillValue;
      error?: string;
    }>
  ) => unknown;
}

/**
 * Result from tool loop execution
 */
export interface ToolLoopResult {
  /**
   * Final provider response
   */
  response: unknown;

  /**
   * All tool calls executed with their results
   */
  toolCalls: Array<{ name: string; result: RillValue }>;

  /**
   * Total tokens consumed across all iterations
   */
  totalTokens: { input: number; output: number };

  /**
   * Number of turns executed in the tool loop
   */
  turns: number;
}
