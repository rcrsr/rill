/**
 * Bindings generator for rill-run.
 * Walks a nested ext config tree and emits a rill source string
 * declaring all host functions with typed parameter annotations.
 */

import type { RillFunction, RillParam } from '@rcrsr/rill';
import type { NestedExtConfig } from './loader.js';

// ============================================================
// TYPE MAPPING
// ============================================================

function mapParamType(param: RillParam): string {
  if (param.type === undefined) {
    return 'any';
  }
  return param.type.type;
}

// ============================================================
// PARAM SERIALIZATION
// ============================================================

function serializeParam(param: RillParam): string {
  const parts: string[] = [];

  const desc = param.annotations['description'];
  if (typeof desc === 'string' && desc.length > 0) {
    parts.push(`^(description: "${desc}") `);
  }

  const typeName = mapParamType(param);
  parts.push(`${param.name}: ${typeName}`);

  return parts.join('');
}

// ============================================================
// LEAF DETECTION
// ============================================================

/**
 * Type guard: a node is a leaf RillFunction when it has { fn, params } shape.
 */
export function isLeafFunction(
  node: NestedExtConfig | RillFunction
): node is RillFunction {
  return (
    typeof node === 'object' &&
    node !== null &&
    'fn' in node &&
    typeof (node as RillFunction).fn === 'function' &&
    'params' in node &&
    Array.isArray((node as RillFunction).params)
  );
}

// ============================================================
// NESTED DICT BUILDER
// ============================================================

function buildNestedDict(
  node: NestedExtConfig,
  path: string,
  indent: string
): string {
  const entries: string[] = [];
  const childIndent = indent + '  ';

  for (const [key, child] of Object.entries(node)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;

    if (isLeafFunction(child)) {
      const paramStr = child.params.map(serializeParam).join(', ');
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:|${paramStr}|`);
    } else {
      const nested = buildNestedDict(
        child as NestedExtConfig,
        childPath,
        childIndent
      );
      entries.push(`${childIndent}${key}: ${nested}`);
    }
  }

  if (entries.length === 0) {
    return '[:]';
  }

  return `[\n${entries.join(',\n')}\n${indent}]`;
}

// ============================================================
// BINDINGS BUILDER
// ============================================================

/**
 * Build a rill source string from a nested ext config tree.
 * Returns a rill dict literal suitable for use as module:ext source.
 *
 * @param tree     - Nested dict of extension functions
 * @param basePath - Optional dot-separated prefix for all paths (default '')
 */
export function buildBindingsSource(
  tree: NestedExtConfig,
  basePath: string = ''
): string {
  return buildNestedDict(tree, basePath, '');
}
