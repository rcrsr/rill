/**
 * Runtime Introspection API
 *
 * Functions for inspecting runtime context at runtime.
 * These enable host applications to discover available functions and their signatures.
 */

import type { RuntimeContext } from './types/runtime.js';
import type { RillValue } from './types/structures.js';
import { formatStructure } from './types/operations.js';
import { formatValue } from './types/registrations.js';
import {
  isApplicationCallable,
  isRuntimeCallable,
  isScriptCallable,
} from './callable.js';
import type { RillParam } from './callable.js';
import { LANGUAGE_REFERENCE } from '../../generated/introspection-data.js';
import { BUILTIN_FUNCTIONS } from '../ext/builtins.js';
import type {
  AnnotationArg,
  CaptureNode,
  ClosureNode,
  ClosureParamNode,
  LiteralNode,
  NamedArgNode,
  PipeChainNode,
  PostfixExprNode,
  ScriptNode,
  StatementNode,
  StringLiteralNode,
} from '../../types.js';
import type { TypeRef } from '../../value-types.js';

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
            type: p.type !== undefined ? formatStructure(p.type) : 'any',
            description:
              typeof p.annotations['description'] === 'string'
                ? p.annotations['description']
                : '',
            defaultValue: p.defaultValue ?? undefined,
          }));

          hostFunctions.push({
            name,
            description:
              (callable.annotations?.['description'] as string) ?? '',
            params,
            returnType: formatStructure(callable.returnType.structure),
          });
        } else {
          // ApplicationCallable without params (untyped)
          builtinFunctions.push({
            name,
            description:
              (callable.annotations?.['description'] as string) ?? '',
            params: [],
            returnType: 'any',
          });
        }
      } else {
        // Built-in function (no parameter metadata)
        builtinFunctions.push({
          name,
          description: '',
          params: [],
          returnType: 'any',
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

        // Convert params to ParamMetadata using RillParam.type (IC-5)
        const params: ParamMetadata[] = value.params.map((p) => ({
          name: p.name,
          type: p.type !== undefined ? formatStructure(p.type) : 'any',
          description:
            typeof p.annotations['description'] === 'string'
              ? p.annotations['description']
              : '',
          defaultValue: p.defaultValue ?? undefined,
        }));

        result.push({
          name,
          description,
          params,
          returnType: 'any',
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
 * Serialize a single RillParam into rill closure parameter syntax.
 *
 * Format: `^(description: "...") name: type = default`
 * - Annotation prefix included only when annotations.description is present.
 * - Type defaults to `any` when param.type is undefined.
 * - Default value appended as `= value` when param.defaultValue is defined.
 */
function serializeParam(p: RillParam): string {
  const parts: string[] = [];

  // Parameter-level description annotation
  const desc = p.annotations['description'];
  if (typeof desc === 'string' && desc.length > 0) {
    parts.push(`^(description: "${desc}") `);
  }

  // Name and type
  const typeName = p.type !== undefined ? formatStructure(p.type) : 'any';
  parts.push(`${p.name}: ${typeName}`);

  // Default value
  if (p.defaultValue !== undefined) {
    parts.push(` = ${formatValue(p.defaultValue)}`);
  }

  return parts.join('');
}

/**
 * Serialize a typed ApplicationCallable entry into a rill closure type signature string.
 *
 * Format: `^(description: "...") |param: type|:returnType`
 * - Closure-level description annotation prefix included only when description is present.
 * - Return type suffix included only when returnType is not `any`.
 * - Empty param list renders as `||`.
 */
function serializeClosureSignature(
  params: readonly RillParam[],
  returnType: string,
  description: string | undefined
): string {
  const parts: string[] = [];

  // Closure-level description annotation
  if (typeof description === 'string' && description.length > 0) {
    parts.push(`^(description: "${description}") `);
  }

  // Parameter list
  const paramStr = params.map(serializeParam).join(', ');
  parts.push(`|${paramStr}|`);

  // Optional return type
  if (returnType !== 'any') {
    parts.push(`:${returnType}`);
  }

  return parts.join('');
}

/**
 * Generate a rill manifest file from the registered host functions in ctx.
 *
 * Returns a string containing a valid rill file: a dict literal of
 * string-keyed closure type signatures followed by `-> export`.
 *
 * Only `ApplicationCallable` entries with `params !== undefined` are included.
 * `RuntimeCallable` entries are excluded. Built-in functions (by name in `BUILTIN_FUNCTIONS`) are excluded.
 * `ApplicationCallable` entries with `params: undefined` are skipped silently.
 *
 * Empty function map produces `[:]` followed by `-> export`.
 *
 * @param ctx Runtime context
 * @returns Rill manifest file content as a string
 */
export function generateManifest(ctx: RuntimeContext): string {
  const entries: string[] = [];

  for (const [name, fn] of ctx.functions.entries()) {
    const callable = fn as RillValue;

    // Exclude RuntimeCallable entries and built-in functions by name
    if (isRuntimeCallable(callable) || name in BUILTIN_FUNCTIONS) {
      continue;
    }

    // Include only ApplicationCallable entries with params defined (EC-7)
    if (!isApplicationCallable(callable) || callable.params === undefined) {
      continue;
    }

    const signature = serializeClosureSignature(
      callable.params,
      formatStructure(callable.returnType.structure),
      (callable.annotations?.['description'] as string) ?? undefined
    );

    entries.push(`  "${name}": ${signature}`);
  }

  if (entries.length === 0) {
    return '[:]';
  }

  const dictBody = entries.join(',\n');
  return `[\n${dictBody}\n]`;
}

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
export function getDocumentationCoverage(
  ctx: RuntimeContext
): DocumentationCoverageResult {
  // Get all functions using existing getFunctions helper
  const functions = getFunctions(ctx);

  // Handle empty context (AC-11)
  if (functions.length === 0) {
    return { total: 0, documented: 0, percentage: 100 };
  }

  // Count documented functions
  let documented = 0;
  for (const fn of functions) {
    // Function is documented when:
    // 1. Has non-empty description (after trim)
    // 2. All params have non-empty description (after trim)
    const hasDescription = fn.description.trim().length > 0;
    const allParamsDocumented = fn.params.every(
      (p) => p.description.trim().length > 0
    );

    // AC-13: Function with 0 params and description counts as documented
    if (hasDescription && allParamsDocumented) {
      documented++;
    }
  }

  // Calculate percentage with spec formula
  const percentage = Math.round((documented / functions.length) * 10000) / 100;

  return {
    total: functions.length,
    documented,
    percentage,
  };
}

/**
 * Return complete rill language reference for LLM prompt context.
 *
 * Returns bundled content from `docs/ref-llm.txt`.
 * Content includes syntax, operators, control flow, type system.
 * Always succeeds at runtime (content embedded at build time).
 *
 * @returns Language reference text
 */
export function getLanguageReference(): string {
  return LANGUAGE_REFERENCE;
}

// ============================================================
// STATIC HANDLER INTROSPECTION
// ============================================================

/**
 * Static metadata for a single closure parameter, extracted from the AST.
 * No script execution required.
 */
export interface HandlerParamStatic {
  /** Parameter name */
  readonly name: string;
  /** Type annotation string, or 'any' when absent */
  readonly type: string;
  /** True when no default value expression exists */
  readonly required: boolean;
  /** Description from parameter annotation, when present */
  readonly description?: string;
  /** Literal default value (undefined for non-literal or complex expressions) */
  readonly defaultValue?: unknown;
}

/**
 * Static metadata for a handler closure, extracted from the AST.
 * No script execution required.
 */
export interface HandlerMetadataStatic {
  /** Description from annotation on the closure statement */
  readonly description?: string;
  /** Parameter metadata in declaration order */
  readonly params: ReadonlyArray<HandlerParamStatic>;
}

/** Convert a TypeRef to a human-readable type string. */
function typeRefToString(ref: TypeRef | null): string {
  if (ref === null) return 'any';
  switch (ref.kind) {
    case 'static':
      return ref.typeName;
    case 'dynamic':
      return 'any';
    case 'union':
      return ref.members.map(typeRefToString).join(' | ');
  }
}

/** Extract a primitive value from a literal AST node. Returns undefined for complex literals. */
function extractLiteralValue(node: LiteralNode): unknown {
  switch (node.type) {
    case 'NumberLiteral':
      return node.value;
    case 'BoolLiteral':
      return node.value;
    case 'StringLiteral': {
      const strNode = node as StringLiteralNode;
      // Skip strings with interpolations
      if (strNode.parts.some((p) => typeof p !== 'string')) return undefined;
      return strNode.parts.join('');
    }
    default:
      return undefined;
  }
}

/**
 * Extract a description string from an annotation array.
 * Prefers a NamedArgNode with name 'description', and falls back to 'doc',
 * when the value is a plain string literal.
 */
function extractDescription(
  annotations: AnnotationArg[] | undefined
): string | undefined {
  if (!annotations) return undefined;
  let docFallback: string | undefined;
  for (const arg of annotations) {
    if (arg.type !== 'NamedArg') continue;
    const named = arg as NamedArgNode;
    if (named.name !== 'description' && named.name !== 'doc') continue;

    // Navigate: value → PipeChainNode.head → PostfixExprNode.primary → StringLiteralNode
    const chain = named.value as PipeChainNode;
    if (chain.type !== 'PipeChain') continue;

    const head = chain.head as PostfixExprNode;
    if (head.type !== 'PostfixExpr') continue;

    const primary = head.primary;
    if (primary.type !== 'StringLiteral') continue;

    const strNode = primary as StringLiteralNode;
    if (strNode.parts.some((p) => typeof p !== 'string')) continue;

    const value = strNode.parts.join('');
    if (named.name === 'description') return value;
    docFallback = value;
  }
  return docFallback;
}

/** Find the ClosureNode within a PipeChainNode (head or pipes). */
function findClosureInChain(chain: PipeChainNode): ClosureNode | null {
  // Check head: PostfixExprNode with primary being a ClosureNode
  if (chain.head.type === 'PostfixExpr') {
    const postfix = chain.head as PostfixExprNode;
    if (postfix.primary.type === 'Closure') {
      return postfix.primary as unknown as ClosureNode;
    }
  }

  // Check pipes for a ClosureNode
  for (const pipe of chain.pipes) {
    if (pipe.type === 'Closure') {
      return pipe as unknown as ClosureNode;
    }
  }

  return null;
}

/**
 * Extract static handler metadata from a parsed AST without executing the script.
 *
 * Walks statements to find a pipe chain with a capture to `handlerName`.
 * Captures may appear as CaptureNode entries in either the pipes array or the
 * terminator.
 * Extracts the ClosureNode and reads parameter types, defaults, and descriptions
 * from AST nodes directly.
 *
 * @param ast - Parsed script AST
 * @param handlerName - Capture variable name (e.g., 'run' for `=> $run`)
 * @returns Handler metadata, or null when no matching handler found
 */
export function introspectHandlerFromAST(
  ast: ScriptNode,
  handlerName: string
): HandlerMetadataStatic | null {
  for (const stmt of ast.statements) {
    if (stmt.type === 'RecoveryError') continue;

    // Unwrap AnnotatedStatementNode to get the inner statement and annotations
    let innerStatement: StatementNode;
    let closureAnnotations: AnnotationArg[] | undefined;

    if (stmt.type === 'AnnotatedStatement') {
      closureAnnotations = stmt.annotations;
      innerStatement = stmt.statement;
    } else {
      innerStatement = stmt;
    }

    const chain = innerStatement.expression;

    // Check for matching capture in pipes or terminator
    const hasMatchingCapture =
      chain.pipes.some(
        (p) => p.type === 'Capture' && (p as CaptureNode).name === handlerName
      ) ||
      (chain.terminator?.type === 'Capture' &&
        (chain.terminator as CaptureNode).name === handlerName);

    if (!hasMatchingCapture) {
      continue;
    }

    // Find the closure in this chain
    const closure = findClosureInChain(chain);
    if (!closure) continue;

    // Extract parameter metadata
    const params: HandlerParamStatic[] = closure.params.map(
      (param: ClosureParamNode) => {
        const desc = extractDescription(param.annotations);
        const val =
          param.defaultValue !== null
            ? extractLiteralValue(param.defaultValue)
            : undefined;

        return {
          name: param.name,
          type: typeRefToString(param.typeRef),
          required: param.defaultValue === null,
          ...(desc !== undefined && { description: desc }),
          ...(val !== undefined && { defaultValue: val }),
        };
      }
    );

    // Extract closure-level description from AnnotatedStatementNode
    const description = extractDescription(closureAnnotations);

    return description !== undefined ? { params, description } : { params };
  }

  return null;
}
