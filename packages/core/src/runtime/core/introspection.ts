/**
 * Runtime Introspection API
 *
 * Functions for inspecting runtime context at runtime.
 * These enable host applications to discover available functions and their signatures.
 */

import type { RuntimeContext } from './types/runtime.js';
import type { RillValue, TypeStructure } from './types/structures.js';
import {
  compareStructuredFields,
  formatStructure,
} from './types/operations.js';
import type { FieldComparisonCallbacks } from './types/operations.js';
import { escapeRillStringBody } from './types/format-string.js';
import {
  isApplicationCallable,
  isRuntimeCallable,
  isScriptCallable,
} from './callable.js';
import type { RillParam } from './callable.js';
import { LANGUAGE_REFERENCE } from '../../generated/introspection-data.js';
import { isBuiltinFunctionName } from './builtin-registry.js';
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
  TypeConstructorNode,
} from '../../types.js';
import { isPipeChainNode } from '../../types.js';
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
 * Script closures: reads `^(description: "...")` (including the bare-string
 * shorthand) or, when absent, the legacy `^(doc: "...")` annotation for description.
 * Script closures: returnType reflects the closure's declared/inferred return type,
 * falling back to 'any' only when genuinely unspecified.
 * Script closures: excludes nested closures in dicts/lists.
 *
 * Order: host functions, then built-ins, then script closures.
 *
 * @param ctx Runtime context
 * @returns Array of function metadata
 */
export function getFunctions(ctx: RuntimeContext): FunctionMetadata[] {
  const result: FunctionMetadata[] = [];

  // Defensive: handle invalid context
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
      // Malformed function entry skipped
      continue;
    }
  }

  // Enumerate script closures from variables (top-level only, no nested)
  for (const [name, value] of ctx.variables.entries()) {
    try {
      if (isScriptCallable(value)) {
        // Extract description: prefer annotations.description (covers both
        // the explicit `description: "..."` named arg and the `^("...")`
        // shorthand, which the parser expands to the same key), falling
        // back to the legacy `^(doc: "...")` annotation.
        let description = '';
        const descValue = value.annotations['description'];
        if (typeof descValue === 'string') {
          description = descValue;
        } else if (typeof value.annotations['doc'] === 'string') {
          description = value.annotations['doc'];
        }

        // Convert params to ParamMetadata using RillParam.type
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
          returnType: formatStructure(value.returnType.structure),
        });
      }
    } catch {
      // Malformed entry skipped
      continue;
    }
  }

  // Combine in specified order: host, built-ins, script closures
  return [...hostFunctions, ...builtinFunctions, ...result];
}

/**
 * Field-comparison callbacks for `serializeSignatureType`'s dict/tuple/ordered
 * branch. Mirrors `formatStructure`'s `formatCallbacks`, but routes each
 * field's type back through `serializeSignatureType` instead of
 * `formatStructure` so the union/closure collapse applies at every nesting
 * depth, not just the top level.
 */
const signatureFieldCallbacks: FieldComparisonCallbacks<string | null> = {
  onValueType(valueType) {
    return serializeSignatureType(valueType);
  },
  onValueTypeMismatch: () => null,
  onBothEmpty: () => null,
  onFieldPresenceMismatch: () => null,
  onDictFields(fields) {
    const parts = Object.keys(fields)
      .sort()
      .map((k) => `${k}: ${serializeSignatureType(fields[k]!.type)}`);
    return parts.join(', ');
  },
  onTupleElements(elements) {
    const parts = elements.map((field) => serializeSignatureType(field.type));
    return parts.join(', ');
  },
  onOrderedFields(fields) {
    const parts = fields.map(
      (field) => `${field.name}: ${serializeSignatureType(field.type)}`
    );
    return parts.join(', ');
  },
};

/**
 * Serialize a `TypeStructure` into a type-ref string that is always valid in
 * a bodyless `|params| :ret` closure type signature.
 *
 * `formatStructure` renders union members joined by bare `|` and closures as
 * `|params| :ret` — both forms are ambiguous or unparseable when embedded
 * inside the `|...|` delimiters of a manifest closure signature, so they
 * collapse to `any` / `closure` here instead. Every other structure already
 * round-trips through `formatStructure` (e.g. `string`, `list(number)`,
 * `dict`).
 *
 * The collapse is recursive: `list`, `dict`, `tuple`, `ordered`, and `stream`
 * walk their element/field/chunk sub-structures through this same function,
 * so a nested closure or union (e.g. a callback list's element type)
 * collapses too, not just one carried directly by a param or return type.
 * `stream`'s resolution type (`ret`) is omitted rather than recursed into —
 * see the `stream` branch below for why.
 */
function serializeSignatureType(structure: TypeStructure): string {
  if (structure.kind === 'union') return 'any';
  if (structure.kind === 'closure') return 'closure';

  if (structure.kind === 'list') {
    const element = (structure as { element?: TypeStructure }).element;
    if (element === undefined) return 'list';
    return `list(${serializeSignatureType(element)})`;
  }

  if (
    structure.kind === 'dict' ||
    structure.kind === 'tuple' ||
    structure.kind === 'ordered'
  ) {
    const inner = compareStructuredFields(
      structure,
      structure,
      signatureFieldCallbacks,
      null
    );
    if (inner === null) return structure.kind;
    return `${structure.kind}(${inner})`;
  }

  if (structure.kind === 'stream') {
    // The `stream(<chunk>):<ret>` resolution-type suffix is grammar owned by
    // a real closure's own trailing return-type-target parse (used only
    // right after a closure body); the bodyless `|params|:ret` signature
    // grammar parses every type — including this one, when it appears as a
    // param type or return type — through the ordinary expression/type-ref
    // parser, which does not recognize that suffix at all. Emitting it here
    // would leave a dangling `:<ret>` the parser cannot attach anywhere, so
    // the resolution type is intentionally omitted rather than collapsing
    // the whole `stream(...)` to `any`.
    const t = structure as { kind: 'stream'; chunk?: TypeStructure };
    if (t.chunk === undefined) return 'stream';
    return `stream(${serializeSignatureType(t.chunk)})`;
  }

  return formatStructure(structure);
}

/**
 * Serialize a single RillParam into rill closure parameter syntax.
 *
 * Format: `^(description: "...") name: type`
 * - Annotation prefix included only when annotations.description is present.
 * - Type defaults to `any` when param.type is undefined.
 *
 * Default values are intentionally not emitted: not every `RillValue`
 * (e.g. datetime, atom) round-trips through a rill literal, so appending
 * `= <value>` risked emitting a manifest entry that could not be parsed
 * back. The manifest is a type signature, not a call site — omitting
 * defaults keeps every entry guaranteed-parseable.
 */
function serializeParam(p: RillParam): string {
  const parts: string[] = [];

  // Parameter-level description annotation
  const desc = p.annotations['description'];
  if (typeof desc === 'string' && desc.length > 0) {
    parts.push(`^(description: "${escapeRillStringBody(desc)}") `);
  }

  // Name and type
  const typeName =
    p.type !== undefined ? serializeSignatureType(p.type) : 'any';
  parts.push(`${p.name}: ${typeName}`);

  return parts.join('');
}

/**
 * True when any param carries a non-empty `description` annotation.
 *
 * The bodyless closure-signature grammar (`|name: type, ...|:ret`) is
 * recognized by a fixed-shape lookahead — `|` immediately followed by a bare
 * `identifier :` — and its param parser expects a bare identifier with no
 * `^(...)` prefix. A `^(description: "...")` annotation on a parameter would
 * either misroute the whole entry to the ordinary (body-requiring) closure
 * parser or fail outright once the sig-literal parser reaches it, so
 * annotated params must use the real-closure-literal fallback instead.
 */
function hasAnyParamDescription(params: readonly RillParam[]): boolean {
  return params.some((p) => {
    const desc = p.annotations['description'];
    return typeof desc === 'string' && desc.length > 0;
  });
}

/**
 * Serialize a typed ApplicationCallable entry into a rill closure type signature string.
 *
 * Format: `^(description: "...") |param: type|:returnType`
 * - Closure-level description annotation prefix included only when description is present.
 * - Return type suffix always emitted (including `:any`) so the signature matches
 *   the bodyless `|params| :ret` grammar unconditionally.
 * - Two cases fall back to a real (trivially bodied) closure literal —
 *   `|params|{pass}:ret` — instead of the bodyless closure-signature form:
 *   - Empty param list: the parser lexes `||` as a single token and only
 *     recognizes the bodyless grammar when at least one `name: type` param
 *     is present, so a zero-param `||:ret` never parses.
 *   - Any param carries a description annotation (see
 *     `hasAnyParamDescription`), which the bodyless grammar cannot parse.
 */
function serializeClosureSignature(
  params: readonly RillParam[],
  returnType: TypeStructure,
  description: string | undefined
): string {
  const parts: string[] = [];

  // Closure-level description annotation
  if (typeof description === 'string' && description.length > 0) {
    parts.push(`^(description: "${escapeRillStringBody(description)}") `);
  }

  const retStr = serializeSignatureType(returnType);
  const paramStr = params.map(serializeParam).join(', ');

  if (params.length === 0 || hasAnyParamDescription(params)) {
    parts.push(`|${paramStr}|{pass}:${retStr}`);
    return parts.join('');
  }

  // Bodyless closure-signature form
  parts.push(`|${paramStr}|`);
  parts.push(`:${retStr}`);

  return parts.join('');
}

/**
 * Generate a rill manifest file from the registered host functions in ctx.
 *
 * Returns a string containing a valid rill file: a dict literal of
 * string-keyed closure type signatures followed by `-> export`.
 *
 * Only `ApplicationCallable` entries with `params !== undefined` are included.
 * `RuntimeCallable` entries are excluded. Built-in functions (by registered builtin name) are excluded.
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
    if (isRuntimeCallable(callable) || isBuiltinFunctionName(name)) {
      continue;
    }

    // Include only ApplicationCallable entries with params defined
    if (!isApplicationCallable(callable) || callable.params === undefined) {
      continue;
    }

    const signature = serializeClosureSignature(
      callable.params,
      callable.returnType.structure,
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

  // Handle empty context
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

    // Function with 0 params and description counts as documented
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
  /**
   * Closure return type annotation, formatted with the same grammar as
   * parameter type strings. `undefined` when the closure has no `:T` suffix.
   * Stream returns are rendered as `stream(<chunk>):<ret>` (omitting the
   * trailing `:<ret>` when no resolution type is declared).
   */
  readonly returnType?: string;
}

/**
 * Convert a TypeRef to a human-readable type string. Parameterized types are
 * rendered as `name(arg, arg, ...)` with each named arg as `name: <type>`,
 * matching the source grammar. The serialized form is what
 * `introspectHandlerFromAST()` emits for parameter `type` strings and the
 * `returnType` field on `HandlerMetadataStatic`.
 */
function typeRefToString(ref: TypeRef | null): string {
  if (ref === null) return 'any';
  switch (ref.kind) {
    case 'static': {
      if (ref.args === undefined || ref.args.length === 0) {
        return ref.typeName;
      }
      const args = ref.args
        .map((arg) => {
          const valueStr = typeRefToString(arg.value);
          return arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
        })
        .join(', ');
      return `${ref.typeName}(${args})`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return ref.members.map(typeRefToString).join(' | ');
  }
}

/**
 * Convert a TypeConstructorNode (`list(...)`, `dict(...)`, `stream(...)`, etc.)
 * to its source-grammar display form. Stream constructors render as
 * `stream(<chunk>):<ret>` to match the `:stream(T):R` annotation, falling back
 * to `stream(<chunk>)` when no resolution arg is present.
 */
function typeConstructorToString(node: TypeConstructorNode): string {
  if (node.constructorName === 'stream') {
    const chunkArg = node.args[0];
    const retArg = node.args[1];
    const chunkStr =
      chunkArg !== undefined ? typeRefToString(chunkArg.value) : 'any';
    const retSuffix =
      retArg !== undefined ? `:${typeRefToString(retArg.value)}` : '';
    return `stream(${chunkStr})${retSuffix}`;
  }
  const args = node.args
    .map((arg) => {
      const valueStr = typeRefToString(arg.value);
      return arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
    })
    .join(', ');
  return `${node.constructorName}(${args})`;
}

/**
 * Format a closure's return-type target (the value parsed from `:T` after the
 * closure body). Returns undefined when no annotation is present so callers
 * can omit the field from the emitted metadata.
 */
function formatReturnTypeTarget(
  target: TypeRef | TypeConstructorNode | undefined
): string | undefined {
  if (target === undefined) return undefined;
  if ('type' in target && target.type === 'TypeConstructor') {
    return typeConstructorToString(target);
  }
  return typeRefToString(target as TypeRef);
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
    if (!isPipeChainNode(named.value)) continue;
    const chain = named.value;

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
    if (stmt.type === 'RecoveryError' || stmt.type === 'PartialExpression')
      continue;

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
    const returnType = formatReturnTypeTarget(closure.returnTypeTarget);

    return {
      params,
      ...(description !== undefined && { description }),
      ...(returnType !== undefined && { returnType }),
    };
  }

  return null;
}
