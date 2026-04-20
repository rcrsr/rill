import type {
  ExtensionEvent,
  ExtensionFactoryCtx,
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
 * Factory function contract for creating extensions (IR-10).
 *
 * Accepts typed configuration and a factory-scope {@link ExtensionFactoryCtx}.
 * Returns (or resolves to) an {@link ExtensionFactoryResult}.
 *
 * The factory-scope ctx exposes exactly `{ registerErrorCode, signal }`
 * (IR-9, NFR-ERR-4). Host-scope helpers like `invalidate` and `catch` are
 * intentionally absent at factory init time.
 */
export type ExtensionFactory<TConfig> = (
  config: TConfig,
  ctx: ExtensionFactoryCtx
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
