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
