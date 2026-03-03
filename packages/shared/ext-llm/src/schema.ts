/**
 * JSON Schema builder for rill type descriptors.
 *
 * Converts rill schema definitions into JSON Schema objects suitable for
 * LLM tool definitions.
 */

import {
  type RillShape,
  type ShapeFieldSpec,
  isShape,
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
 * Build a JsonSchemaProperty from a ShapeFieldSpec (IR-6, EC-8).
 *
 * - closure and tuple types throw RuntimeError RILL-R004 (EC-8).
 * - any type produces an unconstrained property (no type field).
 * - shape type recursively builds nested object schema.
 * - annotations.description maps to JSON Schema description.
 * - annotations.enum maps to JSON Schema enum.
 */
function buildPropertyFromFieldSpec(
  fieldSpec: ShapeFieldSpec
): JsonSchemaProperty {
  const { typeName, nestedShape, annotations } = fieldSpec;

  // EC-8: closure and tuple are not representable in JSON Schema
  if (typeName === 'closure' || typeName === 'tuple') {
    throw new RuntimeError(
      'RILL-R004',
      `unsupported type for JSON Schema: ${typeName}`
    );
  }

  const property: JsonSchemaProperty = {};

  // any: no type constraint — JSON Schema allows {} for unconstrained
  if (typeName !== 'any') {
    property.type = mapRillType(typeName);
  }

  // shape: recursively build nested object schema
  if (typeName === 'shape' && nestedShape !== undefined) {
    const nested = buildJsonSchemaFromShape(nestedShape);
    property.properties = nested.properties;
    property.required = nested.required;
    property.additionalProperties = false;
  }

  // Map annotations.description
  const description = annotations['description'];
  if (typeof description === 'string') {
    property.description = description;
  }

  // Map annotations.enum (stored as RillValue — a JS array)
  const enumAnnotation = annotations['enum'];
  if (Array.isArray(enumAnnotation)) {
    property.enum = enumAnnotation as string[];
  }

  return property;
}

/**
 * Build a JSON Schema object from a RillShape (IR-6).
 *
 * - Iterates shape.fields entries.
 * - Maps each ShapeFieldSpec to a JsonSchemaProperty.
 * - Adds field name to required only when optional === false.
 * - Sets additionalProperties: false on the result.
 *
 * @throws RuntimeError RILL-R004 for closure or tuple field types (EC-8)
 */
export function buildJsonSchemaFromShape(shape: RillShape): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [fieldName, fieldSpec] of Object.entries(shape.fields)) {
    properties[fieldName] = buildPropertyFromFieldSpec(fieldSpec);
    if (!fieldSpec.optional) {
      required.push(fieldName);
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * Build a JSON Schema object from a rill schema descriptor.
 *
 * Accepts two input forms:
 * - RillShape (has `__rill_shape: true`): delegates to buildJsonSchemaFromShape.
 * - Record<string, unknown>: legacy dict descriptor path.
 *
 * @param rillSchema - A RillShape or a record mapping parameter names to rill
 *   type descriptors. Each value can be a simple type string (e.g., `"string"`)
 *   or a full descriptor object (e.g., `{ type: "string", description: "..." }`).
 * @returns A JsonSchemaObject with properties, required, and additionalProperties.
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
 * @throws RuntimeError RILL-R004 for closure/tuple field in RillShape (EC-8)
 */
export function buildJsonSchema(
  rillSchema: Record<string, unknown>
): JsonSchemaObject {
  // IR-6: detect RillShape input and delegate
  if (isShape(rillSchema)) {
    return buildJsonSchemaFromShape(rillSchema);
  }

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
