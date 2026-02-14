/**
 * JSON Schema to rill type mapping utilities.
 *
 * Converts MCP tool JSON Schema definitions to rill HostFunctionParam arrays.
 */

import type { HostFunctionParam } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// JSON SCHEMA TYPES
// ============================================================

/**
 * JSON Schema property definition (subset used by MCP).
 */
export interface JsonSchemaProperty {
  readonly type?:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly unknown[] | undefined;
  readonly oneOf?: readonly unknown[] | undefined;
  readonly anyOf?: readonly unknown[] | undefined;
}

/**
 * JSON Schema object definition.
 */
export interface JsonSchema {
  readonly type?: 'object' | undefined;
  readonly properties?: Record<string, JsonSchemaProperty> | undefined;
  readonly required?: readonly string[] | undefined;
}

// ============================================================
// TYPE MAPPING
// ============================================================

/**
 * Maps JSON Schema type to rill type.
 *
 * Mapping rules:
 * - `string` → `string`
 * - `integer` → `number` (rill has no int/float distinction)
 * - `number` → `number`
 * - `boolean` → `bool`
 * - `object` → `dict`
 * - `array` → `list`
 * - enum/oneOf/anyOf → `string` (fallback; host validates)
 * - missing/unknown → `dict` (accept any value)
 *
 * @param property - JSON Schema property definition
 * @returns Rill type string
 */
export function mapJsonSchemaTypeToRillType(
  property: JsonSchemaProperty
): HostFunctionParam['type'] {
  // Handle enum/oneOf/anyOf: fallback to string
  if (property.enum || property.oneOf || property.anyOf) {
    return 'string';
  }

  // Map JSON Schema type to rill type
  switch (property.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    case 'object':
      return 'dict';
    case 'array':
      return 'list';
    default:
      // Missing or unknown type: accept any value as dict
      return 'dict';
  }
}

/**
 * Returns type-appropriate default value for optional parameters.
 *
 * Default values by rill type:
 * - `string` → `""` (empty string)
 * - `number` → `0`
 * - `bool` → `false`
 * - `list` → `[]` (empty array)
 * - `dict` → `{}` (empty object)
 * - `vector` → `[]` (empty array)
 * - `any` → `{}` (empty object)
 *
 * @param type - Rill type
 * @returns Default value for the type
 */
export function getDefaultValueForType(
  type: HostFunctionParam['type']
): RillValue {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'bool':
      return false;
    case 'list':
    case 'vector':
      return [];
    case 'dict':
    case 'any':
      return {};
  }
}

/**
 * Sanitizes parameter name to valid rill identifier.
 *
 * Rules:
 * - Replace `-` with `_`
 * - Replace `.` with `_`
 * - Convert camelCase to snake_case
 * - Convert PascalCase to snake_case
 * - Normalize consecutive underscores to single underscore
 * - Strip leading and trailing underscores
 *
 * @param name - Original parameter name
 * @returns Sanitized rill identifier
 */
export function sanitizeParameterName(name: string): string {
  // Replace hyphens and dots with underscores
  let sanitized = name.replace(/[-.]/g, '_');

  // Convert camelCase and PascalCase to snake_case
  sanitized = sanitized
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

  // Normalize underscores: collapse consecutive and strip leading/trailing
  sanitized = sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

  return sanitized;
}

// ============================================================
// PARAMETER GENERATION
// ============================================================

/**
 * Generates rill HostFunctionParam array from JSON Schema.
 *
 * Rules:
 * - Each `properties` entry → one HostFunctionParam
 * - Property key → `name` (sanitized)
 * - `properties[key].type` → `type` (mapped via mapJsonSchemaTypeToRillType)
 * - `properties[key].description` → `description` (pass through)
 * - Key in `required[]` → no `defaultValue` (required parameter)
 * - Key NOT in `required[]` → `defaultValue` set to type-appropriate default
 * - Order: `Object.entries(properties)` iteration order
 * - Missing `properties` → empty array
 * - Missing `required` → all parameters optional
 *
 * @param schema - JSON Schema object definition
 * @returns Array of HostFunctionParam
 */
export function generateParametersFromSchema(
  schema: JsonSchema
): HostFunctionParam[] {
  // Missing properties: return empty array
  if (!schema.properties) {
    return [];
  }

  const required = new Set(schema.required ?? []);
  const params: HostFunctionParam[] = [];

  // Iterate properties in Object.entries order
  for (const [key, property] of Object.entries(schema.properties)) {
    const rillType = mapJsonSchemaTypeToRillType(property);
    const sanitizedName = sanitizeParameterName(key);
    const isRequired = required.has(key);

    // Build parameter object with conditional properties
    const param: HostFunctionParam = {
      name: sanitizedName,
      type: rillType,
      ...(property.description !== undefined && {
        description: property.description,
      }),
      ...(!isRequired && { defaultValue: getDefaultValueForType(rillType) }),
    };

    params.push(param);
  }

  return params;
}

// ============================================================
// RESOURCE CONTENT PARSING
// ============================================================

/**
 * MCP resource content block (single item in contents array).
 */
export interface ResourceContentBlock {
  readonly uri: string;
  readonly text?: string | undefined;
  readonly blob?: string | undefined; // base64
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result.
 */
export interface ResourceReadResult {
  readonly contents: ResourceContentBlock[];
}

/**
 * Parses single resource content block to rill value.
 *
 * Rules:
 * - Text content: return as string; if valid JSON, parse to dict
 * - Blob content: return dict `{ type: "image", data: base64, mime: mimeType }`
 * - Empty content (zero bytes): return empty string `""`
 *
 * @param block - Single MCP resource content block
 * @returns Rill value (string or dict)
 */
function parseResourceContentBlock(block: ResourceContentBlock): RillValue {
  // Text content: try parsing as JSON, otherwise return as string
  if (block.text !== undefined) {
    const text = block.text;

    // BC-6: Empty text content returns empty string
    if (text.length === 0) {
      return '';
    }

    // Try parsing as JSON
    try {
      const parsed = JSON.parse(text);
      // JSON successfully parsed: return as dict if object, otherwise as-is
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as { [key: string]: RillValue };
      }
      return parsed;
    } catch {
      // Not JSON: return as plain string
      return text;
    }
  }

  // Blob content: return structured dict
  if (block.blob !== undefined) {
    return {
      type: 'image',
      data: block.blob,
      mime: block.mimeType ?? 'application/octet-stream',
    };
  }

  // BC-6: No text or blob content (zero bytes): return empty string
  return '';
}

/**
 * Parses MCP resource read result content to rill value.
 *
 * Rules (Task 3.2):
 * - Empty content array → return empty string `""`
 * - Single text block with JSON → parse to dict
 * - Single text block (non-JSON) → return string
 * - Single blob block → dict with `{ type: "image", data: base64, mime: mimeType }`
 * - Multiple text blocks → concatenate with newlines
 * - Multiple blocks with blobs → return first content block only
 *
 * @param result - MCP resource read result with contents array
 * @returns Rill value (string, dict, or structured content)
 */
export function parseResourceContent(result: ResourceReadResult): RillValue {
  const { contents } = result;

  // BC-6: Empty content: return empty string
  if (contents.length === 0) {
    return '';
  }

  // Single content block: apply type-specific parsing
  if (contents.length === 1) {
    return parseResourceContentBlock(contents[0]!);
  }

  // Multiple content blocks: check if all are text
  const allText = contents.every((block) => block.text !== undefined);

  if (allText) {
    // Concatenate text blocks with newlines
    return contents.map((block) => block.text ?? '').join('\n');
  }

  // Mixed or multiple blob blocks: return first content block
  return parseResourceContentBlock(contents[0]!);
}
