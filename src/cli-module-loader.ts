/**
 * CLI Module Loader
 *
 * Implements module loading for the Rill CLI with circular dependency detection.
 * See docs/13_modules.md for module convention specification.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { parse } from './parser/index.js';
import { execute, createRuntimeContext } from './runtime/index.js';
import type { RillValue } from './runtime/index.js';

/**
 * Load a module and its dependencies recursively.
 *
 * @param specifier - Module path (relative or absolute)
 * @param fromPath - Path of the importing file
 * @param cache - Module cache keyed by canonical path
 * @param chain - Set of paths in current import chain for circular detection
 * @returns Dict of exported values
 * @throws Error if module not found or circular dependency detected
 */
export async function loadModule(
  specifier: string,
  fromPath: string,
  cache: Map<string, Record<string, RillValue>>,
  chain: Set<string> = new Set()
): Promise<Record<string, RillValue>> {
  // Resolve to absolute canonical path
  const absolutePath = path.resolve(path.dirname(fromPath), specifier);

  // Check for circular dependency
  if (chain.has(absolutePath)) {
    const cycle = [...chain, absolutePath].join(' -> ');
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  // Return cached module if already loaded
  if (cache.has(absolutePath)) {
    return cache.get(absolutePath)!;
  }

  // Check if module file exists
  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error(`Module not found: ${specifier}`);
  }

  // Add to chain to detect cycles in dependencies
  chain.add(absolutePath);

  try {
    // Load and parse module source
    const source = await fs.readFile(absolutePath, 'utf-8');
    const ast = parse(source);

    // Extract frontmatter (yaml.parse returns null for empty content)
    const frontmatter: Record<string, unknown> = ast.frontmatter
      ? ((yaml.parse(ast.frontmatter.content) as Record<
          string,
          unknown
        > | null) ?? {})
      : {};

    // Resolve dependencies first
    const imports: Record<string, RillValue> = {};
    if (frontmatter['use'] && Array.isArray(frontmatter['use'])) {
      for (const entry of frontmatter['use']) {
        if (typeof entry === 'object' && entry !== null) {
          const [name, depPath] = Object.entries(entry)[0] as [string, string];
          imports[name] = await loadModule(depPath, absolutePath, cache, chain);
        }
      }
    }

    // Execute module with dependencies
    const ctx = createRuntimeContext({ variables: imports });
    const result = await execute(ast, ctx);

    // Extract exports
    const exports: Record<string, RillValue> = {};
    const exportList: unknown = frontmatter['export'];
    if (Array.isArray(exportList)) {
      for (const name of exportList) {
        if (typeof name === 'string' && result.variables[name] !== undefined) {
          exports[name] = result.variables[name];
        }
      }
    }

    // Cache and return
    cache.set(absolutePath, exports);
    return exports;
  } finally {
    // Remove from chain after processing
    chain.delete(absolutePath);
  }
}
