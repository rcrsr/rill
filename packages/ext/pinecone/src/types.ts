/**
 * Type definitions for Pinecone extension.
 * Defines configuration for connecting to Pinecone vector database.
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Pinecone extension.
 *
 * Defines connection parameters for Pinecone client including
 * API key, index name, namespace, and timeout settings.
 *
 * @example
 * ```typescript
 * // Basic configuration with required fields
 * const basicConfig: PineconeConfig = {
 *   apiKey: 'your-pinecone-api-key',
 *   index: 'my-index',
 * };
 *
 * // Full configuration with optional fields
 * const fullConfig: PineconeConfig = {
 *   apiKey: 'your-pinecone-api-key',
 *   index: 'my-index',
 *   namespace: 'production',
 *   timeout: 60000,
 * };
 * ```
 */
export interface PineconeConfig {
  /**
   * API key for Pinecone authentication.
   *
   * Required for all Pinecone operations.
   * Obtain from Pinecone console.
   */
  readonly apiKey: string;

  /**
   * Index name for vector operations.
   *
   * Must match an existing index in the Pinecone project.
   */
  readonly index: string;

  /**
   * Namespace for partitioning vectors within an index.
   *
   * Namespaces allow logical separation of vectors within a single index.
   * Default: '' (default namespace)
   */
  readonly namespace?: string | undefined;

  /**
   * Request timeout in milliseconds.
   *
   * Must be a positive integer.
   * Default: SDK default (30000ms)
   */
  readonly timeout?: number | undefined;
}
