/**
 * Resolver assembly for rill-config.
 * Builds the ResolverConfig used by RuntimeOptions.
 */

import {
  contextResolver,
  extResolver,
  moduleResolver,
  type RillValue,
  type SchemeResolver,
} from '@rcrsr/rill';
import type { NestedExtConfig, ResolverConfig } from './types.js';

// ============================================================
// TREE CONVERSION
// ============================================================

function convertTreeToRillValues(
  tree: NestedExtConfig
): Record<string, RillValue> {
  const result: Record<string, RillValue> = {};

  for (const [key, value] of Object.entries(tree)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'fn' in value &&
      typeof (value as { fn: unknown }).fn === 'function' &&
      'params' in value
    ) {
      const rillFn = value as {
        fn: (...args: unknown[]) => unknown;
        params: unknown;
        returnType?: unknown;
        description?: string;
      };
      result[key] = {
        __type: 'callable' as const,
        kind: 'application' as const,
        isProperty: false,
        fn: rillFn.fn,
        params: rillFn.params,
        returnType: rillFn.returnType,
        description: rillFn.description,
      } as unknown as RillValue;
    } else {
      result[key] = convertTreeToRillValues(
        value as NestedExtConfig
      ) as unknown as RillValue;
    }
  }

  return result;
}

// ============================================================
// BUILD RESOLVERS
// ============================================================

/**
 * Assembles the resolver map for RuntimeOptions.
 * - `ext:` uses extResolver with the converted extension tree as config
 * - `context:` uses contextResolver with contextValues for dot-path lookup
 * - `module:` routes ext and context to generated bindings; others to moduleResolver
 */
export function buildResolvers(options: {
  extTree: NestedExtConfig;
  contextValues: Record<string, unknown>;
  extensionBindings: string;
  contextBindings: string;
  modulesConfig: Record<string, string>;
}): ResolverConfig {
  const {
    extTree,
    contextValues,
    extensionBindings,
    contextBindings,
    modulesConfig,
  } = options;

  const extConfig = convertTreeToRillValues(extTree);

  // Build the module: resolver config, excluding reserved keys (ext, context)
  const userModuleConfig: Record<string, string> = {};
  for (const [id, path] of Object.entries(modulesConfig)) {
    if (id !== 'ext' && id !== 'context') {
      userModuleConfig[id] = path;
    }
  }

  const moduleSchemeResolver: SchemeResolver = (resource: string) => {
    if (resource === 'ext') {
      return { kind: 'source', text: extensionBindings };
    }
    if (resource === 'context') {
      return { kind: 'source', text: contextBindings };
    }
    return moduleResolver(resource, userModuleConfig);
  };

  return {
    resolvers: {
      ext: extResolver,
      context: contextResolver,
      module: moduleSchemeResolver,
    },
    configurations: {
      resolvers: {
        ext: extConfig,
        context: contextValues,
      },
    },
  };
}
