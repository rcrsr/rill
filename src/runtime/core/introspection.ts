/**
 * Runtime Introspection API
 *
 * Functions for inspecting runtime context at runtime.
 * These enable host applications to discover available functions and their signatures.
 */

import type { RuntimeContext } from './types.js';
import type { RillValue } from './values.js';
import { isApplicationCallable, isScriptCallable } from './callable.js';
import { LANGUAGE_REFERENCE } from './introspection-data.js';

/**
 * Metadata describing a function's signature and documentation.
 * Returned by introspection APIs like getFunctions().
 */
export interface FunctionMetadata {
  /** Function name (including namespace if applicable, e.g., "math::add") */
  readonly name: string;
  /** Human-readable description of what the function does */
  readonly description: string;
  /** Parameter metadata in declaration order */
  readonly params: readonly ParamMetadata[];
}

/**
 * Metadata describing a single function parameter.
 */
export interface ParamMetadata {
  /** Parameter name */
  readonly name: string;
  /** Type constraint (e.g., "string", "number", "list") */
  readonly type: string;
  /** Human-readable description of the parameter's purpose */
  readonly description: string;
  /** Default value if parameter is optional (undefined if required) */
  readonly defaultValue: RillValue | undefined;
}

/**
 * Enumerate all callable functions registered in runtime context.
 *
 * Returns flat list combining host functions, built-ins, and script closures.
 * Namespaced functions preserve `::` separator in name field.
 * Malformed entries silently skipped (valid entries returned).
 * Script closures: reads `^(doc: "...")` annotation for description.
 * Script closures: excludes nested closures in dicts/lists.
 *
 * Order: host functions, then built-ins, then script closures.
 *
 * @param ctx Runtime context
 * @returns Array of function metadata
 */
export function getFunctions(ctx: RuntimeContext): FunctionMetadata[] {
  const result: FunctionMetadata[] = [];

  // Defensive: handle invalid context (EC-1)
  if (!ctx || !ctx.functions || !ctx.variables) {
    return result;
  }

  // Separate host functions and built-ins
  const hostFunctions: FunctionMetadata[] = [];
  const builtinFunctions: FunctionMetadata[] = [];

  // Enumerate functions in ctx.functions
  for (const [name, fn] of ctx.functions.entries()) {
    try {
      // Check if this is an ApplicationCallable with metadata (host function)
      const callable = fn as RillValue;
      if (isApplicationCallable(callable)) {
        if (callable.params) {
          const params: ParamMetadata[] = callable.params.map((p) => ({
            name: p.name,
            type: p.typeName ?? 'any',
            description: p.description ?? '',
            defaultValue: p.defaultValue ?? undefined,
          }));

          hostFunctions.push({
            name,
            description: callable.description ?? '',
            params,
          });
        } else {
          // ApplicationCallable without params (untyped)
          builtinFunctions.push({
            name,
            description: callable.description ?? '',
            params: [],
          });
        }
      } else {
        // Built-in function (no parameter metadata)
        builtinFunctions.push({
          name,
          description: '',
          params: [],
        });
      }
    } catch {
      // EC-2: Malformed function entry skipped
      continue;
    }
  }

  // Enumerate script closures from variables (top-level only, no nested)
  for (const [name, value] of ctx.variables.entries()) {
    try {
      if (isScriptCallable(value)) {
        // Extract description from ^(doc: "...") annotation
        let description = '';
        if (value.annotations && 'doc' in value.annotations) {
          const docValue = value.annotations['doc'];
          if (typeof docValue === 'string') {
            description = docValue;
          }
        }

        // Convert params to ParamMetadata
        const params: ParamMetadata[] = value.params.map((p) => ({
          name: p.name,
          type: p.typeName ?? 'any',
          description: p.description ?? '',
          defaultValue: p.defaultValue ?? undefined,
        }));

        result.push({
          name,
          description,
          params,
        });
      }
    } catch {
      // EC-2: Malformed entry skipped
      continue;
    }
  }

  // Combine in specified order: host, built-ins, script closures
  return [...hostFunctions, ...builtinFunctions, ...result];
}

/**
 * Return complete rill language reference for LLM prompt context.
 *
 * Returns bundled content from `docs/99_llm-reference.txt`.
 * Content includes syntax, operators, control flow, type system.
 * Always succeeds at runtime (content embedded at build time).
 *
 * @returns Language reference text
 */
export function getLanguageReference(): string {
  return LANGUAGE_REFERENCE;
}
