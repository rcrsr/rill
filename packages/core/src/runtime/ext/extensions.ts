import type { HostFunctionDefinition } from '../core/callable.js';
import type { ExtensionEvent, RuntimeCallbacks } from '../core/types.js';

/**
 * Minimal interface for extension event emission.
 * Allows emitExtensionEvent to accept any context with callbacks.
 */
interface RuntimeContextLike {
  readonly callbacks?: RuntimeCallbacks | undefined;
}

/**
 * Result object returned by extension factories.
 * Contains host function definitions with optional cleanup.
 */
export type ExtensionResult = Record<string, HostFunctionDefinition> & {
  dispose?: () => void | Promise<void>;
};

/**
 * Result object returned by hoistExtension.
 * Separates functions from dispose for safe createRuntimeContext usage.
 */
export interface HoistedExtension {
  functions: Record<string, HostFunctionDefinition>;
  dispose?: () => void | Promise<void>;
}

/**
 * Factory function contract for creating extensions.
 * Accepts typed configuration and returns isolated instance.
 */
export type ExtensionFactory<TConfig> = (config: TConfig) => ExtensionResult;

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
  readonly get: HostFunctionDefinition;
  readonly get_or: HostFunctionDefinition;
  readonly set: HostFunctionDefinition;
  readonly merge: HostFunctionDefinition;
  readonly delete: HostFunctionDefinition;
  readonly keys: HostFunctionDefinition;
  readonly has: HostFunctionDefinition;
  readonly clear: HostFunctionDefinition;
  readonly getAll: HostFunctionDefinition;
  readonly schema: HostFunctionDefinition;
  readonly mounts: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
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
  readonly read: HostFunctionDefinition;
  readonly write: HostFunctionDefinition;
  readonly append: HostFunctionDefinition;
  readonly list: HostFunctionDefinition;
  readonly find: HostFunctionDefinition;
  readonly exists: HostFunctionDefinition;
  readonly remove: HostFunctionDefinition;
  readonly stat: HostFunctionDefinition;
  readonly mkdir: HostFunctionDefinition;
  readonly copy: HostFunctionDefinition;
  readonly move: HostFunctionDefinition;
  readonly mounts: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};

/**
 * Contract type for llm extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 5 functions:
 * - message(text, options): Send single message
 * - messages(messages, options): Multi-turn conversation
 * - embed(text): Generate embedding vector
 * - embed_batch(texts): Batch embeddings
 * - tool_loop(prompt, options): Tool use orchestration
 */
export type LlmExtensionContract = {
  readonly message: HostFunctionDefinition;
  readonly messages: HostFunctionDefinition;
  readonly embed: HostFunctionDefinition;
  readonly embed_batch: HostFunctionDefinition;
  readonly tool_loop: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};

/**
 * Contract type for vector extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 11 functions:
 * - upsert(id, vector, metadata): Insert or update vector
 * - upsert_batch(items): Batch insert/update
 * - search(vector, options): Search k nearest neighbors
 * - get(id): Fetch vector by ID
 * - delete(id): Delete vector by ID
 * - delete_batch(ids): Batch delete
 * - count(): Count vectors in collection
 * - create_collection(name, options): Create collection
 * - delete_collection(name): Delete collection
 * - list_collections(): List all collections
 * - describe(): Get collection metadata
 */
export type VectorExtensionContract = {
  readonly upsert: HostFunctionDefinition;
  readonly upsert_batch: HostFunctionDefinition;
  readonly search: HostFunctionDefinition;
  readonly get: HostFunctionDefinition;
  readonly delete: HostFunctionDefinition;
  readonly delete_batch: HostFunctionDefinition;
  readonly count: HostFunctionDefinition;
  readonly create_collection: HostFunctionDefinition;
  readonly delete_collection: HostFunctionDefinition;
  readonly list_collections: HostFunctionDefinition;
  readonly describe: HostFunctionDefinition;
  readonly dispose?: (() => void | Promise<void>) | undefined;
};

/**
 * Prefix all function names in an extension with a namespace.
 *
 * @param namespace - Alphanumeric string with underscores/hyphens (e.g., "fs", "claude_code")
 * @param functions - Extension result with function definitions
 * @returns New ExtensionResult with prefixed function names (namespace::functionName)
 * @throws {RuntimeError} RUNTIME_TYPE_ERROR if namespace is invalid
 *
 * @example
 * ```typescript
 * const fs = createFsExtension();
 * const prefixed = prefixFunctions("fs", fs);
 * // { "fs::read": ..., "fs::write": ..., dispose: ... }
 * ```
 */
export function prefixFunctions(
  namespace: string,
  functions: ExtensionResult
): ExtensionResult {
  // EC-7: Extension not object
  if (
    typeof functions !== 'object' ||
    functions === null ||
    Array.isArray(functions)
  ) {
    throw new TypeError('Extension must be an object');
  }

  // EC-6: Invalid namespace format
  const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]+$/;

  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/');
  }

  // Create new object with prefixed keys
  const result: Record<string, HostFunctionDefinition> = {};

  for (const [name, definition] of Object.entries(functions)) {
    // Skip the dispose method during prefixing
    if (name === 'dispose') continue;

    result[`${namespace}::${name}`] = definition as HostFunctionDefinition;
  }

  // Preserve dispose method if present
  const resultWithDispose: ExtensionResult = result;
  if (functions.dispose !== undefined) {
    resultWithDispose.dispose = functions.dispose;
  }

  return resultWithDispose;
}

/**
 * Separate dispose from functions for safe createRuntimeContext usage.
 * Wraps prefixFunctions and returns separated structure.
 *
 * @param namespace - String matching /^[a-zA-Z0-9_-]+$/
 * @param extension - Output from extension factory
 * @returns Separated functions and dispose handler
 * @throws {Error} If namespace is empty
 * @throws {Error} If namespace has invalid format
 * @throws {TypeError} If extension is null or undefined
 *
 * @example
 * ```typescript
 * const { functions, dispose } = hoistExtension('db', dbExtension);
 * const ctx = createRuntimeContext({ functions });
 * ```
 */
export function hoistExtension(
  namespace: string,
  extension: ExtensionResult
): HoistedExtension {
  // EC-3: Null/undefined extension
  if (extension === null || extension === undefined) {
    throw new TypeError('Extension cannot be null or undefined');
  }

  // EC-2: Empty namespace
  if (namespace === '') {
    throw new Error('Namespace cannot be empty');
  }

  // EC-1: Invalid namespace format
  const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]+$/;
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/');
  }

  // Call prefixFunctions internally
  const prefixed = prefixFunctions(namespace, extension);

  // Extract dispose from result
  const { dispose, ...functions } = prefixed;

  // Return separated structure
  const result: HoistedExtension = {
    functions: functions as Record<string, HostFunctionDefinition>,
  };

  // Only add dispose if it exists (exactOptionalPropertyTypes)
  if (dispose !== undefined) {
    result.dispose = dispose;
  }

  return result;
}

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
    throw new Error('Event must include non-empty event field');
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
