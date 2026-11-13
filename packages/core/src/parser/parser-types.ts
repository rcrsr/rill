/**
 * Parser Utility: Type Reference Parsing
 * Parses a type-ref production: either a static type name (optionally
 * parameterized) or a dynamic $variable.
 * @internal
 */

import {
  type TypeRef,
  type FieldArg,
  type LiteralNode,
  type AnnotationArg,
  type SourceLocation,
  TOKEN_TYPES,
  ParseError,
  isRillTypeName,
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
  withRecursionDepth,
} from './state.js';
import {
  VALID_TYPE_NAMES,
  isLiteralStart,
  isNegativeNumber,
  parseTypeName,
  expectVariableName,
} from './helpers.js';
import { ERROR_IDS } from '../error-registry.js';
import type { Parser } from './parser.js';

/**
 * Parse a type reference from the current position in the token stream.
 *
 * Grammar:
 * ```
 * type-ref          = single-type
 * single-type       = "$" identifier | type-name [ "(" type-ref-arg-list ")" ]
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
 * type. With `allowTrailingPipe`, a `|` that closes a parameter list is left
 * for the caller.
 *
 * @internal
 */
export function parseTypeRef(
  state: ParserState,
  opts?: {
    allowTrailingPipe?: boolean;
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): TypeRef {
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
export function parseScriptTypeRef(
  parser: Parser,
  opts?: { allowTrailingPipe?: boolean }
): TypeRef {
  return parseTypeRef(parser.state, {
    ...opts,
    parseLiteral: () => parser.parseLiteral(),
  });
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

/**
 * Decide whether the `|` at the current position is the removed union
 * separator. Outside a closure parameter list every `|` after a type is one.
 * Inside a `|`-delimited list the `|` is a separator only when a type name
 * follows, or `$name` followed by another `|` on the same line or by `=`;
 * otherwise it closes the list.
 */
function pipeIsRemovedSeparator(
  state: ParserState,
  inParamList: boolean
): boolean {
  if (!inParamList) return true;
  const after = peek(state, 1);
  if (after.type === TOKEN_TYPES.IDENTIFIER) return startsTypeMember(state, 1);
  if (after.type !== TOKEN_TYPES.DOLLAR) return false;
  if (!/^[A-Za-z_]/.test(peek(state, 2).value)) return false;
  const next = peek(state, 3).type;
  if (next === TOKEN_TYPES.PIPE_BAR) return true;
  let i = 3;
  while (peek(state, i).type === TOKEN_TYPES.NEWLINE) i++;
  return peek(state, i).type === TOKEN_TYPES.ASSIGN;
}

const REMOVED_SEPARATOR_PREFIX = "The '|' type separator was removed; write ";

/**
 * Raise RILL-P011 for a removed `|` separator. Consumes the remaining
 * members so the message names the `union(...)` rewrite in written order.
 */
function throwRemovedSeparator(
  state: ParserState,
  firstText: string,
  inParamList: boolean,
  opts: Parameters<typeof parseSingleType>[1]
): never {
  const location = current(state).span.start;
  const texts = [firstText];
  while (
    check(state, TOKEN_TYPES.PIPE_BAR) &&
    startsTypeMember(state, 1) &&
    pipeIsRemovedSeparator(state, inParamList)
  ) {
    advance(state); // consume "|"
    const start = current(state).span.start.offset;
    parseSingleType(state, opts);
    texts.push(state.source.slice(start, previous(state).span.end.offset));
  }
  const rewrite =
    texts.length > 1 && texts.every((t) => t !== '')
      ? `union(${texts.join(', ')})`
      : 'unions as union(...)';
  throw new ParseError(
    ERROR_IDS.RILL_P011,
    `${REMOVED_SEPARATOR_PREFIX}${rewrite}`,
    location
  );
}

function parseTypeRefImpl(
  state: ParserState,
  opts?: {
    allowTrailingPipe?: boolean;
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): TypeRef {
  const startOffset = current(state).span.start.offset;
  const first = parseSingleType(state, opts);

  if (!check(state, TOKEN_TYPES.PIPE_BAR)) return first;

  const inParamList = opts?.allowTrailingPipe === true;
  if (!pipeIsRemovedSeparator(state, inParamList)) return first;

  const firstText =
    state.source === ''
      ? ''
      : state.source.slice(startOffset, previous(state).span.end.offset);
  return throwRemovedSeparator(state, firstText, inParamList, opts);
}

/**
 * Parse a single type (one member of a union, or the sole type-ref).
 * Grammar: `single-type = "$" identifier | type-name [ "(" type-ref-arg-list ")" ]`
 * @internal
 */
function parseSingleType(
  state: ParserState,
  opts?: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): TypeRef {
  // Zero-param closure type: || :returnType or bare ||
  if (check(state, TOKEN_TYPES.OR)) {
    advance(state); // consume || (OR token)
    // Check for :returnType
    if (check(state, TOKEN_TYPES.COLON)) {
      advance(state); // consume :
      const ret = parseSingleType(state, opts);
      return { kind: 'static', typeName: 'closure', args: [{ value: ret }] };
    }
    // Bare || without :returnType — equivalent to 'closure'
    return { kind: 'static', typeName: 'closure' };
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
  const typeName = parseTypeName(state, VALID_TYPE_NAMES);

  // Check for parameterized form: type-name "(" type-ref-arg-list ")"
  if (!check(state, TOKEN_TYPES.LPAREN)) {
    if (typeName === 'union') throwBareUnion(nameToken.span.start);
    return { kind: 'static', typeName };
  }

  advance(state); // consume "("

  if (typeName === 'union') {
    const members = parseUnionMembers(state, opts);
    advance(state); // consume ")"
    return { kind: 'union', members };
  }

  const args = parseFieldArgList(state, buildTypeRefOpts(opts));
  advance(state); // consume ")"

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
  opts?: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
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

/** Forward parseLiteral and parseAnnotations from field-arg opts to parseTypeRef opts. */
function buildTypeRefOpts(opts?: {
  parseLiteral?: () => LiteralNode;
  parseAnnotations?: () => AnnotationArg[];
}):
  | {
      parseLiteral?: () => LiteralNode;
      parseAnnotations?: () => AnnotationArg[];
    }
  | undefined {
  if (!opts?.parseLiteral && !opts?.parseAnnotations) return undefined;
  const result: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  } = {};
  if (opts.parseLiteral) result.parseLiteral = opts.parseLiteral;
  if (opts.parseAnnotations) result.parseAnnotations = opts.parseAnnotations;
  return result;
}

export function parseFieldArgList(
  state: ParserState,
  opts?: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): FieldArg[] {
  const args: FieldArg[] = [];

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

    // Check for named arg: identifier ":" type-ref
    // Lookahead: current is IDENTIFIER and next is COLON
    const tok = current(state);
    if (
      tok.type === TOKEN_TYPES.IDENTIFIER &&
      state.tokens[state.pos + 1]?.type === TOKEN_TYPES.COLON
    ) {
      const name = tok.value;
      advance(state); // consume identifier
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
 * True when the cursor sits on `:<type-name>`, the resolution-type suffix of
 * a stream type. A `:$t` or `:<non-type>` is not a suffix.
 * @internal
 */
export function atStreamResolutionSuffix(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.COLON) &&
    peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
    isRillTypeName(peek(state, 1).value)
  );
}

/**
 * Parse the resolution type of `stream(T):R` (cursor on R, colon already
 * consumed) and append it to `args`. Chunk type sits in args[0], resolution
 * in args[1]; an empty chunk gets an `any` placeholder to keep positions.
 * @internal
 */
export function appendStreamResolution(parser: Parser, args: FieldArg[]): void {
  const resolutionType = parseScriptTypeRef(parser);
  if (args.length === 0) {
    args.push({ value: { kind: 'static', typeName: 'any' } });
  }
  args.push({ value: resolutionType });
}
