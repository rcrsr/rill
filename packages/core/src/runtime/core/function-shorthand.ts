/**
 * Host Function Shorthand
 *
 * Accepts `{ signature, fn }` alongside the explicit `{ params, returnType, fn }`
 * host function form and normalizes both to a RillFunction.
 *
 * Import constraints:
 * - Types come from ./callable.js as `import type`, which erases at compile
 *   time. callable.ts imports this file, so a value import would form a cycle.
 * - Signature parsing goes through the signature-parser.ts bridge.
 */

import { RuntimeError } from '../../types.js';
import { ERROR_IDS } from '../../error-registry.js';
// oxlint-disable-next-line import/no-cycle -- signature-parser reaches callable.ts through a type-only import that erases at compile time
import { parseSignatureRegistration } from '../../signature-parser.js';
import { setDictField } from './types/dict-keys.js';
import type { RillValue } from './types/structures.js';
// oxlint-disable-next-line import/no-cycle -- values.ts and callable.ts already import each other
import { anyTypeValue, structureToTypeValue } from './values.js';
// oxlint-disable-next-line import/no-cycle -- type-only import that erases at compile time
import type { CallableFn, RillFunction } from './callable.js';

/**
 * Host function declared with a signature string instead of params and
 * returnType. Supplying params or returnType alongside signature is rejected.
 */
export interface RillFunctionShorthand {
  readonly signature: string;
  readonly fn: CallableFn;
  readonly annotations?: Record<string, RillValue> | undefined;
  readonly description?: string | undefined;
  readonly params?: never;
  readonly returnType?: never;
}

/** A host function in either the explicit or the signature shorthand form. */
export type RillFunctionDefinition = RillFunction | RillFunctionShorthand;

function isShorthand(
  def: RillFunctionDefinition
): def is RillFunctionShorthand {
  return (
    typeof def === 'object' &&
    def !== null &&
    'signature' in def &&
    def.signature !== undefined
  );
}

function registrationFault(message: string): RuntimeError {
  // oxlint-disable-next-line rill/no-new-runtime-error -- host setup validation runs before any script, so no halt context exists
  return new RuntimeError(ERROR_IDS.RILL_R091, message);
}

function signatureFault(name: string, detail: string): RuntimeError {
  return registrationFault(
    `Invalid signature for function '${name}': ${detail}`
  );
}

/**
 * Normalize a host function definition to the explicit RillFunction form.
 *
 * Explicit-form definitions are returned unchanged (same object). The
 * shorthand form is parsed with parseSignatureRegistration.
 *
 * @throws {RuntimeError} RILL-R091 when the shorthand is malformed, mixes
 * forms, has a non-object annotations field, or declares an annotation key
 * from more than one source
 *
 * @internal
 */
export function normalizeFunctionDefinition(
  name: string,
  def: RillFunctionDefinition
): RillFunction {
  if (!isShorthand(def)) {
    return def;
  }
  if (def.params !== undefined || def.returnType !== undefined) {
    throw signatureFault(
      name,
      'supply either signature or params and returnType, not both'
    );
  }
  if (typeof def.signature !== 'string') {
    throw signatureFault(name, 'signature must be a string');
  }
  if (def.description !== undefined && typeof def.description !== 'string') {
    throw signatureFault(name, 'description must be a string');
  }
  if (
    def.annotations !== undefined &&
    (typeof def.annotations !== 'object' ||
      def.annotations === null ||
      Array.isArray(def.annotations))
  ) {
    throw signatureFault(name, 'annotations must be an object');
  }

  let parsed;
  try {
    parsed = parseSignatureRegistration(def.signature, name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const wrapped = registrationFault(message);
    // Keep the original parser error reachable through the standard cause chain
    wrapped.cause = err;
    throw wrapped;
  }

  const annotations: Record<string, RillValue> = {};
  const sources: Array<Record<string, RillValue>> = [
    def.annotations ?? {},
    parsed.annotations,
    def.description !== undefined ? { description: def.description } : {},
  ];
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(annotations, key)) {
        throw signatureFault(
          name,
          `annotation '${key}' is declared more than once`
        );
      }
      setDictField(annotations, key, value);
    }
  }

  return {
    params: parsed.params,
    fn: def.fn,
    annotations,
    returnType:
      parsed.returnType !== undefined
        ? structureToTypeValue(parsed.returnType)
        : anyTypeValue,
  };
}
