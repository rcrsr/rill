/**
 * Input validation helpers for rill agent run requests.
 *
 * Extracted from routes.ts so that non-HTTP transports (e.g. stdio)
 * can reuse the same parameter validation and default-injection logic.
 */

import type { RillShape } from '@rcrsr/rill';
import {
  type InputSchema,
  rillShapeToInputSchema,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// INPUT VALIDATION TYPES
// ============================================================

/**
 * A single field-level issue found by validateInputParams().
 */
export interface InputValidationIssue {
  readonly param: string;
  readonly message: string;
}

// ============================================================
// INPUT VALIDATION HELPERS
// ============================================================

/**
 * Maps a JavaScript runtime value to its Rill type name.
 * Returns the same set of names used in InputParamDescriptor.type,
 * except booleans map to "boolean" (the JS name) for error messages.
 */
function jsTypeLabel(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object' && value !== null) return 'dict';
  return typeof value;
}

/**
 * Returns true when the provided value satisfies the Rill type declared in
 * the schema descriptor.
 */
function matchesRillType(
  value: unknown,
  rillType: 'string' | 'number' | 'bool' | 'list' | 'dict'
): boolean {
  switch (rillType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'bool':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'dict':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
  }
}

/**
 * Converts a Rill type name to the label used in error messages.
 * bool → "boolean"; all others are unchanged.
 */
function rillTypeLabel(
  rillType: 'string' | 'number' | 'bool' | 'list' | 'dict'
): string {
  return rillType === 'bool' ? 'boolean' : rillType;
}

/**
 * Validates params against an InputSchema.
 *
 * - Returns [] when all required params are present and all types match.
 * - Returns ALL failures in a single call — does NOT short-circuit.
 * - Checks required params first, then type mismatches (both can appear).
 * - Issues appear in manifest declaration order (key order of inputSchema).
 * - Missing optional params produce NO issue.
 * - Extra params not in inputSchema produce NO issue (permissive mode).
 * - undefined params is treated as {} — all required params missing.
 * - null for a required param fails the required check.
 */
export function validateInputParams(
  params: Record<string, unknown> | undefined,
  inputSchema: InputSchema
): InputValidationIssue[] {
  const resolved: Record<string, unknown> = params ?? {};
  const issues: InputValidationIssue[] = [];

  for (const [param, descriptor] of Object.entries(inputSchema)) {
    const provided = Object.prototype.hasOwnProperty.call(resolved, param);
    const value = resolved[param];

    // Required check: param absent, or present with null value
    if (descriptor.required === true) {
      if (!provided || value === null) {
        issues.push({ param, message: 'required' });
        continue; // type check is meaningless without a value
      }
    }

    // Type check: only when param is actually present and not null
    if (provided && value !== null && value !== undefined) {
      if (!matchesRillType(value, descriptor.type)) {
        const expected = rillTypeLabel(descriptor.type);
        const got = jsTypeLabel(value);
        issues.push({ param, message: `expected ${expected}, got ${got}` });
      }
    }
  }

  return issues;
}

/**
 * Returns a new params object with defaults from inputSchema injected for
 * absent keys. Never mutates the original params object.
 *
 * - Caller-provided values always take precedence.
 * - Params not in inputSchema pass through unchanged.
 * - null is a valid default and will be injected.
 */
export function injectDefaults(
  params: Record<string, unknown>,
  inputSchema: InputSchema
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };

  for (const [param, descriptor] of Object.entries(inputSchema)) {
    if (
      descriptor.default !== undefined &&
      !Object.prototype.hasOwnProperty.call(result, param)
    ) {
      result[param] = descriptor.default;
    }
  }

  return result;
}

/**
 * Validates params against a RillShape by first converting it to an InputSchema.
 * Delegates to validateInputParams() after serialization.
 */
export function validateInputParamsFromShape(
  params: Record<string, unknown> | undefined,
  shape: RillShape
): InputValidationIssue[] {
  const inputSchema = rillShapeToInputSchema(shape);
  return validateInputParams(params, inputSchema);
}
