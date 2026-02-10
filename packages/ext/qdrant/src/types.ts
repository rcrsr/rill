/**
 * Type definitions for Qdrant extension.
 * Defines configuration for connecting to Qdrant vector database.
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Qdrant extension.
 *
 * Defines connection parameters for Qdrant REST client including
 * endpoint URL, authentication, collection name, and vector settings.
 *
 * @example
 * ```typescript
 * // Local deployment
 * const localConfig: QdrantConfig = {
 *   url: 'http://127.0.0.1:6333',
 *   collection: 'my_collection',
 * };
 *
 * // Cloud deployment with API key
 * const cloudConfig: QdrantConfig = {
 *   url: 'https://xxxxxxxx.aws.cloud.qdrant.io',
 *   apiKey: 'your-api-key',
 *   collection: 'my_collection',
 *   dimensions: 384,
 *   distance: 'cosine',
 *   timeout: 30000,
 * };
 * ```
 */
export interface QdrantConfig {
  /**
   * API endpoint URL for Qdrant server.
   *
   * Local: 'http://127.0.0.1:6333'
   * Cloud: 'https://xxx.cloud.qdrant.io'
   */
  readonly url: string;

  /**
   * API key for authentication.
   *
   * Optional for local deployments, required for Qdrant Cloud.
   */
  readonly apiKey?: string | undefined;

  /**
   * Collection name for vector operations.
   *
   * Must match an existing collection in the Qdrant instance.
   */
  readonly collection: string;

  /**
   * Vector dimensions (embedding size).
   *
   * Optional - database infers from first vector if not specified.
   * Common values: 384 (small models), 768 (BERT), 1536 (OpenAI).
   */
  readonly dimensions?: number | undefined;

  /**
   * Distance metric for similarity calculations.
   *
   * - 'cosine': Normalized dot product (default, most common)
   * - 'euclidean': L2 distance
   * - 'dot': Dot product without normalization
   *
   * Default: 'cosine'
   */
  readonly distance?: 'cosine' | 'euclidean' | 'dot' | undefined;

  /**
   * Request timeout in milliseconds.
   *
   * Must be a positive integer.
   * Default: SDK default (30000ms)
   */
  readonly timeout?: number | undefined;
}

// ============================================================
// BACKWARD COMPATIBILITY
// ============================================================

/**
 * Legacy type alias for QdrantConfig.
 *
 * @deprecated Use QdrantConfig instead.
 */
export type QdrantExtensionConfig = QdrantConfig;
