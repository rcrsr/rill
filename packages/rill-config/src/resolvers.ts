/**
 * Resolver assembly for rill-config.
 * Builds the ResolverConfig used by RuntimeOptions.
 */

import { resolve } from 'node:path';
import {
  contextResolver,
  extResolver,
  moduleResolver,
  type RillValue,
  type SchemeResolver,
} from '@rcrsr/rill';
import type { ResolverConfig } from './types.js';

// ============================================================
// BUILD RESOLVERS
// ============================================================

/**
 * Assembles the resolver map for RuntimeOptions.
 * - `ext:` uses extResolver with the extension tree as config
 * - `context:` uses contextResolver with contextValues for dot-path lookup
 * - `module:` routes ext and context to generated bindings; others to moduleResolver
 */
export function buildResolvers(options: {
  extTree: Record<string, RillValue>;
  contextValues: Record<string, unknown>;
  extensionBindings: string;
  contextBindings: string;
  modulesConfig: Record<string, string>;
  configDir: string;
}): ResolverConfig {
  const {
    extTree,
    contextValues,
    extensionBindings,
    contextBindings,
    modulesConfig,
    configDir,
  } = options;

  const extConfig = extTree;

  // Build the module: resolver config, excluding reserved keys (ext, context)
  const userModuleConfig: Record<string, string> = {};
  for (const [id, value] of Object.entries(modulesConfig)) {
    if (id !== 'ext' && id !== 'context') {
      userModuleConfig[id] = resolve(configDir, value);
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
