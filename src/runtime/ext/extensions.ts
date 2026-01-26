import type { HostFunctionDefinition } from '../core/callable.js';
import type { RuntimeContext, ExtensionEvent } from '../core/types.js';
import { RuntimeError } from '../../types.js';
import { RILL_ERROR_CODES } from '../../types.js';

/**
 * Result object returned by extension factories.
 * Contains host function definitions with optional cleanup.
 */
export type ExtensionResult = Record<string, HostFunctionDefinition> & {
  dispose?: () => void | Promise<void>;
};

/**
 * Factory function contract for creating extensions.
 * Accepts typed configuration and returns isolated instance.
 */
export type ExtensionFactory<TConfig> = (config: TConfig) => ExtensionResult;

/**
 * Prefix all function names in an extension with a namespace.
 *
 * @param namespace - Alphanumeric string with hyphens (e.g., "fs", "http-client")
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
  // Validate namespace pattern: non-empty alphanumeric with hyphens only
  const NAMESPACE_PATTERN = /^[a-zA-Z0-9-]+$/;

  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Invalid namespace: must be non-empty alphanumeric with hyphens only, got "${namespace}"`
    );
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
 * Emit an extension event with auto-generated timestamp.
 * Adds ISO timestamp if event.timestamp is undefined, then calls onLogEvent callback.
 *
 * @param ctx - Runtime context containing callbacks
 * @param event - Extension event (timestamp auto-added if omitted)
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
  ctx: RuntimeContext,
  event: Omit<ExtensionEvent, 'timestamp'> & { timestamp?: string | undefined }
): void {
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
