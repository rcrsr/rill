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
import type { RillParam, RillValue, TypeStructure } from '@rcrsr/rill';
import { ExtensionBindingError } from './errors.js';
import type { ContextFieldSchema } from './types.js';

// ============================================================
// EXTENSION BINDINGS
// ============================================================

/**
 * Strip field defaultValues from a TypeStructure recursively.
 * Use-expression closure annotations only support `name: type` — no
 * `= default` in type arg lists. This produces a parse-safe version.
 */
function stripAnnotationType(structure: TypeStructure): TypeStructure {
  if (structure.kind === 'dict') {
    const s = structure as {
      kind: 'dict';
      fields?: Record<string, { type: TypeStructure }>;
      valueType?: TypeStructure;
    };
    if (s.fields !== undefined) {
      const stripped: Record<string, { type: TypeStructure }> = {};
      for (const [k, field] of Object.entries(s.fields)) {
        stripped[k] = { type: stripAnnotationType(field.type) };
      }
      return { kind: 'dict', fields: stripped };
    }
    if (s.valueType !== undefined) {
      return { kind: 'dict', valueType: stripAnnotationType(s.valueType) };
    }
    return structure;
  }
  if (structure.kind === 'tuple') {
    const s = structure as {
      kind: 'tuple';
      elements?: Array<{ type: TypeStructure }>;
      valueType?: TypeStructure;
    };
    if (s.elements !== undefined) {
      return {
        kind: 'tuple',
        elements: s.elements.map((el) => ({
          type: stripAnnotationType(el.type),
        })),
      };
    }
    if (s.valueType !== undefined) {
      return { kind: 'tuple', valueType: stripAnnotationType(s.valueType) };
    }
    return structure;
  }
  if (structure.kind === 'ordered') {
    const s = structure as {
      kind: 'ordered';
      fields?: Array<{ name?: string; type: TypeStructure }>;
      valueType?: TypeStructure;
    };
    if (s.fields !== undefined) {
      return {
        kind: 'ordered',
        fields: s.fields.map((f) => ({
          name: f.name,
          type: stripAnnotationType(f.type),
        })),
      };
    }
    if (s.valueType !== undefined) {
      return { kind: 'ordered', valueType: stripAnnotationType(s.valueType) };
    }
    return structure;
  }
  if (structure.kind === 'list') {
    const s = structure as { kind: 'list'; element?: TypeStructure };
    if (s.element !== undefined) {
      return { kind: 'list', element: stripAnnotationType(s.element) };
    }
  }
  return structure;
}

function mapParamType(param: RillParam): string {
  if (param.type === undefined) {
    return 'any';
  }
  return formatStructure(stripAnnotationType(param.type));
}

function serializeParam(param: RillParam): string {
  // Use-expression closure annotations only support `name: type` — no defaults.
  return `${param.name}: ${mapParamType(param)}`;
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
      const params = child.params;
      const returnSuffix = ` :${formatStructure(stripAnnotationType(child.returnType.structure))}`;
      if (params === undefined || params.length === 0) {
        entries.push(
          `${childIndent}${key}: use<ext:${childPath}>:||${returnSuffix}`
        );
      } else {
        const paramStr = params.map(serializeParam).join(', ');
        entries.push(
          `${childIndent}${key}: use<ext:${childPath}>:|${paramStr}|${returnSuffix}`
        );
      }
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
