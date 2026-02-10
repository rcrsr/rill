/**
 * Base configuration interface for all vector database extensions.
 */
export interface VectorExtensionConfig {
  /**
   * Timeout in milliseconds for operations.
   * Default is determined by the SDK.
   */
  readonly timeout?: number | undefined;
}

/**
 * Result shape returned by batch operation executor.
 */
export interface BatchResult {
  /**
   * Number of operations that succeeded.
   */
  readonly succeeded: number;

  /**
   * Error message for failed operations.
   * Absent when all operations succeed.
   */
  readonly failed?: string;

  /**
   * Detailed error information.
   * Absent when all operations succeed.
   */
  readonly error?: string;
}

/**
 * Mutable state object tracking disposal lifecycle.
 */
export interface DisposalState {
  /**
   * Whether the resource has been disposed.
   * Default: false
   */
  isDisposed: boolean;
}

/**
 * Standard distance metric string union.
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot';
