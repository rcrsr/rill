/**
 * CLI Module Loader
 *
 * Implements module loading for the Rill CLI with circular dependency detection.
 * See docs/integration-modules.md for module convention specification.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from '@rcrsr/rill';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

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

    // Execute module
    const ctx = createRuntimeContext({});
    const execResult = await execute(ast, ctx);

    // Cache and return (module result is the final expression value)
    const result = { '': execResult.result };
    cache.set(absolutePath, result);
    return result;
  } finally {
    // Remove from chain after processing
    chain.delete(absolutePath);
  }
}
