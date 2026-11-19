/**
 * Test Context Factory
 *
 * Creates a pre-wired RuntimeContext from extension value maps.
 * Designed for testing and lightweight embedding without rill-config.
 */

import { parseSource } from '../../ext-parse-bridge.js';
import { createRuntimeContext } from '../core/context.js';
import { extResolver } from '../core/resolvers.js';
import type {
  RuntimeContext,
  SchemeResolver,
  ResolverResult,
} from '../core/types/runtime.js';
import { declaredParams, isCallable } from '../core/callable.js';
import { isPlainDict } from '../core/types/guards.js';
import { RuntimeHaltSignal } from '../core/types/halt.js';
import { ControlSignal } from '../core/signals.js';
import type { RillValue } from '../core/types/structures.js';
import { setDictField } from '../core/types/dict-keys.js';
import { formatStructure } from '../core/types/operations.js';
import { paramsToFieldDefs } from '../core/types/fn-params.js';
import { resolveReturnStructure } from '../core/introspection.js';
import {
  formatFieldKey,
  isBareIdentifier,
  quoteRillString,
} from '../core/types/format-string.js';
import { RuntimeError } from '../../types.js';
import { ERROR_IDS } from '../../error-registry.js';

// ============================================================
// ERROR CLASS
// ============================================================

/**
 * Error thrown when extension binding generation fails.
 * Mirrors the ExtensionBindingError in rill-config for core-only usage.
 */
export class ExtensionBindingError extends Error {
  readonly code = 'EXTENSION_BINDING' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ExtensionBindingError';
  }
}

// ============================================================
// BINDING GENERATOR
// ============================================================

/**
 * Format a `use<ext:path>` reference. The static `scheme:seg1.seg2` form
 * requires every dot-separated segment to be a bare identifier; a path
 * with a non-identifier segment (e.g. `user-id`) instead uses the
 * computed form `use<("ext:path")>`, which carries the same scheme and
 * resource as an ordinary string literal.
 */
function formatUseRef(path: string): string {
  const isBarePath = path
    .split('.')
    .every((segment) => isBareIdentifier(segment));
  return isBarePath
    ? `use<ext:${path}>`
    : `use<(${quoteRillString(`ext:${path}`)})>`;
}

/**
 * Generate rill source for a nested value tree.
 * Callable leaves produce `use<ext:path>:fn(params):returnType`.
 * Dict nodes recurse. All other values produce `use<ext:path>`.
 */
function buildNestedSource(
  value: RillValue,
  path: string,
  indent: string
): string {
  if (isCallable(value)) {
    const c = value;
    const fnType = formatStructure({
      kind: 'fn',
      params: paramsToFieldDefs(declaredParams(c, path)),
      ret: resolveReturnStructure(c),
    });
    return `${formatUseRef(path)}:${fnType}`;
  }

  if (isPlainDict(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '[:]';
    const childIndent = indent + '  ';
    const parts = entries.map(([key, child]) => {
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      const childSource = buildNestedSource(child, childPath, childIndent);
      return `${childIndent}${formatFieldKey(key)}: ${childSource}`;
    });
    return `[\n${parts.join(',\n')}\n${indent}]`;
  }

  // Scalar, list, tuple, vector: resolve directly via ext resolver
  return formatUseRef(path);
}

/**
 * Generate rill source bindings from an extension value map.
 * Returns a rill dict literal suitable for use as module:ext source.
 *
 * @throws {ExtensionBindingError} when binding generation fails
 * @throws {RuntimeHaltSignal} RILL-R085 when a callable has no parameter declaration
 */
function buildExtensionBindings(extensions: Record<string, RillValue>): string {
  const entries = Object.entries(extensions);
  let bindingSource: string;

  try {
    if (entries.length === 0) {
      bindingSource = '[:]';
    } else {
      const parts = entries.map(([name, value]) => {
        const source = buildNestedSource(value, name, '');
        return `  ${formatFieldKey(name)}: ${source}`;
      });
      bindingSource = `[\n${parts.join(',\n')}\n]`;
    }

    // Eager-parse the generated source so a generation defect (e.g. a
    // reserved-word parameter name) surfaces here, synchronously, rather
    // than as a RILL-R056 the first time a consumer calls execute().
    parseSource(bindingSource);
  } catch (err) {
    if (err instanceof RuntimeHaltSignal || err instanceof ControlSignal)
      throw err;
    const reason = err instanceof Error ? err.message : String(err);
    const keys = entries.map(([name]) => name).join(', ');
    throw new ExtensionBindingError(
      `Failed to generate extension bindings: ${reason} (bindings: ${keys})`
    );
  }

  return bindingSource;
}

// ============================================================
// MODULE RESOLVER FOR EXT BINDINGS
// ============================================================

/**
 * Create a module resolver that serves generated extension binding source.
 * Handles only the `ext` resource; rejects all other module IDs.
 */
function createExtModuleResolver(bindingSource: string): SchemeResolver {
  return (resource: string): ResolverResult => {
    if (resource === 'ext') {
      return { kind: 'source', text: bindingSource, sourceId: 'module:ext' };
    }
    throw new RuntimeError(ERROR_IDS.RILL_R076, `Unknown module '${resource}'`);
  };
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Create a RuntimeContext pre-wired with extension values.
 * Builds extension bindings, registers ext and module resolvers,
 * and returns a context ready for execute().
 *
 * @throws {TypeError} when an extension value is undefined
 * @throws {ExtensionBindingError} when binding generation fails
 */
export function createTestContext(
  extensions: Record<
    string,
    { value: RillValue; dispose?: () => void | Promise<void> }
  >
): RuntimeContext {
  // Validate no undefined extension values
  for (const [name, entry] of Object.entries(extensions)) {
    if (entry.value === undefined) {
      throw new TypeError(`Extension '${name}' has undefined value`);
    }
  }

  // Build ext resolver config: maps extension names to their RillValues
  const extConfig: Record<string, RillValue> = {};
  for (const [name, entry] of Object.entries(extensions)) {
    setDictField(extConfig, name, entry.value);
  }

  // Generate rill source bindings (propagates ExtensionBindingError)
  const bindingSource = buildExtensionBindings(extConfig);

  // Create module resolver for ext bindings
  const extModuleResolver = createExtModuleResolver(bindingSource);

  const ctx = createRuntimeContext({
    resolvers: {
      ext: extResolver,
      module: extModuleResolver,
    },
    configurations: {
      resolvers: {
        ext: extConfig,
      },
    },
    parseSource,
  });

  // The test context owns its extensions, so ctx.dispose() also runs each
  // extension's dispose hook, after the runtime itself has shut down.
  const hooks = Object.values(extensions).flatMap((entry) =>
    entry.dispose ? [entry.dispose] : []
  );
  if (hooks.length === 0) return ctx;

  const disposeRuntime = ctx.dispose.bind(ctx);
  let disposePromise: Promise<void> | null = null;
  const wrappedDispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      let runtimeFailure: { readonly reason: unknown } | undefined;
      try {
        await disposeRuntime();
      } catch (reason) {
        runtimeFailure = { reason };
      }
      const outcomes = await Promise.allSettled(
        // oxlint-disable-next-line require-await -- the async wrapper turns a synchronous hook throw into a rejection that allSettled collects
        hooks.map(async (hook) => hook())
      );
      const failure = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected'
      );
      if (failure) throw failure.reason;
      if (runtimeFailure) throw runtimeFailure.reason;
    })();
    return disposePromise;
  };
  // dispose is a readonly facade field; redefine it on the context instance.
  Object.defineProperty(ctx, 'dispose', {
    value: wrappedDispose,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return ctx;
}
