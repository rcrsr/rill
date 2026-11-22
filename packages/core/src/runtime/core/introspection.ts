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
  appendDefault,
  formatRillLiteral,
  formatStructure,
} from './types/operations.js';
import { resolveAtom, toAtomValue } from './types/atom-registry.js';
import {
  escapeRillStringBody,
  formatFieldKey,
  quoteRillString,
} from './types/format-string.js';
import { declaredParams, isScriptCallable } from './callable.js';
import type { RillParam } from './callable.js';
import { LANGUAGE_REFERENCE } from '../../generated/introspection-data.js';
import { getBuiltinFunctionCache } from './builtin-registry.js';
import { anyTypeValue } from './types/any-type.js';
import {
  createMap,
  createOrdered,
  createTuple,
  mapEntryFault,
} from './types/constructors.js';
import { setDictField } from './types/dict-keys.js';
import type {
  AnnotationArg,
  ClosureNode,
  ClosureParamNode,
  DictEntryNode,
  ExpressionNode,
  ListSpreadNode,
  LiteralNode,
  MapEntryNode,
  PipeChainNode,
  PostfixExprNode,
  PrimaryNode,
  ScriptNode,
  StatementNode,
} from '../../types.js';
import { isPipeChainNode, isUnnamedParam } from '../../types.js';
import { throwFatalHostHalt } from './types/halt.js';
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
 * Serialize a single RillParam into rill fn parameter syntax.
 *
 * Format: `^(description: "...") name: type`
 * - Annotation prefix included only when annotations.description is present.
 * - Type defaults to `any` when param.type is undefined.
 *
 * A default prints as `= literal` after the type. A default with no literal
 * form (datetime, duration, function, vector, iterator, stream, type
 * value, non-finite or exponent number) is left out, so that parameter is
 * required when the entry is registered again. The type text stays.
 */
function serializeParam(p: RillParam): string {
  const parts: string[] = [];

  // Parameter-level description annotation
  const desc = p.annotations['description'];
  if (typeof desc === 'string' && desc.length > 0) {
    parts.push(`^(description: "${escapeRillStringBody(desc)}") `);
  }

  // Name and type
  const typeName = p.type !== undefined ? formatStructure(p.type) : 'any';
  parts.push(appendDefault(`${p.name}: ${typeName}`, p.defaultValue));

  return parts.join('');
}

/**
 * Serialize a typed ApplicationCallable entry into an fn type string.
 *
 * Format: `^(description: "...") fn(param: type):returnType`
 * - Description annotation prefix included only when description is present.
 * - Return type suffix always emitted (including `:any`), matching the
 *   complete form `formatStructure` prints.
 * - `fn():ret` is emitted for a zero-param entry, and `^(description: "...")`
 *   prefixes individual params (see `serializeParam`).
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

  const retStr = formatStructure(returnType);
  const paramStr = params.map(serializeParam).join(', ');

  parts.push(`fn(${paramStr})`);
  parts.push(`:${retStr}`);

  return parts.join('');
}

/**
 * Generate a rill manifest file from the registered host functions in ctx.
 *
 * Returns a bracketed list of `"name": fn(...)` signature entries, one per
 * registered function, each registrable as a host function signature.
 *
 * Every registered host function is included. Built-in functions (by registered
 * builtin name) are excluded.
 *
 * Empty function map produces `[:]`.
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

    entries.push(`  ${quoteRillString(name)}: ${signature}`);
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
  readonly defaultValue?: RillValue | undefined;
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
  const valueStr = formatTypeRef(arg.value);
  const named =
    arg.name !== undefined
      ? `${formatFieldKey(arg.name)}: ${valueStr}`
      : valueStr;
  const literal =
    arg.defaultValue !== undefined
      ? extractLiteralValue(arg.defaultValue)
      : undefined;
  return appendDefault(named, literal);
}

/** True for an unnamed `any` argument with no default: an unspecified slot. */
function isAnyArg(arg: FieldArg | undefined): boolean {
  return (
    arg !== undefined &&
    arg.name === undefined &&
    arg.defaultValue === undefined &&
    arg.value.kind === 'static' &&
    arg.value.typeName === 'any' &&
    (arg.value.args === undefined || arg.value.args.length === 0)
  );
}

/**
 * Convert a TypeRef to a human-readable type string. Parameterized types are
 * rendered as `name(arg, arg, ...)` with each named arg as `name: <type>`,
 * matching the source grammar. The serialized form is what
 * `introspectHandlerFromAST()` emits for parameter `type` strings and the
 * `returnType` field on `HandlerMetadataStatic`.
 */
export function formatTypeRef(ref: TypeRef | null): string {
  if (ref === null) return 'any';
  switch (ref.kind) {
    case 'static': {
      if (ref.args === undefined || ref.args.length === 0) {
        return ref.typeName;
      }
      // A stream carries its outer type in args[1]: stream(chunk):outer.
      // An unspecified outer is dropped, and a list or stream with every
      // slot unspecified prints as its bare name.
      const rawOuter = ref.typeName === 'stream' ? ref.args[1] : undefined;
      const outer = isAnyArg(rawOuter) ? undefined : rawOuter;
      const inner = rawOuter === undefined ? ref.args : ref.args.slice(0, 1);
      if (
        (ref.typeName === 'list' || ref.typeName === 'stream') &&
        outer === undefined &&
        inner.every(isAnyArg)
      ) {
        return ref.typeName;
      }
      const args = inner
        .map((arg) => {
          return fieldArgToString(arg);
        })
        .join(', ');
      const outerStr =
        outer === undefined ? '' : `:${formatTypeRef(outer.value)}`;
      return `${ref.typeName}(${args})${outerStr}`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return `union(${ref.members.map(formatTypeRef).join(', ')})`;
    case 'literal':
      return formatLiteral(ref.value) ?? 'any';
    case 'fn': {
      const outer =
        ref.outer === undefined ? undefined : formatTypeRef(ref.outer);
      if (ref.params === undefined) {
        return outer === undefined || outer === 'any' ? 'fn' : `fn:${outer}`;
      }
      const params = ref.params.map(formatFnParam).join(', ');
      return `fn(${params}):${outer ?? 'any'}`;
    }
  }
  return throwFatalHostHalt(
    { fn: 'formatTypeRef' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unhandled type reference kind'
  );
}

/** Print a literal type-ref value in source form, or undefined when it has none. */
function formatLiteral(node: LiteralNode): string | undefined {
  const literal = extractLiteralValue(node);
  return literal === undefined ? undefined : formatRillLiteral(literal);
}

/**
 * Print an fn param in source form: an unnamed param (bound to `$` or `$@`)
 * as its type, a named param as `name: type`, plus a default that has a
 * scalar or atom source form.
 */
function formatFnParam(param: ClosureParamNode): string {
  const type = formatTypeRef(param.typeRef);
  const unnamed = isUnnamedParam(param);
  const base = unnamed ? type : `${param.name}: ${type}`;
  if (param.defaultValue === null) return base;
  return appendDefault(base, extractLiteralValue(param.defaultValue));
}

/**
 * Format a closure's return-type target (the value parsed from `:T` after the
 * closure body). Returns undefined when no annotation is present so callers
 * can omit the field from the emitted metadata.
 */
function formatReturnTypeTarget(
  target: TypeRef | undefined
): string | undefined {
  if (target === undefined) return undefined;
  return formatTypeRef(target);
}

/** The literal a bare expression node holds, or undefined when it is anything else. */
function literalOfExpression(node: ExpressionNode): RillValue | undefined {
  if (!isPipeChainNode(node)) return undefined;
  if (node.pipes.length > 0 || node.terminator !== null) return undefined;
  const head = node.head;
  if (head.type === 'UnaryExpr') {
    if (head.op !== '-' || head.operand.type !== 'PostfixExpr') {
      return undefined;
    }
    const inner = literalOfPostfix(head.operand);
    return typeof inner === 'number' ? -inner : undefined;
  }
  return head.type === 'PostfixExpr' ? literalOfPostfix(head) : undefined;
}

function literalOfPostfix(node: PostfixExprNode): RillValue | undefined {
  if (node.methods.length > 0 || node.defaultValue !== null) return undefined;
  if (node.existenceCheck !== undefined && node.existenceCheck !== null) {
    return undefined;
  }
  return extractLiteralValue(node.primary);
}

/** Values of literal-only expressions, or undefined when any is not a literal or is a spread. */
function literalElements(
  elements: readonly (ExpressionNode | ListSpreadNode)[]
): RillValue[] | undefined {
  const values: RillValue[] = [];
  for (const element of elements) {
    if (element.type === 'ListSpread') return undefined;
    const value = literalOfExpression(element);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

/** Literal-only name/value entries of a dict or ordered literal, or undefined. */
function literalNamedEntries(
  entries: readonly DictEntryNode[]
): [string, RillValue][] | undefined {
  const out: [string, RillValue][] = [];
  for (const entry of entries) {
    const value = literalOfExpression(entry.value);
    if (value === undefined) return undefined;
    const keys = literalNamedKeys(entry.key);
    if (keys === undefined) return undefined;
    for (const key of keys) out.push([key, value]);
  }
  return out;
}

/** A dict entry's literal keys: a name, or a non-empty list of strings that fans out; undefined otherwise. */
function literalNamedKeys(key: DictEntryNode['key']): string[] | undefined {
  if (typeof key === 'string') return [key];
  if (!('type' in key) || key.defaultValue !== null) return undefined;
  const keys = literalElements(key.elements);
  if (keys === undefined || keys.length === 0) return undefined;
  return keys.every((k): k is string => typeof k === 'string')
    ? keys
    : undefined;
}

/** Literal-only map entries (a list key fans out to one entry per key), or undefined. */
function literalMapEntries(
  entries: readonly MapEntryNode[]
): [RillValue, RillValue][] | undefined {
  const out: [RillValue, RillValue][] = [];
  for (const entry of entries) {
    const value = literalOfExpression(entry.value);
    if (value === undefined) return undefined;
    let keys: RillValue[] | undefined;
    if (entry.key.type === 'ListLiteral') {
      // The runtime halts on an empty multi-key list, so it has no default.
      keys =
        entry.key.defaultValue === null && entry.key.elements.length > 0
          ? literalElements(entry.key.elements)
          : undefined;
    } else {
      const key = literalOfExpression(entry.key);
      keys = key === undefined ? undefined : [key];
    }
    if (keys === undefined) return undefined;
    for (const key of keys) out.push([key, value]);
  }
  return mapEntryFault(out) === undefined ? out : undefined;
}

/**
 * The value a literal AST node denotes: scalars, atoms, and list, dict,
 * tuple, ordered, and map literals holding only such values. Undefined for
 * any other node, so a default that is not a literal is left out.
 */
function extractLiteralValue(node: PrimaryNode): RillValue | undefined {
  switch (node.type) {
    case 'AtomLiteral':
      return toAtomValue(resolveAtom(node.name));
    case 'NumberLiteral':
      return node.value;
    case 'BoolLiteral':
      return node.value;
    case 'StringLiteral': {
      // Skip strings with interpolations
      if (!node.parts.every((p): p is string => typeof p === 'string')) {
        return undefined;
      }
      return node.parts.join('');
    }
    case 'ListLiteral':
      return node.defaultValue === null
        ? literalElements(node.elements)
        : undefined;
    case 'TupleLiteral': {
      const values = literalElements(node.elements);
      return values === undefined ? undefined : createTuple(values);
    }
    case 'DictLiteral': {
      const entries = literalNamedEntries(node.entries);
      if (entries === undefined) return undefined;
      const dict: Record<string, RillValue> = {};
      for (const [key, value] of entries) setDictField(dict, key, value);
      return dict;
    }
    case 'OrderedLiteral': {
      const entries = literalNamedEntries(node.entries);
      return entries === undefined ? undefined : createOrdered(entries);
    }
    case 'MapLiteral': {
      if (node.defaultValue !== null) return undefined;
      const entries = literalMapEntries(node.entries);
      return entries === undefined ? undefined : createMap(entries);
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
          type: formatTypeRef(param.typeRef),
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
