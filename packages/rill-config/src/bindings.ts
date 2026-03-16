/**
 * Bindings generators for rill-config.
 * Produces rill source strings for extension and context module bindings.
 */

import {
  formatStructure,
  isApplicationCallable,
  isTuple,
  isVector,
  parse,
} from '@rcrsr/rill';
import type { RillParam, RillValue } from '@rcrsr/rill';
import { ExtensionBindingError } from './errors.js';
import type { ContextFieldSchema } from './types.js';

// ============================================================
// EXTENSION BINDINGS
// ============================================================

function mapParamType(param: RillParam): string {
  if (param.type === undefined) {
    return 'any';
  }
  return formatStructure(param.type);
}

function formatDefaultLiteral(value: unknown): string {
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    const items = value.map(formatDefaultLiteral).join(', ');
    return `list[${items}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '[:]';
    }
    const pairs = entries
      .map(([k, v]) => `${k}: ${formatDefaultLiteral(v)}`)
      .join(', ');
    return `[${pairs}]`;
  }
  return String(value);
}

function serializeParam(param: RillParam): string {
  const typeName = mapParamType(param);
  if (param.defaultValue !== undefined) {
    return `${param.name}: ${typeName} = ${formatDefaultLiteral(param.defaultValue)}`;
  }
  return `${param.name}: ${typeName}`;
}

function buildNestedDict(
  node: Record<string, RillValue>,
  path: string,
  indent: string
): string {
  const entries: string[] = [];
  const childIndent = indent + '  ';

  for (const [key, child] of Object.entries(node)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;

    if (isApplicationCallable(child)) {
      const paramStr = child.params.map(serializeParam).join(', ');
      const returnSuffix = ` :${formatStructure(child.returnType.structure)}`;
      entries.push(
        `${childIndent}${key}: use<ext:${childPath}>:|${paramStr}|${returnSuffix}`
      );
    } else if (typeof child === 'string') {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:string`);
    } else if (typeof child === 'number') {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:number`);
    } else if (typeof child === 'boolean') {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:bool`);
    } else if (Array.isArray(child)) {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:list`);
    } else if (isTuple(child)) {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:tuple`);
    } else if (isVector(child)) {
      entries.push(`${childIndent}${key}: use<ext:${childPath}>:vector`);
    } else if (typeof child === 'object' && child !== null) {
      const nested = buildNestedDict(
        child as Record<string, RillValue>,
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
 * Parse-validates the output before returning.
 * Throws ExtensionBindingError if generated source fails to parse.
 */
export function buildExtensionBindings(
  extTree: Record<string, RillValue>,
  basePath?: string
): string {
  const source = buildNestedDict(extTree, basePath ?? '', '');
  try {
    parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ExtensionBindingError(
      `Extension bindings failed to parse: ${message}`
    );
  }
  return source;
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
