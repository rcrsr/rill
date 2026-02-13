/**
 * Type definitions for S3 file system extension.
 * Defines configuration for S3-compatible storage backend.
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration for a single S3 fs mount.
 *
 * Extends common fs mount configuration with S3-specific fields.
 * Each mount represents a bucket/prefix combination.
 *
 * @example
 * ```typescript
 * const mountConfig: S3FsMountConfig = {
 *   mode: 'read-write',
 *   bucket: 'my-app-data',
 *   prefix: 'user-uploads/',
 *   glob: '*.{json,txt}',
 *   maxFileSize: 5242880
 * };
 * ```
 */
export interface S3FsMountConfig {
  /**
   * Access mode for this mount.
   *
   * - 'read': Read-only access (write/delete operations throw errors)
   * - 'write': Write-only access (read operations throw errors)
   * - 'read-write': Full access to all operations
   */
  readonly mode: 'read' | 'write' | 'read-write';

  /**
   * S3 bucket name.
   *
   * Bucket must exist and credentials must have appropriate permissions.
   *
   * @example 'my-app-data'
   */
  readonly bucket: string;

  /**
   * Key prefix for this mount.
   *
   * All operations within this mount are scoped to keys with this prefix.
   * Prefix is automatically prepended to file paths in operations.
   *
   * @example 'user-uploads/', 'config/', ''
   */
  readonly prefix: string;

  /**
   * File pattern filter (optional).
   *
   * When provided, only files matching this glob pattern are accessible.
   * When undefined, all files are accessible (null = all files).
   *
   * Glob syntax follows standard patterns:
   * - `*` matches any characters except /
   * - `**` matches any characters including /
   * - `{a,b}` matches either a or b
   *
   * @example '*.json', '**\/*.txt', '*.{json,yaml}'
   */
  readonly glob?: string | undefined;

  /**
   * Maximum file size in bytes.
   *
   * Defaults to 10485760 bytes (10 MB).
   * Read and write operations throw when file exceeds this limit.
   */
  readonly maxFileSize?: number | undefined;
}

/**
 * AWS credentials configuration.
 *
 * Standard IAM credentials with access key ID and secret access key.
 * For production use, prefer IAM roles or environment-based credentials.
 */
export interface S3Credentials {
  /** AWS access key ID */
  readonly accessKeyId: string;
  /** AWS secret access key */
  readonly secretAccessKey: string;
}

/**
 * Configuration options for S3 file system extension.
 *
 * Defines S3 client configuration, mount definitions, and optional
 * settings for S3-compatible services (R2, MinIO, DigitalOcean Spaces, Backblaze B2).
 *
 * @example
 * ```typescript
 * // Standard AWS S3 configuration
 * const config: S3FsConfig = {
 *   region: 'us-west-2',
 *   credentials: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
 *   },
 *   mounts: {
 *     uploads: {
 *       mode: 'read-write',
 *       bucket: 'my-app-uploads',
 *       prefix: 'user-files/',
 *       glob: '*.{jpg,png,pdf}',
 *       maxFileSize: 10485760
 *     },
 *     backups: {
 *       mode: 'read',
 *       bucket: 'my-app-backups',
 *       prefix: 'database/'
 *     }
 *   }
 * };
 * ```
 *
 * @example
 * ```typescript
 * // MinIO (local S3-compatible service)
 * const config: S3FsConfig = {
 *   region: 'us-east-1',
 *   credentials: {
 *     accessKeyId: 'minioadmin',
 *     secretAccessKey: 'minioadmin'
 *   },
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   mounts: {
 *     local: {
 *       mode: 'read-write',
 *       bucket: 'test-bucket',
 *       prefix: ''
 *     }
 *   }
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Cloudflare R2
 * const config: S3FsConfig = {
 *   region: 'auto',
 *   credentials: {
 *     accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
 *   },
 *   endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *   mounts: {
 *     storage: {
 *       mode: 'read-write',
 *       bucket: 'my-r2-bucket',
 *       prefix: 'app-data/'
 *     }
 *   }
 * };
 * ```
 */
export interface S3FsConfig {
  /**
   * AWS region or 'auto' for S3-compatible services.
   *
   * For AWS S3, use standard region codes (e.g., 'us-west-2', 'eu-west-1').
   * For R2 and other services that don't use regions, use 'auto'.
   *
   * @example 'us-west-2', 'eu-central-1', 'auto'
   */
  readonly region: string;

  /**
   * AWS credentials (optional).
   *
   * When undefined, SDK uses default credential provider chain:
   * - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
   * - Shared credentials file (~/.aws/credentials)
   * - EC2 instance metadata service (IAM role)
   * - ECS task role
   *
   * For production deployments, prefer IAM roles over hardcoded credentials.
   */
  readonly credentials?: S3Credentials | undefined;

  /**
   * Custom endpoint for S3-compatible services (optional).
   *
   * Required for non-AWS S3 services:
   * - Cloudflare R2: `https://{account_id}.r2.cloudflarestorage.com`
   * - MinIO: `http://localhost:9000` or custom host
   * - DigitalOcean Spaces: `https://{region}.digitaloceanspaces.com`
   * - Backblaze B2: `https://s3.{region}.backblazeb2.com`
   *
   * @example 'http://localhost:9000', 'https://account.r2.cloudflarestorage.com'
   */
  readonly endpoint?: string | undefined;

  /**
   * Force path-style addressing (optional).
   *
   * When true, uses path-style URLs: `{endpoint}/{bucket}/{key}`
   * When false, uses virtual-hosted style: `{bucket}.{endpoint}/{key}`
   *
   * Required for:
   * - MinIO (always true)
   * - Some S3-compatible services that don't support virtual hosting
   *
   * AWS S3 defaults to virtual-hosted style (false).
   *
   * @default false
   */
  readonly forcePathStyle?: boolean | undefined;

  /**
   * Mount definitions keyed by mount name.
   *
   * Each mount represents a bucket/prefix combination with its own access mode.
   * Mount names are used in fs function calls (e.g., `fs::read('uploads', 'file.txt')`).
   *
   * Required field - at least one mount must be defined.
   */
  readonly mounts: Record<string, S3FsMountConfig>;
}
