/**
 * Parser Utility: Type Reference Parsing
 * Parses a type-ref production: either a static type name (optionally
 * parameterized) or a dynamic $variable.
 * @internal
 */

import {
  type ClosureParamNode,
  type TypeRef,
  type FieldArg,
  type LiteralNode,
  type AnnotationArg,
  type SourceLocation,
  TOKEN_TYPES,
  ParseError,
  isRillTypeName,
  isUnnamedParam,
} from '../types.js';
import {
  type ParserState,
  check,
  advance,
  expect,
  current,
  previous,
  peek,
  skipNewlines,
  makeSpan,
  withRecursionDepth,
} from './state.js';
import {
  VALID_TYPE_NAMES,
  isLiteralStart,
  isNegativeNumber,
  isVariableNameToken,
  parseTypeName,
  readStaticKey,
  rejectRepeatedKey,
  staticKeyWidth,
  expectVariableName,
} from './helpers.js';
import { ERROR_IDS } from '../error-registry.js';
import type { Parser } from './parser.js';

/**
 * Callbacks a type parse may need from the Parser. Annotations on a field
 * (`parseAnnotations`) and on an fn parameter (`parseFnAnnotations`) are kept
 * apart so supplying one never widens what the other accepts.
 */
interface TypeRefOpts {
  parseLiteral?: () => LiteralNode;
  parseAnnotations?: () => AnnotationArg[];
  parseFnAnnotations?: () => AnnotationArg[];
}

/**
 * Parse a type reference from the current position in the token stream.
 *
 * Grammar:
 * ```
 * type-ref          = single-type
 * single-type       = "$" identifier | fn-signature
 *                    | type-name [ "(" type-ref-arg-list ")" ]
 * type-ref-arg-list = type-ref-arg { "," type-ref-arg } [ "," ]
 * type-ref-arg      = identifier ":" type-ref | type-ref
 * ```
 *
 * - `$identifier`           → `{ kind: 'dynamic', varName: identifier }`
 * - `type-name`             → `{ kind: 'static', typeName }`
 * - `type-name(arg, ...)`   → `{ kind: 'static', typeName, args: [...] }`
 * - `union(A, B, ...)`    → `{ kind: 'union', members: [A, B, ...] }`
 *
 * Dynamic refs do not accept parameterization — `$T(...)` is not valid.
 *
 * Throws ParseError if neither a `$identifier` nor a valid type name
 * is found. Throws ParseError if the arg list is malformed.
 * Throws ParseError (RILL-P011) if a removed `|` union separator follows a
 * type.
 *
 * @internal
 */
export function parseTypeRef(state: ParserState, opts?: TypeRefOpts): TypeRef {
  return withRecursionDepth(
    state,
    () => current(state).span.start,
    () => parseTypeRefImpl(state, opts)
  );
}

/**
 * Parse a type reference in a script type position.
 *
 * Field defaults inside a parameterized type are literals, so every script
 * type position accepts them. Use this from Parser methods; call
 * `parseTypeRef` directly only where no Parser exists.
 *
 * @internal
 */
export function parseScriptTypeRef(parser: Parser): TypeRef {
  return parseTypeRef(parser.state, scriptTypeOpts(parser));
}

/**
 * The callbacks every script type position hands to the type parser: literals
 * for field defaults, and annotations for fn parameters only.
 *
 * @internal
 */
export function scriptTypeOpts(parser: Parser): TypeRefOpts {
  return {
    parseLiteral: () => parser.parseLiteral(),
    parseFnAnnotations: () => parser.parseAnnotationArgs(),
  };
}

/**
 * Whether the token at `offset` starts a type member: a valid type name or
 * a `$` dynamic-type reference.
 */
function startsTypeMember(state: ParserState, offset: number): boolean {
  const t = peek(state, offset);
  return (
    t.type === TOKEN_TYPES.DOLLAR ||
    (t.type === TOKEN_TYPES.IDENTIFIER &&
      (VALID_TYPE_NAMES as readonly string[]).includes(t.value))
  );
}

const REMOVED_SEPARATOR_PREFIX = "The '|' type separator was removed; write ";

/**
 * Raise RILL-P011 for a removed `|` separator. Consumes the remaining
 * members so the message names the `union(...)` rewrite in written order.
 */
function throwRemovedSeparator(
  state: ParserState,
  firstText: string,
  opts: TypeRefOpts | undefined,
  asOuter = false
): never {
  const location = current(state).span.start;
  const texts = [firstText];
  while (check(state, TOKEN_TYPES.PIPE_BAR) && startsTypeMember(state, 1)) {
    advance(state); // consume "|"
    const start = current(state).span.start.offset;
    parseSingleType(state, opts);
    texts.push(state.source.slice(start, previous(state).span.end.offset));
  }
  const rewrite =
    texts.length > 1 && texts.every((t) => t !== '')
      ? `union(${texts.join(', ')})`
      : 'unions as union(...)';
  const hint = asOuter ? `${rewrite} as the outer type` : rewrite;
  throw new ParseError(
    ERROR_IDS.RILL_P011,
    `${REMOVED_SEPARATOR_PREFIX}${hint}`,
    location
  );
}

function parseTypeRefImpl(state: ParserState, opts?: TypeRefOpts): TypeRef {
  const startOffset = current(state).span.start.offset;
  const first = parseSingleType(state, opts);

  if (!check(state, TOKEN_TYPES.PIPE_BAR)) return first;

  const firstText =
    state.source === ''
      ? ''
      : state.source.slice(startOffset, previous(state).span.end.offset);
  return throwRemovedSeparator(state, firstText, opts);
}

/**
 * Parse a single type (one member of a union, or the sole type-ref).
 * Grammar: `single-type = "$" identifier | type-name [ "(" type-ref-arg-list ")" ]`
 * @internal
 */
function parseSingleType(state: ParserState, opts?: TypeRefOpts): TypeRef {
  // Removed closure type literals: |x: T|:R and ||:R
  if (check(state, TOKEN_TYPES.OR, TOKEN_TYPES.PIPE_BAR)) {
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      "Syntax removed: the '|params|' closure type literal was removed; write fn(params):result",
      current(state).span.start
    );
  }

  if (check(state, TOKEN_TYPES.DOLLAR)) {
    advance(state); // consume $
    const nameToken = expectVariableName(
      state,
      'Expected variable name after $'
    );
    return { kind: 'dynamic', varName: nameToken.value };
  }

  const nameToken = current(state);
  if (nameToken.type === TOKEN_TYPES.IDENTIFIER) {
    if (nameToken.value === 'fn') return parseFnSignature(state, opts);
    if (nameToken.value === 'closure')
      throwRemovedClosureType(nameToken.span.start);
  }
  const typeName = parseTypeName(state, VALID_TYPE_NAMES);

  // Check for parameterized form: type-name "(" type-ref-arg-list ")"
  if (!check(state, TOKEN_TYPES.LPAREN)) {
    if (typeName === 'union') throwBareUnion(nameToken.span.start);
    // A bare name takes an outer as well: stream:R is stream(any):R.
    const args: FieldArg[] = [];
    if (parseOuterType(state, typeName, args, opts)) {
      return { kind: 'static', typeName, args };
    }
    return { kind: 'static', typeName };
  }

  advance(state); // consume "("

  if (typeName === 'union') {
    const members = parseUnionMembers(state, opts);
    advance(state); // consume ")"
    parseOuterType(state, typeName, [], opts);
    return { kind: 'union', members };
  }

  const keyed =
    typeName === 'dict' || typeName === 'ordered'
      ? { keyedCollection: `${typeName} type` as const }
      : {};
  const args = parseFieldArgList(state, {
    ...buildTypeRefOpts(opts),
    ...keyed,
  });
  advance(state); // consume ")"
  parseOuterType(state, typeName, args, opts);

  return { kind: 'static', typeName, args };
}

// ============================================================
// UNION MEMBER PARSING
// ============================================================

/**
 * Raise the parse error for `union` written without its member list.
 * @internal
 */
export function throwBareUnion(at: SourceLocation): never {
  throw new ParseError(
    ERROR_IDS.RILL_P003,
    'Invalid type: union needs its members, as in union(string, number)',
    at
  );
}

/** True when the current token starts a scalar or compound literal. */
function startsLiteral(state: ParserState): boolean {
  return (
    isLiteralStart(state) ||
    check(state, TOKEN_TYPES.ATOM) ||
    isNegativeNumber(state)
  );
}

/**
 * Parse the members of a `union(...)` constructor.
 *
 * Grammar: `member { "," member } [ "," ]` where a member is a literal or a
 * type-ref. Caller has already consumed `(`; this function stops before the
 * closing `)` without consuming it. Whether a literal is a legal member is
 * decided at run time, so any literal the literal parser accepts is kept.
 *
 * @throws ParseError RILL-P014 if a member is not followed by `,` or `)`
 * @internal
 */
export function parseUnionMembers(
  state: ParserState,
  opts?: TypeRefOpts
): TypeRef[] {
  const members: TypeRef[] = [];
  skipNewlines(state);

  while (!check(state, TOKEN_TYPES.RPAREN)) {
    if (opts?.parseLiteral !== undefined && startsLiteral(state)) {
      members.push({ kind: 'literal', value: opts.parseLiteral() });
    } else {
      members.push(parseTypeRef(state, buildTypeRefOpts(opts)));
    }

    skipNewlines(state);

    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
      skipNewlines(state);
    } else if (!check(state, TOKEN_TYPES.RPAREN)) {
      throw new ParseError(
        ERROR_IDS.RILL_P014,
        "Expected ',' or ')' in union member list",
        current(state).span.start
      );
    }
  }

  return members;
}

// ============================================================
// FIELD ARG LIST PARSING
// ============================================================

/**
 * Parse a comma-separated list of field arguments between `(` and `)`.
 *
 * Caller has already consumed the opening `(`. This function parses zero
 * or more arguments up to the closing `)` but does NOT consume it.
 *
 * Supports:
 * - Named args:      `name: type`  → `{ name, value }`
 * - Positional args: `type`        → `{ value }`
 * - Default values:  `= literal`   → `{ ..., defaultValue }` (when parseLiteral provided)
 * - Union types in value position via `parseTypeRef`
 * - Trailing commas before `)`
 *
 * Named arg detection: IDENTIFIER followed by COLON lookahead.
 *
 * @param state - Parser state (positioned after opening paren)
 * @param opts  - Optional parseLiteral callback for default value support
 *
 * @throws ParseError RILL-P014 if token after arg is not `,` or `)`
 *
 * @internal
 */

/** Forward the type-parse callbacks from field-arg opts to parseTypeRef opts. */
function buildTypeRefOpts(opts?: TypeRefOpts): TypeRefOpts | undefined {
  if (
    !opts?.parseLiteral &&
    !opts?.parseAnnotations &&
    !opts?.parseFnAnnotations
  )
    return undefined;
  const result: TypeRefOpts = {};
  if (opts.parseLiteral) result.parseLiteral = opts.parseLiteral;
  if (opts.parseAnnotations) result.parseAnnotations = opts.parseAnnotations;
  if (opts.parseFnAnnotations)
    result.parseFnAnnotations = opts.parseFnAnnotations;
  return result;
}

/** Read the static key at the cursor; the caller confirmed one starts here. */
function readKeyAtCursor(state: ParserState): string {
  const read = readStaticKey(state);
  if (read === undefined) {
    throw new ParseError(
      ERROR_IDS.RILL_P014,
      'Expected field key',
      current(state).span.start
    );
  }
  return read.key;
}

export function parseFieldArgList(
  state: ParserState,
  opts?: TypeRefOpts & {
    /** Set for dict and ordered types: named fields take any static key spelling. */
    keyedCollection?: 'dict type' | 'ordered type';
  }
): FieldArg[] {
  const args: FieldArg[] = [];
  const seenKeys = new Set<string>();

  skipNewlines(state);

  // Parse arg list: allow empty "()" and trailing commas
  while (!check(state, TOKEN_TYPES.RPAREN)) {
    // Parse optional field annotations: ^(annots) — multiple blocks merge
    let annotations: AnnotationArg[] | undefined;
    while (opts?.parseAnnotations && check(state, TOKEN_TYPES.CARET)) {
      advance(state); // consume ^
      expect(state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
      const block = opts.parseAnnotations();
      expect(state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
      skipNewlines(state);

      if (!annotations) {
        annotations = block;
      } else {
        annotations = annotations.concat(block);
      }

      // Guard: annotation must be followed by a field
      if (check(state, TOKEN_TYPES.RPAREN)) {
        throw new ParseError(
          ERROR_IDS.RILL_P014,
          'Expected field after annotation',
          current(state).span.start
        );
      }
    }

    // Check for named arg: static key ":" type-ref. Dict and ordered types
    // accept every static key spelling; other constructors take identifiers.
    const keyWidth = opts?.keyedCollection
      ? staticKeyWidth(state)
      : current(state).type === TOKEN_TYPES.IDENTIFIER
        ? 1
        : 0;
    if (
      keyWidth > 0 &&
      state.tokens[state.pos + keyWidth]?.type === TOKEN_TYPES.COLON
    ) {
      const keyStart = current(state).span.start;
      const name = opts?.keyedCollection
        ? readKeyAtCursor(state)
        : advance(state).value;
      if (opts?.keyedCollection) {
        rejectRepeatedKey(seenKeys, name, keyStart, opts.keyedCollection);
      }
      advance(state); // consume ":"
      skipNewlines(state);
      const typeRefOpts = buildTypeRefOpts(opts);
      const value = parseTypeRef(state, typeRefOpts);
      const arg: FieldArg = { name, value };
      if (annotations) {
        arg.annotations = annotations;
      }
      if (opts?.parseLiteral && check(state, TOKEN_TYPES.ASSIGN)) {
        advance(state); // consume =
        skipNewlines(state);
        arg.defaultValue = opts.parseLiteral();
      }
      args.push(arg);
    } else {
      // Positional arg: type-ref
      const typeRefOpts = buildTypeRefOpts(opts);
      const value = parseTypeRef(state, typeRefOpts);
      const arg: FieldArg = { value };
      if (annotations) {
        arg.annotations = annotations;
      }
      if (opts?.parseLiteral && check(state, TOKEN_TYPES.ASSIGN)) {
        advance(state); // consume =
        skipNewlines(state);
        arg.defaultValue = opts.parseLiteral();
      }
      args.push(arg);
    }

    skipNewlines(state);

    // Consume trailing or separating comma
    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
      skipNewlines(state);
    } else if (!check(state, TOKEN_TYPES.RPAREN)) {
      // Neither comma nor closing paren — malformed arg list
      throw new ParseError(
        ERROR_IDS.RILL_P014,
        "Expected ',' or ')' in type argument list",
        current(state).span.start
      );
    }
  }

  return args;
}

/**
 * Handle the outer type of a type form: `name(inner):outer` or `name:outer`.
 *
 * Call with the cursor just past the closing `)`, or just past the type name
 * when it has no parentheses. When the next tokens are
 * `:` followed by a type name, the outer is consumed: a `stream` keeps it in
 * args[1] (chunk type in args[0], an `any` placeholder when the chunk is
 * empty); every type that takes no outer raises RILL-P006. A `:$t` or
 * `:<non-type>` is not an outer, so an assertion keeps its meaning.
 *
 * @returns true when an outer was consumed into `args`
 * @throws ParseError RILL-P006 for an outer on a type that takes none
 * @internal
 */
export function parseOuterType(
  state: ParserState,
  typeName: string,
  args: FieldArg[],
  opts?: TypeRefOpts
): boolean {
  if (!atOuterType(state)) return false;
  if (typeName !== 'stream') {
    if (!NO_OUTER_TYPES.includes(typeName)) return false;
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      `${typeName} takes no outer type`,
      current(state).span.start
    );
  }
  if (args.length > 1) {
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      'stream takes no outer type after more than one chunk type',
      current(state).span.start
    );
  }
  const outer = parseOuterAfterColon(state, opts);
  if (args.length === 0) {
    args.push({ value: { kind: 'static', typeName: 'any' } });
  }
  args.push({ value: outer });
  return true;
}

/**
 * Consume `:` and the outer type after it. A removed `|` separator after the
 * outer raises RILL-P011 naming the `union(...)` rewrite of the outer.
 */
function parseOuterAfterColon(
  state: ParserState,
  opts: TypeRefOpts | undefined
): TypeRef {
  advance(state); // consume ':'
  const outerStart = current(state).span.start.offset;
  const outer = parseSingleType(state, buildTypeRefOpts(opts));
  if (check(state, TOKEN_TYPES.PIPE_BAR) && startsTypeMember(state, 1)) {
    const outerText = state.source.slice(
      outerStart,
      previous(state).span.end.offset
    );
    throwRemovedSeparator(state, outerText, buildTypeRefOpts(opts), true);
  }
  return outer;
}

/**
 * True when the cursor sits on `:<type-name>`, the start of an outer type.
 * A `:$t` or `:<non-type>` is an assertion, not an outer.
 * @internal
 */
export function atOuterType(state: ParserState, offset = 0): boolean {
  return (
    peek(state, offset).type === TOKEN_TYPES.COLON &&
    peek(state, offset + 1).type === TOKEN_TYPES.IDENTIFIER &&
    isRillTypeName(peek(state, offset + 1).value)
  );
}

/** Type names whose form takes no outer type. */
const NO_OUTER_TYPES: readonly string[] = [
  'list',
  'dict',
  'tuple',
  'ordered',
  'union',
];

// ============================================================
// FN SIGNATURE PARSING
// ============================================================

/**
 * Raise RILL-P012 for the removed `closure` type name.
 * @internal
 */
export function throwRemovedClosureType(at: SourceLocation): never {
  throw new ParseError(
    ERROR_IDS.RILL_P012,
    "Syntax removed: the 'closure' type was removed; write fn",
    at
  );
}

/** Build an RILL-P028 error for an invalid unnamed-parameter list. */
function unnamedParamError(details: string, at: SourceLocation): ParseError {
  return new ParseError(ERROR_IDS.RILL_P028, details, at);
}

/**
 * Parse one fn parameter, named or unnamed.
 *
 * Grammar: `[^(annots)] name [":" type] ["=" literal]` (named) or
 * `[^(annots)] type` (unnamed). A bare name that is not a type name is a
 * named param; a type name or `$var` starts an unnamed param. A type name
 * followed by `:` and no outer type is a reserved-keyword param name.
 */
function parseFnParam(
  state: ParserState,
  opts: TypeRefOpts | undefined,
  unnamedSoFar: number
): ClosureParamNode {
  const start = current(state).span.start;
  let annotations: AnnotationArg[] | undefined;
  while (check(state, TOKEN_TYPES.CARET)) {
    if (opts?.parseFnAnnotations === undefined) {
      throw new ParseError(
        ERROR_IDS.RILL_P001,
        'Parameter annotations are not allowed here',
        current(state).span.start
      );
    }
    advance(state); // consume ^
    expect(state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
    const block = opts.parseFnAnnotations();
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
    skipNewlines(state);
    annotations = annotations ? annotations.concat(block) : block;
  }

  const first = current(state);
  if (first.type === TOKEN_TYPES.IDENTIFIER && first.value === 'closure') {
    throwRemovedClosureType(first.span.start);
  }
  const startsType =
    first.type === TOKEN_TYPES.DOLLAR ||
    (first.type === TOKEN_TYPES.IDENTIFIER && isRillTypeName(first.value));

  if (startsType) {
    // `<typename>:` names the param after a type unless the type takes an outer.
    const takesOuter = first.value === 'stream' || first.value === 'fn';
    if (
      first.type === TOKEN_TYPES.IDENTIFIER &&
      peek(state, 1).type === TOKEN_TYPES.COLON &&
      !(takesOuter && atOuterType(state, 1))
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P003,
        `Reserved type keyword cannot be used as parameter name: ${first.value}`,
        first.span.start
      );
    }
    if (unnamedSoFar >= 2) {
      throw unnamedParamError(
        "fn takes at most two unnamed params, bound to '$' and '$@'",
        first.span.start
      );
    }
    const typeRef = parseTypeRef(state, opts);
    if (check(state, TOKEN_TYPES.ASSIGN)) {
      throw unnamedParamError(
        'An unnamed fn param takes no default; name the param to give it one',
        current(state).span.start
      );
    }
    return {
      type: 'ClosureParam',
      name: unnamedSoFar === 0 ? '$' : '@',
      typeRef,
      defaultValue: null,
      annotations,
      span: makeSpan(start, previous(state).span.end),
    };
  }

  if (!isVariableNameToken(first)) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      'Expected parameter name or type',
      first.span.start
    );
  }
  advance(state);

  let typeRef: TypeRef | null = null;
  let defaultValue: LiteralNode | null = null;
  skipNewlines(state);
  if (check(state, TOKEN_TYPES.COLON)) {
    advance(state);
    skipNewlines(state);
    typeRef = parseTypeRef(state, opts);
  }
  skipNewlines(state);
  if (check(state, TOKEN_TYPES.ASSIGN)) {
    if (opts?.parseLiteral === undefined) {
      throw new ParseError(
        ERROR_IDS.RILL_P001,
        'Parameter defaults are not allowed here',
        current(state).span.start
      );
    }
    advance(state);
    skipNewlines(state);
    defaultValue = opts.parseLiteral();
  }
  return {
    type: 'ClosureParam',
    name: first.value,
    typeRef,
    defaultValue,
    annotations,
    span: makeSpan(start, previous(state).span.end),
  };
}

/**
 * Parse an fn parameter list; the cursor is past `(`, and `)` is left
 * unconsumed. At most two unnamed params, never mixed with named ones.
 */
function parseFnParams(
  state: ParserState,
  opts: TypeRefOpts | undefined
): ClosureParamNode[] {
  const params: ClosureParamNode[] = [];
  let unnamed = 0;
  skipNewlines(state);
  while (!check(state, TOKEN_TYPES.RPAREN)) {
    const at = current(state).span.start;
    const param = parseFnParam(state, opts, unnamed);
    const isUnnamed = isUnnamedParam(param);
    if (params.length > 0 && isUnnamed !== unnamed > 0) {
      throw unnamedParamError(
        'An fn parameter list is all named or all unnamed, not a mix',
        at
      );
    }
    if (isUnnamed) unnamed++;
    params.push(param);
    skipNewlines(state);
    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
      skipNewlines(state);
    } else if (!check(state, TOKEN_TYPES.RPAREN)) {
      throw new ParseError(
        ERROR_IDS.RILL_P014,
        "Expected ',' or ')' in fn parameter list",
        current(state).span.start
      );
    }
  }
  return params;
}

/** The `fn` member of TypeRef. */
export type FnTypeRef = Extract<TypeRef, { kind: 'fn' }>;

/**
 * Parse an fn signature: `fn [ "(" params ")" ] [ ":" outer ]`.
 *
 * The cursor sits on the `fn` token. A bare `fn` yields `params` undefined and
 * `fn()` an empty array. In a type position the outer is taken only when `:`
 * is followed by a type name, so an assertion keeps its meaning. With
 * `literalForm` the signature heads an fn literal or fn type value, so any
 * `:` after it starts the outer, which may be a `$var` type.
 *
 * @throws ParseError RILL-P028 for a third unnamed param, a mix of named and
 *   unnamed params, or a default on an unnamed param
 * @internal
 */
export function parseFnSignature(
  state: ParserState,
  opts?: TypeRefOpts,
  literalForm = false
): FnTypeRef {
  advance(state); // consume 'fn'
  const ref: FnTypeRef = { kind: 'fn' };
  if (check(state, TOKEN_TYPES.LPAREN)) {
    advance(state); // consume "("
    ref.params = parseFnParams(state, opts);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
  }
  if (literalForm ? check(state, TOKEN_TYPES.COLON) : atOuterType(state)) {
    ref.outer = parseOuterAfterColon(state, opts);
  }
  return ref;
}
