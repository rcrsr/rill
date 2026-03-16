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
} from '../core/types.js';
import type { RillCallable, RillParam } from '../core/callable.js';
import { isCallable } from '../core/callable.js';
import { formatStructure, type RillValue } from '../core/values.js';

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
 * Produces `name: type` or `name: type = default` syntax.
 */
function formatParam(param: RillParam): string {
  const typeName =
    param.type !== undefined ? formatStructure(param.type) : 'any';
  if (param.defaultValue !== undefined) {
    return `${param.name}: ${typeName} = ${formatDefaultLiteral(param.defaultValue)}`;
  }
  return `${param.name}: ${typeName}`;
}

/**
 * Format a RillValue as a rill literal for default value rendering.
 */
function formatDefaultLiteral(value: RillValue): string {
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const items = value.map(formatDefaultLiteral).join(', ');
    return `list[${items}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '[:]';
    const pairs = entries
      .map(([k, v]) => `${k}: ${formatDefaultLiteral(v as RillValue)}`)
      .join(', ');
    return `[${pairs}]`;
  }
  return String(value);
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
    const paramStr = c.params.map(formatParam).join(', ');
    const returnSuffix = ` :${formatStructure(c.returnType.structure)}`;
    return `use<ext:${path}>:|${paramStr}|${returnSuffix}`;
  }

  if (isPlainDict(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '[:]';
    const childIndent = indent + '  ';
    const parts = entries.map(([key, child]) => {
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      const childSource = buildNestedSource(child, childPath, childIndent);
      return `${childIndent}${key}: ${childSource}`;
    });
    return `[\n${parts.join(',\n')}\n${indent}]`;
  }

  // Scalar, list, tuple, vector: resolve directly via ext resolver
  return `use<ext:${path}>`;
}

/**
 * Generate rill source bindings from an extension value map.
 * Returns a rill dict literal suitable for use as module:ext source.
 *
 * @throws {ExtensionBindingError} when binding generation fails
 */
function buildExtensionBindings(extensions: Record<string, RillValue>): string {
  try {
    const entries = Object.entries(extensions);
    if (entries.length === 0) return '[:]';

    const parts = entries.map(([name, value]) => {
      const source = buildNestedSource(value, name, '');
      return `  ${name}: ${source}`;
    });
    return `[\n${parts.join(',\n')}\n]`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExtensionBindingError(
      `Failed to generate extension bindings: ${reason}`
    );
  }
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
    throw new Error(`Unknown module '${resource}'`);
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
 * @throws {TypeError} when an extension value is undefined (EC-9)
 * @throws {ExtensionBindingError} when binding generation fails (EC-10)
 */
export function createTestContext(
  extensions: Record<
    string,
    { value: RillValue; dispose?: () => void | Promise<void> }
  >
): RuntimeContext {
  // EC-9: Validate no undefined extension values
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

  // Generate rill source bindings (EC-10: propagates ExtensionBindingError)
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
