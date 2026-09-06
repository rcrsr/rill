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
import type { RillCallable, RillParam } from '../core/callable.js';
import { isCallable } from '../core/callable.js';
import type { RillValue } from '../core/types/structures.js';
import { formatStructure } from '../core/types/operations.js';
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
 * Format a RillParam as a rill source parameter declaration.
 * Produces `name: type` syntax matching the parser's closure annotation grammar.
 */
function formatParam(param: RillParam): string {
  const typeName =
    param.type !== undefined ? formatStructure(param.type) : 'any';
  return `${param.name}: ${typeName}`;
}

/** Matches a bare snake_case identifier per the lexer's identifier grammar. */
const BARE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Format a dict key, quoting it as a rill string literal when it is not a
 * valid bare identifier (e.g. `"user-id"` rather than `user-id`).
 */
function formatDictKey(key: string): string {
  return BARE_IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

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
    .every((segment) => BARE_IDENTIFIER_RE.test(segment));
  return isBarePath
    ? `use<ext:${path}>`
    : `use<(${JSON.stringify(`ext:${path}`)})>`;
}

/**
 * Check if a RillValue is a plain dict (not a callable, tuple, vector, etc.).
 */
function isPlainDict(value: RillValue): value is Record<string, RillValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isCallable(value) &&
    !('__rill_tuple' in value) &&
    !('__rill_vector' in value) &&
    !('__rill_ordered' in value) &&
    !('__rill_type' in value) &&
    !('__rill_field_descriptor' in value)
  );
}

/**
 * Generate rill source for a nested value tree.
 * Callable leaves produce `use<ext:path>:|params| :returnType`.
 * Dict nodes recurse. All other values produce `use<ext:path>`.
 */
function buildNestedSource(
  value: RillValue,
  path: string,
  indent: string
): string {
  if (isCallable(value)) {
    const c = value as RillCallable;
    // An untyped callable (e.g. from the public `callable()` factory) may carry
    // no declared params. Treat undefined params as an empty declaration and
    // resolve it directly via the ext resolver rather than emitting a typed
    // signature we cannot construct.
    if (c.params === undefined) {
      return formatUseRef(path);
    }
    const paramStr = c.params.map(formatParam).join(', ');
    const returnSuffix = ` :${formatStructure(c.returnType.structure)}`;
    return `${formatUseRef(path)}:|${paramStr}|${returnSuffix}`;
  }

  if (isPlainDict(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '[:]';
    const childIndent = indent + '  ';
    const parts = entries.map(([key, child]) => {
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      const childSource = buildNestedSource(child, childPath, childIndent);
      return `${childIndent}${formatDictKey(key)}: ${childSource}`;
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
        return `  ${formatDictKey(name)}: ${source}`;
      });
      bindingSource = `[\n${parts.join(',\n')}\n]`;
    }

    // Eager-parse the generated source so a generation defect (e.g. a
    // reserved-word parameter name) surfaces here, synchronously, rather
    // than as a RILL-R056 the first time a consumer calls execute().
    parseSource(bindingSource);
  } catch (err) {
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
    extConfig[name] = entry.value;
  }

  // Generate rill source bindings (propagates ExtensionBindingError)
  const bindingSource = buildExtensionBindings(extConfig);

  // Create module resolver for ext bindings
  const extModuleResolver = createExtModuleResolver(bindingSource);

  return createRuntimeContext({
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
}
