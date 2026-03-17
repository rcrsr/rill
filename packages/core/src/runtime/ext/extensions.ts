import type { ApplicationCallable } from '../core/callable.js';
import type {
  ExtensionEvent,
  RuntimeCallbacks,
} from '../core/types/runtime.js';
import type { RillValue } from '../core/types/structures.js';
import { RuntimeError } from '../../types.js';

/**
 * Minimal interface for extension event emission.
 * Allows emitExtensionEvent to accept any context with callbacks.
 */
interface RuntimeContextLike {
  readonly callbacks?: RuntimeCallbacks | undefined;
}

/**
 * Result object returned by extension factories.
 * Contains the mounted RillValue with optional lifecycle hooks.
 * Lifecycle hooks live on the factory result, not on the value dict (DD-1).
 */
export interface ExtensionFactoryResult {
  readonly value: RillValue;
  dispose?: () => void | Promise<void>;
  suspend?: () => unknown;
  restore?: (state: unknown) => void;
}

/**
 * Factory function contract for creating extensions.
 * Accepts typed configuration and returns isolated instance.
 */
export type ExtensionFactory<TConfig> = (
  config: TConfig
) => ExtensionFactoryResult | Promise<ExtensionFactoryResult>;

/**
 * Descriptor for a single configuration field in an extension schema.
 * The secret flag is advisory: harness tooling uses it to mask or omit values.
 * It does not affect runtime behavior.
 */
export interface ConfigFieldDescriptor {
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly secret?: boolean;
}

/**
 * Schema definition for extension configuration.
 * Maps field names to their descriptors.
 */
export type ExtensionConfigSchema = Record<string, ConfigFieldDescriptor>;

/**
 * Manifest describing a self-contained extension.
 * Carries the factory, optional config schema, and version metadata.
 */
export interface ExtensionManifest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly factory: ExtensionFactory<any>;
  readonly configSchema?: ExtensionConfigSchema | undefined;
  readonly version?: string | undefined;
}

/**
 * Contract type for kv extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 11 functions:
 * - get(mount, key): Retrieve value or null
 * - get_or(mount, key, fallback): Retrieve value with fallback
 * - set(mount, key, value): Store value
 * - merge(mount, key, partial): Merge dict properties
 * - delete(mount, key): Remove key
 * - keys(mount): List all keys
 * - has(mount, key): Check key existence
 * - clear(mount): Remove all keys
 * - getAll(mount): Retrieve all key-value pairs
 * - schema(mount): Get mount schema metadata
 * - mounts(): List all configured mounts
 */
export type KvExtensionContract = {
  readonly get: ApplicationCallable;
  readonly get_or: ApplicationCallable;
  readonly set: ApplicationCallable;
  readonly merge: ApplicationCallable;
  readonly delete: ApplicationCallable;
  readonly keys: ApplicationCallable;
  readonly has: ApplicationCallable;
  readonly clear: ApplicationCallable;
  readonly getAll: ApplicationCallable;
  readonly schema: ApplicationCallable;
  readonly mounts: ApplicationCallable;
};

/**
 * Contract type for fs extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 12 functions:
 * - read(mount, path): Read file content
 * - write(mount, path, content): Write file content
 * - append(mount, path, content): Append to file
 * - list(mount, path?): List directory entries
 * - find(mount, pattern?): Find files by pattern
 * - exists(mount, path): Check file/directory existence
 * - remove(mount, path): Delete file/directory
 * - stat(mount, path): Get file metadata
 * - mkdir(mount, path): Create directory
 * - copy(mount, src, dest): Copy file/directory
 * - move(mount, src, dest): Move file/directory
 * - mounts(): List all configured mounts
 */
export type FsExtensionContract = {
  readonly read: ApplicationCallable;
  readonly write: ApplicationCallable;
  readonly append: ApplicationCallable;
  readonly list: ApplicationCallable;
  readonly find: ApplicationCallable;
  readonly exists: ApplicationCallable;
  readonly remove: ApplicationCallable;
  readonly stat: ApplicationCallable;
  readonly mkdir: ApplicationCallable;
  readonly copy: ApplicationCallable;
  readonly move: ApplicationCallable;
  readonly mounts: ApplicationCallable;
};

/**
 * Emit an extension event with auto-generated timestamp.
 * Adds ISO timestamp if event.timestamp is undefined, then calls onLogEvent callback.
 *
 * @param ctx - Runtime context or context-like object containing callbacks
 * @param event - Extension event (timestamp auto-added if omitted)
 * @throws {TypeError} If ctx is null or undefined
 * @throws {Error} If event.event is missing or empty
 *
 * @example
 * ```typescript
 * emitExtensionEvent(ctx, {
 *   event: 'extension_initialized',
 *   subsystem: 'extension:openai',
 *   config: { model: 'gpt-4' }
 * });
 * // Calls ctx.callbacks.onLogEvent with timestamp added
 * ```
 */
export function emitExtensionEvent(
  ctx: RuntimeContextLike,
  event: Omit<ExtensionEvent, 'timestamp'> & { timestamp?: string | undefined }
): void {
  // EC-4: Null/undefined context
  if (ctx === null || ctx === undefined) {
    throw new TypeError('Context cannot be null or undefined');
  }

  // EC-5: Missing/empty event.event field
  if (
    !event['event'] ||
    typeof event['event'] !== 'string' ||
    event['event'].trim() === ''
  ) {
    throw new RuntimeError(
      'RILL-R075',
      'Event must include non-empty event field'
    );
  }

  // IC-2: Guard for callbacks property (graceful degradation)
  if ('callbacks' in ctx && ctx.callbacks) {
    // Call callback if defined
    if (ctx.callbacks.onLogEvent !== undefined) {
      // Auto-add timestamp if not present
      const eventWithTimestamp = {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      } as ExtensionEvent;
      ctx.callbacks.onLogEvent(eventWithTimestamp);
    }
  }
}
