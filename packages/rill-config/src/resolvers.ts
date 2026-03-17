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
 * - `module:` uses folder aliasing — each config key maps to a directory,
 *   dot-paths resolve to files within: `module:alias.sub.path` → `{dir}/sub/path.rill`
 */
export function buildResolvers(options: {
  extTree: Record<string, RillValue>;
  contextValues: Record<string, unknown>;
  modulesConfig: Record<string, string>;
  configDir: string;
}): ResolverConfig {
  const { extTree, contextValues, modulesConfig, configDir } = options;

  const extConfig = extTree;

  // Build the module: resolver config, resolving all folder paths relative to configDir
  const moduleDirs: Record<string, string> = {};
  for (const [id, value] of Object.entries(modulesConfig)) {
    moduleDirs[id] = resolve(configDir, value);
  }

  const moduleSchemeResolver: SchemeResolver = (resource: string) => {
    const dotIndex = resource.indexOf('.');
    const alias = dotIndex === -1 ? resource : resource.slice(0, dotIndex);

    const dirPath = moduleDirs[alias];
    if (dirPath === undefined) {
      return moduleResolver(resource, {});
    }

    const subPath = dotIndex === -1 ? '' : resource.slice(dotIndex + 1);
    const relPath =
      subPath.length > 0
        ? subPath.replaceAll('.', '/') + '.rill'
        : 'index.rill';
    const filePath = resolve(dirPath, relPath);

    return moduleResolver(resource, { [resource]: filePath });
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
