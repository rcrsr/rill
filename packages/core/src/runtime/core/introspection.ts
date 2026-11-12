/**
 * Runtime Introspection API
 *
 * Functions for inspecting runtime context at runtime.
 * These enable host applications to discover available functions and their signatures.
 */

import type { RuntimeContext } from './types/runtime.js';
import type {
  RillTypeValue,
  RillValue,
  TypeStructure,
} from './types/structures.js';
import {
  compareStructuredFields,
  formatStructure,
} from './types/operations.js';
import type { FieldComparisonCallbacks } from './types/operations.js';
import { escapeRillStringBody } from './types/format-string.js';
import { declaredParams, isScriptCallable } from './callable.js';
import type { RillParam } from './callable.js';
import { LANGUAGE_REFERENCE } from '../../generated/introspection-data.js';
import { getBuiltinFunctionCache } from './builtin-registry.js';
import { anyTypeValue } from './types/any-type.js';
import type {
  AnnotationArg,
  ClosureNode,
  ClosureParamNode,
  LiteralNode,
  PipeChainNode,
  ScriptNode,
  StatementNode,
  TypeConstructorNode,
} from '../../types.js';
import { isPipeChainNode } from '../../types.js';
import { throwFatalHostHalt } from './types/halt.js';
import { isStructureKind } from './types/guards.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../error-registry.js';
import type { FieldArg, TypeRef } from '../../value-types.js';

/**
 * Metadata describing a function's signature and documentation.
 * Returned by introspection APIs like getFunctions().
 */
export interface FunctionMetadata {
  /** Function name (reported verbatim as registered) */
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
 * Resolve a callable's return structure. JS hosts can register functions
 * without a returnType; those report 'any', as untyped params do.
 */
export function resolveReturnStructure(callable: {
  readonly returnType: RillTypeValue;
}): TypeStructure {
  return (callable.returnType as RillTypeValue | undefined) !== undefined
    ? callable.returnType.structure
    : anyTypeValue.structure;
}

/** Read a string `description` annotation; any other value reads as absent. */
function annotationDescription(
  annotations: Readonly<Record<string, RillValue>> | undefined
): string | undefined {
  const description = annotations?.['description'];
  return typeof description === 'string' ? description : undefined;
}

/**
 * Enumerate all callable functions registered in runtime context.
 *
 * Returns flat list combining host functions, built-ins, and script closures.
 * Names are reported verbatim as registered.
 * Malformed entries silently skipped (valid entries returned). This includes
 * a hand-built function entry without a parameter declaration: introspection
 * omits it rather than halting, because enumeration must not fail on one bad
 * entry. Invoking such an entry halts with RILL-R085.
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
  if (
    ctx === null ||
    ctx === undefined ||
    ctx.functions === null ||
    ctx.functions === undefined ||
    ctx.variables === null ||
    ctx.variables === undefined
  ) {
    return result;
  }

  // Separate host functions and built-ins
  const hostFunctions: FunctionMetadata[] = [];
  const builtinFunctions: FunctionMetadata[] = [];

  // Enumerate functions in ctx.functions
  for (const [name, fn] of ctx.functions.entries()) {
    try {
      const params: ParamMetadata[] = fn.params.map((p) => ({
        name: p.name,
        type: p.type !== undefined ? formatStructure(p.type) : 'any',
        description:
          typeof p.annotations['description'] === 'string'
            ? p.annotations['description']
            : '',
        defaultValue: p.defaultValue ?? undefined,
      }));

      const metadata: FunctionMetadata = {
        name,
        description: annotationDescription(fn.annotations) ?? '',
        params,
        returnType: formatStructure(resolveReturnStructure(fn)),
      };
      if (getBuiltinFunctionCache().get(name) === fn) {
        builtinFunctions.push(metadata);
      } else {
        hostFunctions.push(metadata);
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
          returnType: formatStructure(resolveReturnStructure(value)),
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
    const parts: string[] = [];
    for (const k of Object.keys(fields).sort()) {
      const field = fields[k];
      if (field !== undefined) {
        parts.push(`${k}: ${serializeSignatureType(field.type)}`);
      }
    }
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
 * `formatStructure` renders closures as `|params| :ret`, a form that is
 * unparseable when embedded inside the `|...|` delimiters of a manifest
 * closure signature, so closures collapse to `closure` here instead. Unions
 * print as `union(...)`, which nests safely. Every other structure already
 * round-trips through `formatStructure` (e.g. `string`, `list(number)`,
 * `dict`).
 *
 * The collapse is recursive: `list`, `dict`, `tuple`, `ordered`, and `stream`
 * walk their element/field/chunk sub-structures through this same function,
 * so a nested closure (e.g. a callback list's element type)
 * collapses too, not just one carried directly by a param or return type.
 * `stream`'s resolution type (`ret`) is omitted rather than recursed into —
 * see the `stream` branch below for why.
 */
function serializeSignatureType(structure: TypeStructure): string {
  if (isStructureKind(structure, 'union')) {
    return `union(${structure.members.map(serializeSignatureType).join(', ')})`;
  }
  if (structure.kind === 'closure') return 'closure';

  if (isStructureKind(structure, 'list')) {
    const element = structure.element;
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

  if (isStructureKind(structure, 'stream')) {
    // The `stream(<chunk>):<ret>` resolution-type suffix is grammar owned by
    // a real closure's own trailing return-type-target parse (used only
    // right after a closure body); the bodyless `|params|:ret` signature
    // grammar parses every type — including this one, when it appears as a
    // param type or return type — through the ordinary expression/type-ref
    // parser, which does not recognize that suffix at all. Emitting it here
    // would leave a dangling `:<ret>` the parser cannot attach anywhere, so
    // the resolution type is intentionally omitted rather than collapsing
    // the whole `stream(...)` to `any`.
    if (structure.chunk === undefined) return 'stream';
    return `stream(${serializeSignatureType(structure.chunk)})`;
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
 * Serialize a typed ApplicationCallable entry into a rill closure type signature string.
 *
 * Format: `^(description: "...") |param: type|:returnType`
 * - Closure-level description annotation prefix included only when description is present.
 * - Return type suffix always emitted (including `:any`) so the signature matches
 *   the bodyless `|params| :ret` grammar unconditionally.
 * - The bodyless closure-signature form is emitted unconditionally, including
 *   `||:ret` for a zero-param entry and `^(description: "...")` prefixes on
 *   individual params (see `serializeParam`).
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
 * Every registered host function is included. Built-in functions (by registered
 * builtin name) are excluded.
 *
 * Empty function map produces `[:]` followed by `-> export`.
 *
 * @param ctx Runtime context
 * @returns Rill manifest file content as a string
 */
export function generateManifest(ctx: RuntimeContext): string {
  const entries: string[] = [];

  for (const [name, fn] of ctx.functions.entries()) {
    // Exclude built-ins by identity so a host function overriding a built-in
    // name is still included
    if (getBuiltinFunctionCache().get(name) === fn) {
      continue;
    }

    const callable = fn;

    const signature = serializeClosureSignature(
      declaredParams(callable, name),
      resolveReturnStructure(callable),
      annotationDescription(callable.annotations)
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

/** Render one type argument, appending ` = <literal>` when it has a default. */
function fieldArgToString(arg: FieldArg): string {
  const valueStr = typeRefToString(arg.value);
  const named = arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
  const literal =
    arg.defaultValue !== undefined
      ? extractLiteralValue(arg.defaultValue)
      : undefined;
  if (typeof literal === 'string')
    return `${named} = ${JSON.stringify(literal)}`;
  if (typeof literal === 'number' || typeof literal === 'boolean') {
    return `${named} = ${String(literal)}`;
  }
  return named;
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
          return fieldArgToString(arg);
        })
        .join(', ');
      return `${ref.typeName}(${args})`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return `union(${ref.members.map(typeRefToString).join(', ')})`;
    case 'literal': {
      if (ref.value.type === 'AtomLiteral') return `#${ref.value.name}`;
      const literal = extractLiteralValue(ref.value);
      if (typeof literal === 'string') return JSON.stringify(literal);
      if (typeof literal === 'number' || typeof literal === 'boolean') {
        return String(literal);
      }
      return 'any';
    }
  }
  return throwFatalHostHalt(
    { fn: 'typeRefToString' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unhandled type reference kind'
  );
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
      return fieldArgToString(arg);
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
  if ('kind' in target) return typeRefToString(target);
  return typeConstructorToString(target);
}

/** Extract a primitive value from a literal AST node. Returns undefined for complex literals. */
function extractLiteralValue(node: LiteralNode): unknown {
  switch (node.type) {
    case 'NumberLiteral':
      return node.value;
    case 'BoolLiteral':
      return node.value;
    case 'StringLiteral': {
      const strNode = node;
      // Skip strings with interpolations
      if (!strNode.parts.every((p): p is string => typeof p === 'string')) {
        return undefined;
      }
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
    const named = arg;
    if (named.name !== 'description' && named.name !== 'doc') continue;

    // Navigate: value → PipeChainNode.head → PostfixExprNode.primary → StringLiteralNode
    if (!isPipeChainNode(named.value)) continue;
    const chain = named.value;

    const head = chain.head;
    if (head.type !== 'PostfixExpr') continue;

    const primary = head.primary;
    if (primary.type !== 'StringLiteral') continue;

    const strNode = primary;
    if (!strNode.parts.every((p): p is string => typeof p === 'string')) {
      continue;
    }

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
    const postfix = chain.head;
    if (postfix.primary.type === 'Closure') {
      return postfix.primary;
    }
  }

  // Check pipes for a ClosureNode
  for (const pipe of chain.pipes) {
    if (pipe.type === 'Closure') {
      return pipe;
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
      chain.pipes.some((p) => p.type === 'Capture' && p.name === handlerName) ||
      (chain.terminator?.type === 'Capture' &&
        chain.terminator.name === handlerName);

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
