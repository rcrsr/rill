/**
 * Bindings generators for rill-config.
 * Produces rill source strings for extension and context module bindings.
 */

import type { RillFunction, RillParam } from '@rcrsr/rill';
import type { ContextFieldSchema, NestedExtConfig } from './types.js';

// ============================================================
// EXTENSION BINDINGS
// ============================================================

function mapParamType(param: RillParam): string {
  if (param.type === undefined) {
    return 'any';
  }
  return param.type.type;
}

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
      const returnSuffix =
        child.returnType !== undefined ? ` :${child.returnType.type}` : '';
      entries.push(
        `${childIndent}${key}: use<ext:${childPath}>:|${paramStr}|${returnSuffix}`
      );
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

/**
 * Generate rill source for extension bindings.
 * Returns a rill dict literal suitable for use as module:ext source.
 * Pure function. No errors.
 */
export function buildExtensionBindings(
  extTree: NestedExtConfig,
  basePath?: string
): string {
  return buildNestedDict(extTree, basePath ?? '', '');
}

// ============================================================
// CONTEXT BINDINGS
// ============================================================

/**
 * Generate rill source for context bindings.
 * Returns a rill dict literal that declares each context key with its type.
 * Scripts import this via use<module:context>.
 * Pure function. No errors.
 */
export function buildContextBindings(
  schema: Record<string, ContextFieldSchema>,
  values: Record<string, unknown>
): string {
  const entries: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = values[key];
    const rillType = fieldSchema.type === 'bool' ? 'bool' : fieldSchema.type;

    let rillLiteral: string;
    if (rillType === 'string') {
      const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      rillLiteral = `"${escaped}"`;
    } else if (rillType === 'number') {
      rillLiteral = String(value);
    } else {
      // bool
      rillLiteral = value ? 'true' : 'false';
    }

    entries.push(`  ${key}: ${rillLiteral}`);
  }

  if (entries.length === 0) {
    return '[:]';
  }

  return `[\n${entries.join(',\n')}\n]`;
}
