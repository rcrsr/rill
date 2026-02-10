/**
 * Type definitions for ChromaDB extension.
 * Defines configuration for connecting to ChromaDB vector database.
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for ChromaDB extension.
 *
 * Defines connection parameters for ChromaDB client including
 * optional API URL, collection name, embedding function, and timeout settings.
 *
 * @example
 * ```typescript
 * // Embedded mode (default)
 * const embeddedConfig: ChromaConfig = {
 *   collection: 'my_collection',
 * };
 *
 * // HTTP client mode
 * const httpConfig: ChromaConfig = {
 *   url: 'http://localhost:8000',
 *   collection: 'my_collection',
 *   embeddingFunction: 'openai',
 *   timeout: 30000,
 * };
 * ```
 */
export interface ChromaConfig {
  /**
   * API endpoint URL for ChromaDB server.
   *
   * Optional - when undefined, uses embedded mode.
   * HTTP mode: 'http://localhost:8000'
   */
  readonly url?: string | undefined;

  /**
   * Collection name for vector operations.
   *
   * Required - identifies the collection to use for operations.
   */
  readonly collection: string;

  /**
   * Embedding function name.
   *
   * Optional - when undefined, database uses collection default.
   * Examples: 'openai', 'cohere', 'huggingface'
   */
  readonly embeddingFunction?: string | undefined;

  /**
   * Request timeout in milliseconds.
   *
   * Must be a positive integer.
   * Default: SDK default (30000ms)
   */
  readonly timeout?: number | undefined;
}
