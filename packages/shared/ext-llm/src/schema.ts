/**
 * JSON Schema builder for rill type descriptors.
 *
 * Converts rill schema definitions into JSON Schema objects suitable for
 * LLM tool definitions.
 */

import {
  type RillStructuralType,
  type CallableParam,
  RuntimeError,
} from '@rcrsr/rill';

/**
 * Represents an individual JSON Schema property descriptor.
 *
 * Covers all supported forms:
 * - Simple typed property: `{ type: "string" }`
 * - Typed with description: `{ type: "string", description: "..." }`
 * - Array with items: `{ type: "array", items: JsonSchemaProperty }`
 * - Object with properties: `{ type: "object", properties: Record<string, JsonSchemaProperty> }`
 * - Enum constraint: `{ type: "string", enum: string[] }`
 */
export interface JsonSchemaProperty {
  type?: string | undefined;
  description?: string | undefined;
  items?: JsonSchemaProperty | undefined;
  properties?: Record<string, JsonSchemaProperty> | undefined;
  required?: string[] | undefined;
  enum?: string[] | undefined;
  additionalProperties?: false | undefined;
}

/**
 * Represents a JSON Schema object (top-level tool parameter schema).
 */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

/** Map from rill type names to JSON Schema type strings. */
const RILL_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  list: 'array',
  dict: 'object',
  vector: 'object',
  shape: 'object',
};

/**
 * Convert a rill type name to the corresponding JSON Schema type string.
 * Throws RuntimeError RILL-R004 for unsupported types.
 */
export function mapRillType(rillType: string): string {
  const jsonType = RILL_TYPE_MAP[rillType];
  if (jsonType === undefined) {
    throw new RuntimeError('RILL-R004', `unsupported type: ${rillType}`);
  }
  return jsonType;
}

/**
 * Build a JsonSchemaProperty from a RillStructuralType in param position.
 *
 * - closure and tuple kinds throw RuntimeError RILL-R004 (EC-3).
 * - any kind produces an unconstrained property (no type field).
 * - primitive kind maps the type name via mapRillType.
 */
function buildPropertyFromStructuralType(
  structuralType: RillStructuralType
): JsonSchemaProperty {
  if (structuralType.kind === 'closure' || structuralType.kind === 'tuple') {
    throw new RuntimeError(
      'RILL-R004',
      `unsupported type for JSON Schema: ${structuralType.kind}`
    );
  }

  if (structuralType.kind === 'any') {
    return {};
  }

  if (structuralType.kind === 'primitive') {
    return { type: mapRillType(structuralType.name) };
  }

  if (structuralType.kind === 'list') {
    return { type: 'array' };
  }

  if (structuralType.kind === 'dict' || structuralType.kind === 'ordered') {
    return { type: 'object' };
  }

  // Exhaustive guard — should never reach here with a valid RillStructuralType
  const exhaustive: never = structuralType;
  throw new RuntimeError(
    'RILL-R004',
    `unsupported type: ${String(exhaustive)}`
  );
}

/**
 * Build a JSON Schema object from a RillStructuralType (IR-4).
 *
 * For the closure variant:
 * - Iterates type.params (array of [name, RillStructuralType]).
 * - Matches each entry to params[i] by position for metadata.
 * - annotations.description from callableParam.annotations['description'].
 * - annotations.enum from callableParam.annotations['enum'].
 * - optional = callableParam.defaultValue !== null.
 * - Non-optional params added to required[].
 * - additionalProperties: false always present.
 *
 * @throws RuntimeError RILL-R004 for closure/tuple kind in param position (EC-3)
 * @throws RuntimeError RILL-R004 for unsupported type name (EC-3)
 */
export function buildJsonSchemaFromStructuralType(
  type: RillStructuralType,
  params?: CallableParam[]
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  if (type.kind === 'closure') {
    for (let i = 0; i < type.params.length; i++) {
      const [paramName, paramType] = type.params[i]!;
      const callableParam = params?.[i];

      const property = buildPropertyFromStructuralType(paramType);

      // Map annotations.description
      const description = callableParam?.annotations['description'];
      if (typeof description === 'string') {
        property.description = description;
      }

      // Map annotations.enum (stored as RillValue — a JS array)
      const enumAnnotation = callableParam?.annotations['enum'];
      if (Array.isArray(enumAnnotation)) {
        property.enum = enumAnnotation as string[];
      }

      properties[paramName] = property;

      // Non-optional params (defaultValue === null) go into required[]
      if (callableParam === undefined || callableParam.defaultValue === null) {
        required.push(paramName);
      }
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * Build a JSON Schema object from a rill schema descriptor.
 *
 * Accepts a Record<string, unknown> dict descriptor.
 * Each value can be a simple type string (e.g., `"string"`)
 * or a full descriptor object (e.g., `{ type: "string", description: "..." }`).
 *
 * @example
 * buildJsonSchema({ name: "string", age: { type: "number", description: "Age in years" } })
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     name: { type: 'string' },
 * //     age: { type: 'number', description: 'Age in years' }
 * //   },
 * //   required: ['name', 'age']
 * // }
 *
 * @throws RuntimeError RILL-R004 for unsupported rill types (EC-1)
 * @throws RuntimeError RILL-R004 for enum on non-string type (EC-2)
 */
export function buildJsonSchema(
  rillSchema: Record<string, unknown>
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(rillSchema)) {
    if (typeof value === 'string') {
      properties[key] = buildProperty(value);
    } else if (typeof value === 'object' && value !== null) {
      properties[key] = buildProperty(value as Record<string, unknown>);
    } else {
      throw new RuntimeError('RILL-R004', `unsupported type: ${String(value)}`);
    }
    required.push(key);
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * Build a JsonSchemaProperty from a single rill property descriptor.
 *
 * Accepts two forms:
 * - Simple string: `"string"` — just a type name
 * - Descriptor object: `{ type: "string", description?: "...", enum?: [...], items?: ..., properties?: {...} }`
 *
 * Throws RuntimeError RILL-R004 for unsupported types or invalid enum usage.
 */
function buildProperty(
  descriptor: string | Record<string, unknown>
): JsonSchemaProperty {
  // Form 1: simple string — just a type name
  if (typeof descriptor === 'string') {
    const jsonType = mapRillType(descriptor);
    return { type: jsonType };
  }

  // Forms 2–5: descriptor object
  const rillType = descriptor['type'];
  if (typeof rillType !== 'string') {
    throw new RuntimeError(
      'RILL-R004',
      `unsupported type: ${String(rillType)}`
    );
  }

  const jsonType = mapRillType(rillType);
  const property: JsonSchemaProperty = { type: jsonType };

  // Optional description
  const description = descriptor['description'];
  if (typeof description === 'string') {
    property.description = description;
  }

  // EC-2: Enum constraint valid only for string type
  if ('enum' in descriptor) {
    if (rillType !== 'string') {
      throw new RuntimeError('RILL-R004', 'enum is only valid for string type');
    }
    const enumValues = descriptor['enum'];
    if (Array.isArray(enumValues)) {
      property.enum = enumValues as string[];
    }
  }

  // Form 4: list with items sub-schema
  if (rillType === 'list' && 'items' in descriptor) {
    const items = descriptor['items'];
    if (typeof items === 'string') {
      property.items = buildProperty(items);
    } else if (typeof items === 'object' && items !== null) {
      property.items = buildProperty(items as Record<string, unknown>);
    }
  }

  // Form 3: nested dict with properties sub-schema
  if (rillType === 'dict' && 'properties' in descriptor) {
    const nestedProps = descriptor['properties'];
    if (typeof nestedProps === 'object' && nestedProps !== null) {
      const subSchema = buildJsonSchema(nestedProps as Record<string, unknown>);
      property.properties = subSchema.properties;
      property.required = subSchema.required;
      property.additionalProperties = false;
    }
  }

  return property;
}
