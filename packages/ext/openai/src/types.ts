/**
 * Type definitions for OpenAI extension.
 * Defines configuration, message types, and result structures.
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Base configuration interface for LLM extensions.
 * Defines common fields across all LLM providers.
 */
export interface LLMExtensionConfig {
  /** Model identifier (e.g., 'gpt-4-turbo') */
  readonly model: string;
  /** Temperature for response generation (0.0-2.0) */
  readonly temperature?: number | undefined;
  /** API key for authentication */
  readonly api_key: string;
  /** Custom base URL for API endpoint */
  readonly base_url?: string | undefined;
  /** Embedding model identifier for embed operations */
  readonly embed_model?: string | undefined;
}

/**
 * Configuration options for OpenAI extension.
 * Extends base LLM config with OpenAI-specific fields.
 */
export interface OpenAIExtensionConfig extends LLMExtensionConfig {
  /** Maximum retry attempts for failed requests */
  readonly max_retries?: number | undefined;
  /** Request timeout in milliseconds */
  readonly timeout?: number | undefined;
  /** Maximum tokens in response */
  readonly max_tokens?: number | undefined;
  /** System prompt text */
  readonly system?: string | undefined;
}
