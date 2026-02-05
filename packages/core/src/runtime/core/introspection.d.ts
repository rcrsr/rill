/**
 * Runtime Introspection API
 *
 * Functions for inspecting runtime context at runtime.
 * These enable host applications to discover available functions and their signatures.
 */
import type { RuntimeContext } from './types.js';
import type { RillValue } from './values.js';
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
    /** Return type (default: 'any' for unspecified) */
    readonly returnType: string;
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
export declare function getFunctions(ctx: RuntimeContext): FunctionMetadata[];
/**
 * Documentation coverage metrics for runtime context.
 * Used to assess quality of function documentation.
 */
export interface DocumentationCoverageResult {
    /** Total function count */
    readonly total: number;
    /** Functions with complete documentation */
    readonly documented: number;
    /** Percentage (0-100), rounded to 2 decimal places */
    readonly percentage: number;
}
/**
 * Analyze documentation coverage of functions in runtime context.
 *
 * Counts function as documented when:
 * - Has non-empty description string (after trim)
 * - All parameters have non-empty description string (after trim)
 *
 * Script closures with `^(doc: "...")` annotation count as having description.
 * Whitespace-only descriptions count as undocumented.
 * Empty context returns `{ total: 0, documented: 0, percentage: 100 }`.
 *
 * @param ctx Runtime context
 * @returns Documentation coverage metrics
 */
export declare function getDocumentationCoverage(ctx: RuntimeContext): DocumentationCoverageResult;
/**
 * Return complete rill language reference for LLM prompt context.
 *
 * Returns bundled content from `docs/99_llm-reference.txt`.
 * Content includes syntax, operators, control flow, type system.
 * Always succeeds at runtime (content embedded at build time).
 *
 * @returns Language reference text
 */
export declare function getLanguageReference(): string;
//# sourceMappingURL=introspection.d.ts.map